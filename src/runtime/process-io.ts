/**
 * ProcessIO Transport - Subprocess-based Python communication for Node.js.
 *
 * This transport implements the Transport interface for spawning and communicating
 * with a Python subprocess via stdio streams. It provides:
 * - JSONL (JSON Lines) protocol for request/response messaging
 * - Backpressure handling for stdin writes
 * - Line-based stdout parsing with buffering
 * - Stderr capture for error diagnostics
 * - Request timeout management
 * - Optional process restart after N requests
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { spawn, type ChildProcess } from 'child_process';
import { BoundedContext } from './bounded-context.js';
import {
  BridgeDisposedError,
  BridgeProtocolError,
  BridgeTimeoutError,
  BridgeExecutionError,
} from './errors.js';
import type { Transport } from './transport.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default maximum response line length: 100MB */
const DEFAULT_MAX_LINE_LENGTH = 100 * 1024 * 1024;

/** Maximum stderr bytes to retain for diagnostics: 8KB */
const MAX_STDERR_BYTES = 8 * 1024;

/** Default write queue timeout: 30 seconds */
const DEFAULT_WRITE_QUEUE_TIMEOUT_MS = 30_000;

/** Regex for ANSI escape sequences */
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Regex for control characters */
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for ProcessIO transport.
 */
export interface ProcessIOOptions {
  /** Python executable path. Default: 'python3' */
  pythonPath?: string;

  /** Path to the bridge script */
  bridgeScript: string;

  /** Environment variables to pass to the subprocess */
  env?: Record<string, string>;

  /** Working directory for the subprocess. Default: process.cwd() */
  cwd?: string;

  /** Maximum line length for responses. Default: 100MB */
  maxLineLength?: number;

  /** Restart process after N requests (0 = never). Default: 0 */
  restartAfterRequests?: number;

  /** Write queue timeout in milliseconds. Default: 30000ms */
  writeQueueTimeoutMs?: number;
}

/**
 * Pending request entry for tracking in-flight requests.
 */
interface PendingRequest {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * Queued write entry for backpressure handling.
 */
interface QueuedWrite {
  data: string;
  resolve: () => void;
  reject: (error: Error) => void;
  /** Timestamp when the write was queued */
  queuedAt: number;
  /** Timeout handle for write queue timeout */
  timeoutHandle?: NodeJS.Timeout;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Sanitize stderr output by removing ANSI codes and control characters.
 */
function sanitizeStderr(value: string): string {
  return value.replace(ANSI_ESCAPE_RE, '').replace(CONTROL_CHARS_RE, '');
}

/**
 * Extract message ID from a JSON string without full parsing.
 * Returns null if ID cannot be extracted.
 */
function extractMessageId(json: string): number | null {
  // Look for "id": <number> (integer IDs)
  const match = json.match(/"id"\s*:\s*(-?\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

// =============================================================================
// PROCESS IO TRANSPORT
// =============================================================================

/**
 * Transport implementation for subprocess-based Python communication.
 *
 * ProcessIO spawns a Python child process and communicates via stdio:
 * - Requests are written to stdin as JSON lines
 * - Responses are read from stdout as JSON lines
 * - Stderr is captured for diagnostics
 *
 * @example
 * ```typescript
 * const transport = new ProcessIO({
 *   bridgeScript: '/path/to/bridge.py',
 *   pythonPath: 'python3',
 * });
 *
 * await transport.init();
 *
 * const response = await transport.send(
 *   JSON.stringify({ id: '1', type: 'call', module: 'math', args: [16] }),
 *   5000
 * );
 *
 * await transport.dispose();
 * ```
 */
export class ProcessIO extends BoundedContext implements Transport {
  // Configuration
  private readonly pythonPath: string;
  private readonly bridgeScript: string;
  private readonly envOverrides: Record<string, string>;
  private readonly cwd: string | undefined;
  private readonly maxLineLength: number;
  private readonly restartAfterRequests: number;
  private readonly writeQueueTimeoutMs: number;

  // Process state
  private process: ChildProcess | null = null;
  private processExited = false;
  private processError: Error | null = null;

  // Stream buffers
  private stdoutBuffer = '';
  private stderrBuffer = '';

  // Request tracking
  private readonly pending = new Map<number, PendingRequest>();
  private requestCount = 0;
  private needsRestart = false;

  // Write queue for backpressure
  private readonly writeQueue: QueuedWrite[] = [];
  private draining = false;

  /**
   * Create a new ProcessIO transport.
   *
   * @param options - Transport configuration options
   */
  constructor(options: ProcessIOOptions) {
    super();

    this.pythonPath = options.pythonPath ?? 'python3';
    this.bridgeScript = options.bridgeScript;
    this.envOverrides = options.env ?? {};
    this.cwd = options.cwd;
    this.maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    this.restartAfterRequests = options.restartAfterRequests ?? 0;
    this.writeQueueTimeoutMs = options.writeQueueTimeoutMs ?? DEFAULT_WRITE_QUEUE_TIMEOUT_MS;
  }

  // ===========================================================================
  // TRANSPORT INTERFACE
  // ===========================================================================

  /**
   * Send a message and wait for the response.
   *
   * @param message - The JSON-encoded protocol message
   * @param timeoutMs - Timeout in milliseconds (0 = no timeout)
   * @param signal - Optional AbortSignal for cancellation
   * @returns The raw JSON response string
   */
  async send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    // Check disposed state
    if (this.isDisposed) {
      throw new BridgeDisposedError('Transport has been disposed');
    }

    // Auto-initialize if needed
    if (!this.isReady) {
      await this.init();
    }

    // Check if process is alive
    if (this.processExited || !this.process) {
      const stderrTail = this.getStderrTail();
      const baseMsg = 'Python process is not running';
      const msg = stderrTail ? `${baseMsg}. Stderr:\n${stderrTail}` : baseMsg;
      throw new BridgeProtocolError(msg);
    }

    // Check if already aborted
    if (signal?.aborted) {
      throw new BridgeTimeoutError('Operation aborted');
    }

    // Extract message ID for response correlation
    const messageId = extractMessageId(message);
    if (!messageId) {
      throw new BridgeProtocolError('Message must contain an "id" field');
    }

    // Check for restart condition (either scheduled restart or forced by stream error)
    if (this.needsRestart || (this.restartAfterRequests > 0 && this.requestCount >= this.restartAfterRequests)) {
      await this.restartProcess();
    }

    // Create promise for response
    return new Promise<string>((resolve, reject) => {
      // Set up timeout if specified
      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(messageId);
          const stderrTail = this.getStderrTail();
          const baseMsg = `Operation timed out after ${timeoutMs}ms`;
          const msg = stderrTail ? `${baseMsg}. Recent stderr:\n${stderrTail}` : baseMsg;
          reject(new BridgeTimeoutError(msg));
        }, timeoutMs);
      }

      // Set up abort handler
      const abortHandler = (): void => {
        if (timer) {
          clearTimeout(timer);
        }
        this.pending.delete(messageId);
        reject(new BridgeTimeoutError('Operation aborted'));
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      // Wrap resolve/reject to clean up abort listener
      const wrappedResolve = (value: string): void => {
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener('abort', abortHandler);
        resolve(value);
      };

      const wrappedReject = (error: Error): void => {
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener('abort', abortHandler);
        reject(error);
      };

      // Register pending request
      this.pending.set(messageId, {
        resolve: wrappedResolve,
        reject: wrappedReject,
        timer,
      });

      // Write message to stdin
      this.writeToStdin(`${message}\n`).catch(err => {
        this.pending.delete(messageId);
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener('abort', abortHandler);
        reject(this.classifyError(err));
      });

      this.requestCount++;
    });
  }

  // ===========================================================================
  // BOUNDED CONTEXT LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the transport by spawning the Python process.
   */
  protected async doInit(): Promise<void> {
    await this.spawnProcess();
  }

  /**
   * Dispose the transport by killing the Python process.
   */
  protected async doDispose(): Promise<void> {
    // Reject all pending requests
    const stderrTail = this.getStderrTail();
    const msg = stderrTail
      ? `Transport disposed. Stderr:\n${stderrTail}`
      : 'Transport disposed';
    const error = new BridgeDisposedError(msg);

    for (const [, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(error);
    }
    this.pending.clear();

    // Clear write queue
    for (const queued of this.writeQueue) {
      this.clearQueuedWriteTimeout(queued);
      queued.reject(error);
    }
    this.writeQueue.length = 0;

    // Kill process
    await this.killProcess();

    // Clear buffers
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.requestCount = 0;
  }

  // ===========================================================================
  // ABSTRACT METHOD STUBS (from BoundedContext)
  // ===========================================================================

  /**
   * Not implemented - ProcessIO is a transport, not a full bridge.
   */
  call<T = unknown>(
    _module: string,
    _functionName: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>
  ): Promise<T> {
    throw new BridgeExecutionError('ProcessIO is a transport, use BridgeProtocol for operations');
  }

  /**
   * Not implemented - ProcessIO is a transport, not a full bridge.
   */
  instantiate<T = unknown>(
    _module: string,
    _className: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>
  ): Promise<T> {
    throw new BridgeExecutionError('ProcessIO is a transport, use BridgeProtocol for operations');
  }

  /**
   * Not implemented - ProcessIO is a transport, not a full bridge.
   */
  callMethod<T = unknown>(
    _handle: string,
    _methodName: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>
  ): Promise<T> {
    throw new BridgeExecutionError('ProcessIO is a transport, use BridgeProtocol for operations');
  }

  /**
   * Not implemented - ProcessIO is a transport, not a full bridge.
   */
  disposeInstance(_handle: string): Promise<void> {
    throw new BridgeExecutionError('ProcessIO is a transport, use BridgeProtocol for operations');
  }

  // ===========================================================================
  // PROCESS MANAGEMENT
  // ===========================================================================

  /**
   * Spawn the Python subprocess.
   */
  private async spawnProcess(): Promise<void> {
    // Build environment - use provided env or inherit from process.env
    // If env is provided, it should be the complete environment (already filtered by NodeBridge)
    // We only add Python-specific variables on top
    const baseEnv = Object.keys(this.envOverrides).length > 0 ? this.envOverrides : process.env;
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      // Ensure Python uses UTF-8
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'UTF-8',
      // Disable Python buffering
      PYTHONUNBUFFERED: '1',
    };

    // Spawn process
    this.process = spawn(this.pythonPath, [this.bridgeScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: this.cwd,
    });

    this.processExited = false;
    this.processError = null;

    // Set up event handlers
    this.process.on('error', this.handleProcessError.bind(this));
    this.process.on('exit', this.handleProcessExit.bind(this));

    if (this.process.stdout) {
      this.process.stdout.on('data', this.handleStdoutData.bind(this));
      this.process.stdout.on('error', this.handleStdoutError.bind(this));
    }

    if (this.process.stderr) {
      this.process.stderr.on('data', this.handleStderrData.bind(this));
      this.process.stderr.on('error', this.handleStderrError.bind(this));
    }

    if (this.process.stdin) {
      this.process.stdin.on('drain', this.handleStdinDrain.bind(this));
      this.process.stdin.on('error', this.handleStdinError.bind(this));
    }

    // Wait for process to be ready (first heartbeat could be here)
    // For now, just resolve immediately - the process is spawned
    await Promise.resolve();
  }

  /**
   * Kill the Python subprocess.
   */
  private async killProcess(): Promise<void> {
    if (!this.process) {
      return;
    }

    const proc = this.process;
    this.process = null;

    // Add a catch-all error handler to prevent uncaught exceptions during shutdown
    // This must be added BEFORE removing other listeners and ending stdin
    const noopErrorHandler = (): void => {
      // Ignore errors during shutdown (e.g., EPIPE)
    };
    proc.stdin?.on('error', noopErrorHandler);
    proc.on('error', noopErrorHandler);

    // Gracefully end stdin to prevent EPIPE on pending writes
    try {
      proc.stdin?.end();
    } catch {
      // Ignore errors ending stdin
    }

    // Remove other listeners to prevent callbacks after disposal
    proc.removeAllListeners('exit');
    proc.removeAllListeners('close');
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();

    // Kill the process
    if (!proc.killed) {
      proc.kill('SIGTERM');

      // Wait briefly for graceful exit
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
          resolve();
        }, 1000);

        proc.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }

  /**
   * Restart the Python process.
   */
  private async restartProcess(): Promise<void> {
    // Kill existing process
    await this.killProcess();

    // Clear buffers and restart flags
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.requestCount = 0;
    this.needsRestart = false;

    // Spawn new process
    await this.spawnProcess();
  }

  /**
   * Mark the process for restart on the next send.
   * This is called after stream errors to ensure the next request uses a fresh process.
   * Works independently of restartAfterRequests setting.
   */
  private markForRestart(): void {
    this.needsRestart = true;
  }

  // ===========================================================================
  // STREAM HANDLERS
  // ===========================================================================

  /**
   * Handle stdout data from the Python process.
   */
  private handleStdoutData(chunk: Buffer | string): void {
    this.stdoutBuffer += chunk.toString();

    // Check for excessive line length without newline
    if (
      this.stdoutBuffer.length > this.maxLineLength &&
      !this.stdoutBuffer.includes('\n')
    ) {
      const snippet = this.stdoutBuffer.slice(0, 500);
      this.stdoutBuffer = '';
      this.handleProtocolError(
        `Response line exceeded ${this.maxLineLength} bytes`,
        snippet
      );
      return;
    }

    // Process complete lines
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      // Skip empty lines
      if (!line.trim()) {
        continue;
      }

      // Check line length
      if (line.length > this.maxLineLength) {
        const snippet = line.slice(0, 500);
        this.handleProtocolError(
          `Response line exceeded ${this.maxLineLength} bytes`,
          snippet
        );
        return;
      }

      this.handleResponseLine(line);
    }
  }

  /**
   * Handle a complete response line from stdout.
   */
  private handleResponseLine(line: string): void {
    // Extract ID to find pending request
    const messageId = extractMessageId(line);
    if (!messageId) {
      this.handleProtocolError('Response missing "id" field', line);
      return;
    }

    const pending = this.pending.get(messageId);
    if (!pending) {
      // Response for unknown request - could be for a timed-out request
      // Log but don't fail
      return;
    }

    // Remove from pending
    this.pending.delete(messageId);

    // Clear timeout
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    // Resolve with raw response
    pending.resolve(line);
  }

  /**
   * Handle stderr data from the Python process.
   */
  private handleStderrData(chunk: Buffer | string): void {
    try {
      this.stderrBuffer += sanitizeStderr(chunk.toString());

      // Keep only the tail
      if (this.stderrBuffer.length > MAX_STDERR_BYTES) {
        this.stderrBuffer = this.stderrBuffer.slice(
          this.stderrBuffer.length - MAX_STDERR_BYTES
        );
      }
    } catch {
      // Ignore stderr buffering errors
    }
  }

  /**
   * Handle process error event.
   */
  private handleProcessError(err: Error): void {
    this.processError = err;
    this.processExited = true;

    const msg = `Python process error: ${err.message}`;
    const error = new BridgeProtocolError(msg);

    this.rejectAllPending(error);
  }

  /**
   * Handle process exit event.
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    this.processExited = true;

    const stderrTail = this.getStderrTail();
    let msg: string;

    if (signal) {
      msg = `Python process killed by signal ${signal}`;
    } else if (code !== null && code !== 0) {
      msg = `Python process exited with code ${code}`;
    } else {
      msg = 'Python process exited';
    }

    if (stderrTail) {
      msg += `. Stderr:\n${stderrTail}`;
    }

    const error = new BridgeProtocolError(msg);
    this.rejectAllPending(error);
  }

  /**
   * Handle stdin drain event (backpressure relief).
   */
  private handleStdinDrain(): void {
    this.draining = false;
    this.flushWriteQueue();
  }

  /**
   * Handle stdin error event.
   */
  private handleStdinError(err: Error): void {
    // EPIPE means process died
    const error = new BridgeProtocolError(
      this.withStderrTail(`stdin error: ${err.message}`)
    );

    // Reject all pending writes
    for (const queued of this.writeQueue) {
      this.clearQueuedWriteTimeout(queued);
      queued.reject(error);
    }
    this.writeQueue.length = 0;

    // Reject all pending requests
    this.rejectAllPending(error);

    // Mark for restart on next send
    this.markForRestart();
  }

  /**
   * Handle stdout error event.
   * This can occur during pipe errors or when the process crashes.
   */
  private handleStdoutError(err: Error): void {
    const error = new BridgeProtocolError(
      this.withStderrTail(`stdout error: ${err.message}`)
    );
    this.rejectAllPending(error);
    this.markForRestart();
  }

  /**
   * Handle stderr error event.
   * This can occur during pipe errors or when the process crashes.
   */
  private handleStderrError(err: Error): void {
    // Stderr errors are less critical but still indicate process health issues
    const error = new BridgeProtocolError(
      this.withStderrTail(`stderr error: ${err.message}`)
    );
    this.rejectAllPending(error);
    this.markForRestart();
  }

  // ===========================================================================
  // WRITE MANAGEMENT
  // ===========================================================================

  /**
   * Create a queued write entry with a timeout timer.
   * The timer fires if the drain event never comes.
   */
  private createQueuedWrite(
    data: string,
    resolve: () => void,
    reject: (error: Error) => void
  ): QueuedWrite {
    const queuedAt = Date.now();
    const entry: QueuedWrite = { data, resolve, reject, queuedAt };

    // Set up timeout timer that fires if drain never happens
    entry.timeoutHandle = setTimeout(() => {
      // Remove this entry from the queue
      const index = this.writeQueue.indexOf(entry);
      if (index !== -1) {
        this.writeQueue.splice(index, 1);
        reject(new BridgeTimeoutError(
          `Write queue timeout: entry waited ${this.writeQueueTimeoutMs}ms without drain`
        ));
      }
    }, this.writeQueueTimeoutMs);

    // Unref the timer so it doesn't keep the process alive
    entry.timeoutHandle.unref();

    return entry;
  }

  /**
   * Clear the timeout for a queued write entry.
   */
  private clearQueuedWriteTimeout(entry: QueuedWrite): void {
    if (entry.timeoutHandle) {
      clearTimeout(entry.timeoutHandle);
      entry.timeoutHandle = undefined;
    }
  }

  /**
   * Write data to stdin with backpressure handling.
   */
  private writeToStdin(data: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.process?.stdin || this.processExited) {
        reject(new BridgeProtocolError(this.withStderrTail('Process stdin not available')));
        return;
      }

      if (this.draining || this.writeQueue.length > 0) {
        // Queue the write with timestamp and timeout timer
        this.writeQueue.push(this.createQueuedWrite(data, resolve, reject));
        return;
      }

      // Try direct write (wrap in try-catch for synchronous EPIPE errors)
      try {
        const canWrite = this.process.stdin.write(data);

        if (canWrite) {
          resolve();
        } else {
          // Backpressure - current write is accepted by Node's stream buffer.
          // We only pause subsequent writes until "drain".
          this.draining = true;
          resolve();
        }
      } catch (err) {
        // Synchronous write error (e.g., EPIPE)
        this.markForRestart();
        const errorMessage = err instanceof Error ? err.message : 'unknown';
        reject(new BridgeProtocolError(this.withStderrTail(`Write error: ${errorMessage}`)));
      }
    });
  }

  /**
   * Flush queued writes when backpressure clears.
   */
  private flushWriteQueue(): void {
    const now = Date.now();

    while (this.writeQueue.length > 0 && !this.draining) {
      if (!this.process?.stdin || this.processExited) {
        // Process died - reject all queued writes
        for (const q of this.writeQueue) {
          this.clearQueuedWriteTimeout(q);
          q.reject(new BridgeProtocolError(this.withStderrTail('Process stdin not available')));
        }
        this.writeQueue.length = 0;
        this.markForRestart();
        return;
      }

      const queued = this.writeQueue.shift();
      if (!queued) {
        return;
      }

      // Clear the timeout since we're processing this entry now
      this.clearQueuedWriteTimeout(queued);

      // Check for write queue timeout (fallback check, timer should have handled this)
      if (now - queued.queuedAt > this.writeQueueTimeoutMs) {
        queued.reject(new BridgeTimeoutError(
          `Write queue timeout: entry waited ${now - queued.queuedAt}ms (limit: ${this.writeQueueTimeoutMs}ms)`
        ));
        continue; // Process next entry
      }

      try {
        const canWrite = this.process.stdin.write(queued.data);

        if (canWrite) {
          queued.resolve();
        } else {
          // Backpressure - this write has been accepted by stream buffer.
          // Pause further queued writes until the next "drain" event.
          queued.resolve();
          this.draining = true;
          return;
        }
      } catch (err) {
        // Synchronous write error (e.g., EPIPE) - reject this and all remaining writes
        const errorMessage = err instanceof Error ? err.message : 'unknown';
        const error = new BridgeProtocolError(
          this.withStderrTail(`Write error: ${errorMessage}`)
        );
        queued.reject(error);
        for (const q of this.writeQueue) {
          this.clearQueuedWriteTimeout(q);
          q.reject(error);
        }
        this.writeQueue.length = 0;
        this.markForRestart();
        return;
      }
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Get the tail of stderr for diagnostics.
   */
  private getStderrTail(): string {
    return this.stderrBuffer.trim();
  }

  /**
   * Append stderr context when available.
   */
  private withStderrTail(message: string): string {
    const stderrTail = this.getStderrTail();
    return stderrTail ? `${message}. Stderr:\n${stderrTail}` : message;
  }

  /**
   * Handle a protocol error by rejecting all pending requests.
   */
  private handleProtocolError(details: string, line?: string): void {
    const snippet = line
      ? line.length > 500 ? `${line.slice(0, 500)}...` : line
      : undefined;

    const hint = 'Ensure Python code does not print to stdout and bridge outputs only JSON lines.';

    const msg = snippet
      ? `Protocol error: ${details}\n${hint}\nOffending line: ${snippet}`
      : `Protocol error: ${details}\n${hint}`;

    const error = new BridgeProtocolError(msg);
    this.rejectAllPending(error);
  }

  /**
   * Reject all pending requests with an error.
   */
  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}
