/**
 * SubprocessTransport - Subprocess-based Python communication for Node.js.
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
import type { Writable } from 'stream';
import { DisposableBase } from './bounded-context.js';
import { BridgeDisposedError, BridgeProtocolError, BridgeTimeoutError } from './errors.js';
import { Reassembler, encodeFrames, utf8ByteLength } from './frame-codec.js';
import { TimedOutRequestTracker } from './timed-out-request-tracker.js';
import {
  FRAME_PROTOCOL_ID,
  PROTOCOL_ID,
  type Transport,
  type TransportCapabilities,
} from './transport.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default maximum response line length: 100MB */
const DEFAULT_MAX_LINE_LENGTH = 100 * 1024 * 1024;

/** Maximum stderr bytes to retain for diagnostics: 8KB */
const MAX_STDERR_BYTES = 8 * 1024;

/** Default write queue timeout: 30 seconds */
const DEFAULT_WRITE_QUEUE_TIMEOUT_MS = 30_000;

/** Track timed-out/cancelled request IDs long enough to ignore late responses. */
const TIMED_OUT_REQUEST_TTL_MS = 10 * 60 * 1000;

/**
 * Per-frame envelope headroom (bytes) reserved on top of a frame's data slice
 * when sizing the frame-aware stdout line ceiling.
 *
 * A `tywrap-frame/1` line is `{"__tywrap_frame__":"chunk","frameProtocol":...,
 * "stream":"response","id":N,"seq":N,"total":N,"totalBytes":N,
 * "encoding":"utf8-slice","data":"<slice>"}`. The fixed keys plus the largest
 * plausible integer fields are well under 256 bytes; 1 KiB is a comfortable
 * upper bound that never under-allocates.
 */
const FRAME_ENVELOPE_HEADROOM = 1024;

/**
 * Worst-case JSON-escaping expansion of a frame's `data` slice. The slice is a
 * fragment of a JSON response (already-escaped, printable content), so realistic
 * expansion is `"`->`\"` / `\`->`\\` (2x). Using 2x keeps the frame-aware line
 * ceiling sound without over-allocating buffer headroom.
 */
const FRAME_DATA_ESCAPE_FACTOR = 2;

/** Negotiation env var: `1` enables `tywrap-frame/1` chunked transport. */
const ENV_CHUNKING = 'TYWRAP_TRANSPORT_CHUNKING';
/** Negotiation env var: the framing protocol id the bridge must implement. */
const ENV_FRAME_PROTOCOL = 'TYWRAP_TRANSPORT_FRAME_PROTOCOL';
/** Negotiation env var: per-frame UTF-8 byte ceiling for the data slice. */
const ENV_MAX_FRAME_BYTES = 'TYWRAP_TRANSPORT_MAX_FRAME_BYTES';

/** Timeout (ms) for the in-init meta negotiation probe. */
const NEGOTIATION_PROBE_TIMEOUT_MS = 30_000;

/**
 * Default cap (UTF-8 bytes) on a single chunked response reassembled in memory.
 * Mirrors the codec's `DEFAULT_MAX_PAYLOAD_BYTES` (10 MiB) so chunking never
 * buffers more than the codec would ultimately accept; `NodeBridge` overrides it
 * with the configured `codec.maxPayloadBytes`.
 */
const DEFAULT_MAX_REASSEMBLY_BYTES = 10 * 1024 * 1024;

/** Regex for ANSI escape sequences */
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Regex for control characters */
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for the SubprocessTransport.
 */
export interface SubprocessTransportOptions {
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

  /**
   * Enable `tywrap-frame/1` chunked transport negotiation. When `true`, the
   * transport spawns the bridge with the three `TYWRAP_TRANSPORT_*` env vars and,
   * during {@link SubprocessTransport.init}, probes the bridge's `meta` for a
   * `transport.supportsChunking` block. If the bridge advertises chunking,
   * oversize responses are transparently reassembled from frames; otherwise
   * behavior is unchanged and an oversize response still fails loud (no silent
   * single-frame fallback). Default: `false` (no negotiation, legacy behavior).
   *
   * Subprocess-only (0.8.0). See docs/transport-framing.md.
   */
  enableChunking?: boolean;

  /**
   * Cap (UTF-8 bytes) on a single chunked RESPONSE reassembled in memory. A
   * frame stream whose declared or accumulated payload exceeds this fails loud
   * instead of buffering, so chunking cannot OOM the process before the codec's
   * payload cap rejects the result. Should track the codec's `maxPayloadBytes`.
   * Default: 10 MiB (matches the codec default).
   */
  maxReassemblyBytes?: number;
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
  /**
   * Liveness predicate. If present and `false` at flush time, the write is
   * SKIPPED (resolved as a no-op) instead of sent — so a request that timed out
   * or aborted while its write sat in the stdin backpressure queue never reaches
   * (and so never executes on) Python.
   */
  isLive?: () => boolean;
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
 * Extract top-level message ID from a JSON string.
 * Returns null if ID cannot be extracted.
 */
function extractMessageId(json: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const id = (parsed as { id?: unknown }).id;
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    return null;
  }

  return id;
}

/**
 * Result of inspecting a stdout line for `tywrap-frame/1` framing.
 * - `{ kind: 'frame', value }`: the line parsed as JSON carrying a
 *   `__tywrap_frame__` marker (handed to the reassembler, which validates it).
 * - `{ kind: 'plain' }`: valid JSON without a framing marker (a normal,
 *   single-line response).
 * - `{ kind: 'invalid' }`: not parseable as JSON.
 */
type FrameLineProbe =
  | { kind: 'frame'; value: unknown }
  | { kind: 'plain' }
  | { kind: 'invalid' };

/**
 * Classify a stdout line as a frame envelope, a plain response, or invalid JSON.
 *
 * A frame envelope is any JSON object carrying a `__tywrap_frame__` key; the
 * envelope's structural validity (protocol, seq/total ranges, etc.) is enforced
 * by the {@link Reassembler}, not here — this only routes the line.
 */
function probeFrameLine(line: string): FrameLineProbe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: 'invalid' };
  }
  if (parsed !== null && typeof parsed === 'object' && '__tywrap_frame__' in parsed) {
    return { kind: 'frame', value: parsed };
  }
  return { kind: 'plain' };
}

// =============================================================================
// PROCESS IO TRANSPORT
// =============================================================================

/**
 * Transport implementation for subprocess-based Python communication.
 *
 * SubprocessTransport spawns a Python child process and communicates via stdio:
 * - Requests are written to stdin as JSON lines
 * - Responses are read from stdout as JSON lines
 * - Stderr is captured for diagnostics
 *
 * @example
 * ```typescript
 * const transport = new SubprocessTransport({
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
export class SubprocessTransport extends DisposableBase implements Transport {
  // Configuration
  private readonly pythonPath: string;
  private readonly bridgeScript: string;
  private readonly envOverrides: Record<string, string>;
  private readonly cwd: string | undefined;
  private readonly maxLineLength: number;
  private readonly maxReassemblyBytes: number;
  private readonly restartAfterRequests: number;
  private readonly writeQueueTimeoutMs: number;

  /** Whether `tywrap-frame/1` negotiation was requested by the caller. */
  private readonly enableChunking: boolean;

  /**
   * Whether the bridge advertised chunking during the init meta probe. Only
   * `true` after a successful negotiation; drives {@link capabilities} and the
   * frame-aware stdout line ceiling.
   */
  private negotiatedChunking = false;

  /**
   * Reassembles `tywrap-frame/1` response frames into single logical response
   * lines. Constructed lazily once chunking is negotiated; per-id discard tracks
   * timed-out/aborted streams so late frames cannot desync stdout.
   */
  private responseReassembler: Reassembler | null = null;

  // Process state
  private process: ChildProcess | null = null;
  private processExited = false;
  private processError: Error | null = null;

  // Stream buffers
  private stdoutBuffer = '';
  private stderrBuffer = '';

  // Request tracking
  private readonly pending = new Map<number, PendingRequest>();
  private readonly timedOutRequests = new TimedOutRequestTracker({
    ttlMs: TIMED_OUT_REQUEST_TTL_MS,
  });
  private requestCount = 0;
  private needsRestart = false;

  // Write queue for backpressure
  private readonly writeQueue: QueuedWrite[] = [];
  private draining = false;

  /**
   * Per-logical-request write mutex (W5). When a request is chunked into
   * `tywrap-frame/1` frames, all of that request's frames must reach stdin
   * contiguously — no other request's frame (or single line) may interleave —
   * or the Python reassembler would see frames from two ids mixed on one stream.
   * `writeChunkedRequest` chains the whole frame burst onto this tail; the
   * single-line write path also serializes behind it so a small request issued
   * concurrently never slips between another request's frames.
   */
  private writeMutex: Promise<void> = Promise.resolve();

  /**
   * Create a new SubprocessTransport.
   *
   * @param options - Transport configuration options
   */
  constructor(options: SubprocessTransportOptions) {
    super();

    this.pythonPath = options.pythonPath ?? 'python3';
    this.bridgeScript = options.bridgeScript;
    this.envOverrides = options.env ?? {};
    this.cwd = options.cwd;
    this.maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    this.restartAfterRequests = options.restartAfterRequests ?? 0;
    this.writeQueueTimeoutMs = options.writeQueueTimeoutMs ?? DEFAULT_WRITE_QUEUE_TIMEOUT_MS;
    this.enableChunking = options.enableChunking ?? false;
    this.maxReassemblyBytes = options.maxReassemblyBytes ?? DEFAULT_MAX_REASSEMBLY_BYTES;
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
    if (messageId === null) {
      throw new BridgeProtocolError('Message must contain an "id" field');
    }

    // Check for restart condition (either scheduled restart or forced by stream error)
    if (
      this.needsRestart ||
      (this.restartAfterRequests > 0 && this.requestCount >= this.restartAfterRequests)
    ) {
      await this.restartProcess();
    }

    // Create promise for response
    return new Promise<string>((resolve, reject) => {
      // Set up timeout if specified
      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(messageId);
          this.timedOutRequests.mark(messageId);
          // Discard any in-flight chunked response stream for this id so late
          // frames are dropped rather than desyncing stdout (the single-line
          // timedOutRequests.consume above is one-shot and insufficient for a
          // multi-frame stream).
          this.responseReassembler?.discard(messageId);
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
        this.timedOutRequests.mark(messageId);
        // Same late-frame discard as the timeout path (see above).
        this.responseReassembler?.discard(messageId);
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

      // Write message to stdin. When chunking is negotiated and the encoded
      // request exceeds the negotiated per-frame ceiling, it is fragmented into
      // `tywrap-frame/1` request frames written contiguously under the write
      // mutex (W5); otherwise it goes out as a single JSONL line. Both paths
      // serialize through the same mutex so a small request can never slip
      // between another request's frames.
      this.writeRequest(message, messageId, signal).catch(err => {
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

  /**
   * Static capability descriptor for the subprocess backend.
   *
   * Per the {@link Transport.capabilities} contract this is lifecycle-independent
   * (safe before `init()` / after `dispose()`) and never makes a Python round
   * trip. Subprocess carries Arrow IPC and arbitrary binary (bytes envelopes)
   * over the JSONL stream. `supportsChunking` reports the *configured* capability
   * — `this.enableChunking`, i.e. whether this transport is set up to use the
   * `tywrap-frame/1` framing path — exactly as `supportsArrow` reports a static
   * channel capability rather than a runtime fact. Whether the *connected* bridge
   * actually advertised framing is the negotiated fact, surfaced separately on
   * `BridgeInfo.transport.supportsChunking`; "will chunking actually happen"
   * needs both `true`. `supportsStreaming` stays `false` (0.8.0). `maxFrameBytes`
   * is the configured JSONL line-length limit — the largest single (unchunked)
   * response line this transport accepts.
   */
  capabilities(): TransportCapabilities {
    return {
      backend: 'subprocess',
      supportsArrow: true,
      supportsBinary: true,
      supportsChunking: this.enableChunking,
      supportsStreaming: false,
      maxFrameBytes: this.maxLineLength,
    };
  }

  // ===========================================================================
  // BOUNDED CONTEXT LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the transport by spawning the Python process and, when chunking
   * is enabled, negotiating `tywrap-frame/1` via a small unchunked `meta` probe.
   */
  protected async doInit(): Promise<void> {
    await this.spawnProcess();
    if (this.enableChunking) {
      await this.negotiateChunking();
    }
  }

  /**
   * Probe the freshly-spawned bridge for `tywrap-frame/1` support.
   *
   * Sends a small unchunked `meta` request directly over stdin (NOT via the
   * public {@link send}, which would re-enter init while we are mid-init) and
   * reads the single-line response. If the bridge reports
   * `transport.supportsChunking: true`, response reassembly is enabled. If the
   * bridge does not advertise chunking (old bridge, or it disabled framing), the
   * transport stays single-frame and an oversize response still fails loud — no
   * silent fallback. A probe failure leaves chunking disabled but does not fail
   * init (small calls must keep working); the loud failure is deferred to the
   * first oversize response.
   */
  private async negotiateChunking(): Promise<void> {
    const probeId = -1;
    const probeMessage = JSON.stringify({
      id: probeId,
      protocol: PROTOCOL_ID,
      method: 'meta',
      params: {},
    });

    let responseLine: string;
    try {
      responseLine = await this.sendProbe(probeId, probeMessage, NEGOTIATION_PROBE_TIMEOUT_MS);
    } catch {
      // Probe failed (slow/old bridge, transient): leave chunking off. Oversize
      // responses will fail loud at the line ceiling; small calls keep working.
      this.negotiatedChunking = false;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseLine);
    } catch {
      this.negotiatedChunking = false;
      return;
    }

    const supports = this.bridgeAdvertisesChunking(parsed);
    this.negotiatedChunking = supports;
    if (supports) {
      this.responseReassembler = new Reassembler({
        maxReassemblyBytes: this.maxReassemblyBytes,
        expectedStream: 'response',
      });
    }
  }

  /**
   * Whether a parsed `meta` response advertises `tywrap-frame/1` chunking with a
   * matching frame protocol. Defensive: any missing/mismatched field => `false`.
   */
  private bridgeAdvertisesChunking(parsed: unknown): boolean {
    if (parsed === null || typeof parsed !== 'object') {
      return false;
    }
    const result = (parsed as { result?: unknown }).result;
    if (result === null || typeof result !== 'object') {
      return false;
    }
    const transport = (result as { transport?: unknown }).transport;
    if (transport === null || typeof transport !== 'object') {
      return false;
    }
    const t = transport as {
      frameProtocol?: unknown;
      supportsChunking?: unknown;
      maxFrameBytes?: unknown;
    };
    // Match the BridgeInfo validator (rpc-client.ts): a valid framing block needs
    // the matching protocol AND a positive-integer maxFrameBytes. A bridge that
    // advertises chunking with a bogus frame ceiling is not a contract we honor.
    return (
      t.supportsChunking === true &&
      t.frameProtocol === FRAME_PROTOCOL_ID &&
      typeof t.maxFrameBytes === 'number' &&
      Number.isInteger(t.maxFrameBytes) &&
      t.maxFrameBytes > 0
    );
  }

  /**
   * Send a single in-init probe message over stdin and resolve with its raw
   * response line. Registers a pending entry keyed by `probeId` exactly like the
   * normal send path so {@link handleResponseLine} resolves it, but bypasses the
   * `isReady`/auto-init guard (we are deliberately running during `doInit`).
   */
  private sendProbe(probeId: number, message: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(probeId);
        this.timedOutRequests.mark(probeId);
        reject(new BridgeTimeoutError(`Negotiation probe timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      this.pending.set(probeId, {
        resolve: (value: string): void => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error: Error): void => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });

      this.writeToStdin(`${message}\n`).catch(err => {
        this.pending.delete(probeId);
        clearTimeout(timer);
        reject(this.classifyError(err));
      });
    });
  }

  /**
   * Dispose the transport by killing the Python process.
   */
  protected async doDispose(): Promise<void> {
    // Reject all pending requests
    const stderrTail = this.getStderrTail();
    const msg = stderrTail ? `Transport disposed. Stderr:\n${stderrTail}` : 'Transport disposed';
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
    this.timedOutRequests.clear();
    this.requestCount = 0;
    this.responseReassembler = null;
    this.negotiatedChunking = false;
    // Reset the per-request write mutex so a disposed transport starts from a
    // clean (resolved) tail if reused.
    this.writeMutex = Promise.resolve();
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

    // Advertise `tywrap-frame/1` chunked transport so the bridge fragments
    // oversize responses. maxFrameBytes is the JSONL line ceiling: the bridge
    // caps each frame's *data slice* at this many UTF-8 bytes, and the TS reader
    // (see the frame-aware line ceiling) allows for the JSON envelope + escaping
    // on top of it. Spread (rather than dynamic index assignment) keeps the
    // computed keys off ESLint's object-injection sink. See
    // docs/transport-framing.md.
    const chunkingEnv: NodeJS.ProcessEnv = this.enableChunking
      ? {
          [ENV_CHUNKING]: '1',
          [ENV_FRAME_PROTOCOL]: FRAME_PROTOCOL_ID,
          [ENV_MAX_FRAME_BYTES]: String(this.maxLineLength),
        }
      : {};

    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      ...chunkingEnv,
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
    // Drop any partial reassembly + discard tracking: the new process owns a
    // fresh stdout stream, so stale per-id state from the dead process must not
    // leak across the restart boundary.
    this.responseReassembler = null;
    this.negotiatedChunking = false;
    // The new process owns a fresh stdin stream; reset the write mutex so a
    // pending frame burst against the dead process cannot serialize behind it.
    this.writeMutex = Promise.resolve();

    // Spawn new process and re-negotiate framing against the fresh bridge.
    await this.spawnProcess();
    if (this.enableChunking) {
      await this.negotiateChunking();
    }
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
   * Effective stdout line ceiling.
   *
   * Without chunking it is exactly {@link maxLineLength} (legacy behavior). With
   * chunking negotiated, a single wire line is a `tywrap-frame/1` envelope whose
   * `data` slice is capped at `maxLineLength` UTF-8 bytes by the bridge, but the
   * JSON envelope adds escaping (`"`/`\`) plus fixed keys; the ceiling is widened
   * to bound that overhead so a legitimate frame line is never rejected while a
   * runaway/garbage line still is.
   */
  private effectiveLineCeiling(): number {
    if (!this.negotiatedChunking) {
      return this.maxLineLength;
    }
    return this.maxLineLength * FRAME_DATA_ESCAPE_FACTOR + FRAME_ENVELOPE_HEADROOM;
  }

  /**
   * Handle stdout data from the Python process.
   */
  private handleStdoutData(chunk: Buffer | string): void {
    this.stdoutBuffer += chunk.toString();

    const ceiling = this.effectiveLineCeiling();

    // Check for excessive line length without newline
    if (this.stdoutBuffer.length > ceiling && !this.stdoutBuffer.includes('\n')) {
      const snippet = this.stdoutBuffer.slice(0, 500);
      this.stdoutBuffer = '';
      this.handleProtocolError(`Response line exceeded ${ceiling} bytes`, snippet);
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
      if (line.length > ceiling) {
        const snippet = line.slice(0, 500);
        this.handleProtocolError(`Response line exceeded ${ceiling} bytes`, snippet);
        return;
      }

      this.handleResponseLine(line);
    }
  }

  /**
   * Handle a complete response line from stdout.
   *
   * When chunking is negotiated, a line may be a `tywrap-frame/1` envelope: it is
   * routed into the per-id {@link Reassembler}, which returns the reassembled
   * logical response only once the stream is complete and valid. Single-line
   * (non-frame) responses keep the original fast path unchanged.
   */
  private handleResponseLine(line: string): void {
    if (this.negotiatedChunking && this.responseReassembler) {
      const probe = probeFrameLine(line);
      if (probe.kind === 'frame') {
        this.handleResponseFrame(probe.value, line);
        return;
      }
      // probe.kind 'plain'/'invalid' falls through to the legacy single-line
      // path below, which extracts the id and validates JSON as before.
    }

    // Extract ID to find pending request
    const messageId = extractMessageId(line);
    if (messageId === null) {
      this.handleProtocolError('Response missing "id" field', line);
      return;
    }

    const pending = this.pending.get(messageId);
    if (!pending) {
      // Ignore expected late responses from timed-out/cancelled requests.
      if (this.timedOutRequests.consume(messageId)) {
        return;
      }
      // Unknown IDs while requests are pending indicate protocol desync.
      this.handleProtocolError(`Unexpected response id ${messageId}`, line);
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
   * Route one `tywrap-frame/1` response frame into the reassembler.
   *
   * On completion the reassembled logical line resolves the pending request. The
   * reassembler validates structure, ordering, byte count, and UTF-8 internally
   * and throws on any framing violation (malformed/duplicate/byte-mismatch/
   * unknown-protocol) — those reject the pending id and mark the subprocess for
   * restart, since stdout can no longer be trusted to be frame-aligned. Frames
   * for a timed-out/aborted id are silently discarded by the reassembler (it
   * returns `null` and tracks the discard set) so late multi-frame responses
   * cannot desync the stream.
   */
  private handleResponseFrame(rawFrame: unknown, line: string): void {
    const reassembler = this.responseReassembler;
    if (!reassembler) {
      // Unreachable: only called when negotiatedChunking && reassembler set.
      this.handleProtocolError('Received frame with no reassembler', line);
      return;
    }

    const frameId = (rawFrame as { id?: unknown }).id;

    let reassembled: string | null;
    try {
      reassembled = reassembler.accept(rawFrame);
    } catch (err) {
      // Framing corruption: stdout is no longer frame-aligned. Reject the
      // correlated pending request (if any) and force a restart.
      const message = err instanceof Error ? err.message : String(err);
      this.rejectFrameId(frameId, `Frame reassembly failed: ${message}`, line);
      this.markForRestart();
      return;
    }

    if (reassembled === null) {
      // More frames needed, or this frame belonged to a discarded (timed-out)
      // id and was dropped. Either way: nothing to resolve yet.
      return;
    }

    // Stream complete: resolve the correlated pending request with the single
    // logical response line. extractMessageId is reused so the resolution path
    // matches the non-chunked case exactly.
    this.handleResponseLine(reassembled);
  }

  /**
   * Reject the pending request correlated to a frame id, if one exists.
   *
   * Used when frame reassembly throws. If the id is unknown (e.g. it already
   * timed out and was dropped from `pending`), the error still surfaces as a
   * protocol error so the desync is not swallowed silently.
   */
  private rejectFrameId(frameId: unknown, details: string, line: string): void {
    if (typeof frameId === 'number' && Number.isInteger(frameId)) {
      const pending = this.pending.get(frameId);
      if (pending) {
        this.pending.delete(frameId);
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        pending.reject(new BridgeProtocolError(this.withStderrTail(details)));
        return;
      }
    }
    // No correlated pending request: still a protocol-level desync.
    this.handleProtocolError(details, line);
  }

  /**
   * Handle stderr data from the Python process.
   */
  private handleStderrData(chunk: Buffer | string): void {
    try {
      this.stderrBuffer += sanitizeStderr(chunk.toString());

      // Keep only the tail
      if (this.stderrBuffer.length > MAX_STDERR_BYTES) {
        this.stderrBuffer = this.stderrBuffer.slice(this.stderrBuffer.length - MAX_STDERR_BYTES);
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
    const error = new BridgeProtocolError(this.withStderrTail(`stdin error: ${err.message}`));

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
    const error = new BridgeProtocolError(this.withStderrTail(`stdout error: ${err.message}`));
    this.rejectAllPending(error);
    this.markForRestart();
  }

  /**
   * Handle stderr error event.
   * This can occur during pipe errors or when the process crashes.
   */
  private handleStderrError(err: Error): void {
    // Stderr errors are less critical but still indicate process health issues
    const error = new BridgeProtocolError(this.withStderrTail(`stderr error: ${err.message}`));
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
    reject: (error: Error) => void,
    isLive?: () => boolean
  ): QueuedWrite {
    const queuedAt = Date.now();
    const entry: QueuedWrite = { data, resolve, reject, queuedAt, isLive };

    // Set up timeout timer that fires if drain never happens
    entry.timeoutHandle = setTimeout(() => {
      // Remove this entry from the queue
      const index = this.writeQueue.indexOf(entry);
      if (index !== -1) {
        this.writeQueue.splice(index, 1);
        reject(
          new BridgeTimeoutError(
            `Write queue timeout: entry waited ${this.writeQueueTimeoutMs}ms without drain`
          )
        );
      }
    }, this.writeQueueTimeoutMs);

    // Unref the timer so it doesn't keep the process alive (best-effort for non-Node runtimes)
    if (typeof entry.timeoutHandle.unref === 'function') {
      entry.timeoutHandle.unref();
    }

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
  private writeToStdin(data: string, isLive?: () => boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.process?.stdin || this.processExited) {
        reject(new BridgeProtocolError(this.withStderrTail('Process stdin not available')));
        return;
      }

      if (this.draining || this.writeQueue.length > 0) {
        // Queue the write with timestamp, timeout timer, and liveness predicate
        // (checked again at flush — see processQueuedWrite).
        this.writeQueue.push(this.createQueuedWrite(data, resolve, reject, isLive));
        return;
      }

      // Skip a write whose request was abandoned (timed out/aborted) before it
      // reached stdin — never execute an operation the caller gave up on.
      if (isLive && !isLive()) {
        resolve();
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
   * Write one logical request to stdin, fragmenting it into `tywrap-frame/1`
   * request frames when chunking is negotiated and the encoded request exceeds
   * the per-frame ceiling (W5 — the mirror of W4's response chunking).
   *
   * Both the chunked and single-line paths run under {@link writeMutex} so a
   * logical request's bytes (one line, or a burst of frames) reach stdin
   * contiguously: a small request issued concurrently can never interleave
   * between another request's frames, which would desync the Python
   * reassembler (it correlates frames by id, but the JSONL stream itself must
   * stay frame-aligned). The mutex tail is advanced regardless of success so a
   * failed write never wedges every subsequent request.
   *
   * @param message - the encoded logical JSON request (no trailing newline)
   * @param messageId - the request's correlation id (already validated integer)
   * @param signal - optional abort signal; an abort observed between frames
   *   stops further frames and rejects this send (the pending entry is rejected
   *   by the abort handler / the caller's `.catch`).
   */
  private writeRequest(message: string, messageId: number, signal?: AbortSignal): Promise<void> {
    // The request is "live" only while its pending entry exists (the timeout and
    // abort handlers delete it) and the signal is not aborted. Gating EVERY write
    // point on this — the run closure, the direct stdin write, the backpressure
    // queue flush, and each chunked frame — prevents an abandoned request from
    // executing on Python, even one whose write sat queued under backpressure
    // past the cancellation.
    const isLive = (): boolean => !signal?.aborted && this.pending.has(messageId);
    const run = (): Promise<void> => {
      if (!isLive()) {
        return Promise.resolve();
      }
      // Only chunk when chunking was negotiated AND the encoded request exceeds
      // the negotiated per-frame ceiling. Otherwise: one JSONL line, unchanged.
      if (this.negotiatedChunking && utf8ByteLength(message) > this.maxLineLength) {
        return this.writeChunkedRequest(message, messageId, signal, isLive);
      }
      return this.writeToStdin(`${message}\n`, isLive);
    };

    // Serialize the whole logical write onto the mutex tail. We chain the next
    // tail off the settled (caught) result so one failed/aborted write does not
    // poison the chain for later requests.
    const result = this.writeMutex.then(run);
    this.writeMutex = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /**
   * Fragment a logical request into `tywrap-frame/1` request frames and write
   * them contiguously (one JSONL line per frame). Runs while holding the write
   * mutex (see {@link writeRequest}), so no other write interleaves.
   *
   * Each frame is awaited in turn so backpressure on stdin is respected. Before
   * every frame the abort signal and process liveness are re-checked: an abort
   * mid-burst stops the remaining frames and rejects the send LOUD (the Python
   * reassembler drops the now-incomplete id when the next request's frames /
   * timeout arrive, exactly as the response side handles a discarded id).
   */
  private async writeChunkedRequest(
    message: string,
    messageId: number,
    signal?: AbortSignal,
    isLive?: () => boolean
  ): Promise<void> {
    const frames = encodeFrames(message, {
      id: messageId,
      stream: 'request',
      maxFrameBytes: this.maxLineLength,
    });

    for (const frame of frames) {
      // Stop the burst if the caller aborted, the request was abandoned (timed
      // out -> pending deleted, caught by isLive), or the process died between
      // frames. A partial request stream is dropped by the Python reassembler.
      if (signal?.aborted || (isLive && !isLive())) {
        throw new BridgeTimeoutError('Operation aborted');
      }
      if (this.processExited || !this.process) {
        throw new BridgeProtocolError(this.withStderrTail('Process stdin not available'));
      }
      // One frame per JSONL line; await each so stdin backpressure is honored.
      // isLive gates a frame that ends up queued under backpressure past a late
      // cancellation, so an abandoned chunked request never completes on Python.
      await this.writeToStdin(`${JSON.stringify(frame)}\n`, isLive);
    }
  }

  /**
   * Reject and clear every entry currently in the write queue.
   * Clears each entry's timeout before rejecting so no late timer fires.
   */
  private rejectAllQueuedWrites(error: Error): void {
    for (const q of this.writeQueue) {
      this.clearQueuedWriteTimeout(q);
      q.reject(error);
    }
    this.writeQueue.length = 0;
  }

  /**
   * Process a single dequeued write entry: enforce the fallback queue timeout,
   * then attempt the stdin write. The returned status tells {@link flushWriteQueue}
   * how to proceed:
   * - `'continue'`: entry settled (written or timed out); process the next entry.
   * - `'backpressure'`: write accepted but stream is full; pause until the next drain.
   * - `'error'`: synchronous write failure; the caller must reject the remaining queue.
   *
   * The entry's own timeout must already be cleared by the caller before this runs.
   */
  private processQueuedWrite(
    queued: QueuedWrite,
    stdin: Writable,
    now: number
  ): 'continue' | 'backpressure' | 'error' {
    // Check for write queue timeout (fallback check, timer should have handled this)
    if (now - queued.queuedAt > this.writeQueueTimeoutMs) {
      queued.reject(
        new BridgeTimeoutError(
          `Write queue timeout: entry waited ${now - queued.queuedAt}ms (limit: ${this.writeQueueTimeoutMs}ms)`
        )
      );
      return 'continue';
    }

    // Skip the write if the request was abandoned (timed out/aborted) while it
    // sat in the backpressure queue — never execute an operation the caller gave
    // up on. Resolve as a no-op so the mutex chain stays healthy.
    if (queued.isLive && !queued.isLive()) {
      queued.resolve();
      return 'continue';
    }

    try {
      const canWrite = stdin.write(queued.data);

      if (canWrite) {
        queued.resolve();
        return 'continue';
      }

      // Backpressure - this write has been accepted by stream buffer.
      // Pause further queued writes until the next "drain" event.
      queued.resolve();
      this.draining = true;
      return 'backpressure';
    } catch (err) {
      // Synchronous write error (e.g., EPIPE) - reject this entry; caller rejects the rest.
      const errorMessage = err instanceof Error ? err.message : 'unknown';
      const error = new BridgeProtocolError(this.withStderrTail(`Write error: ${errorMessage}`));
      queued.reject(error);
      this.rejectAllQueuedWrites(error);
      this.markForRestart();
      return 'error';
    }
  }

  /**
   * Flush queued writes when backpressure clears.
   */
  private flushWriteQueue(): void {
    const now = Date.now();

    while (this.writeQueue.length > 0 && !this.draining) {
      const stdin = this.process?.stdin;
      if (!stdin || this.processExited) {
        // Process died - reject all queued writes
        this.rejectAllQueuedWrites(
          new BridgeProtocolError(this.withStderrTail('Process stdin not available'))
        );
        this.markForRestart();
        return;
      }

      const queued = this.writeQueue.shift();
      if (!queued) {
        return;
      }

      // Clear the timeout since we're processing this entry now
      this.clearQueuedWriteTimeout(queued);

      const status = this.processQueuedWrite(queued, stdin, now);
      if (status === 'backpressure' || status === 'error') {
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
   * Handle a protocol error by rejecting all pending requests and marking the
   * subprocess for restart.
   *
   * Every caller represents genuine stdout-stream corruption (a too-long line, a
   * response with no `id`, a frame with no reassembler, or a truly unexpected id
   * — benign late responses from timed-out requests are already filtered upstream
   * via {@link timedOutRequests}). After such an error stdout can no longer be
   * trusted to be line/frame-aligned, so the process is marked for restart —
   * matching the frame-reassembly-corruption path and the framing spec.
   */
  private handleProtocolError(details: string, line?: string): void {
    const snippet = line ? (line.length > 500 ? `${line.slice(0, 500)}...` : line) : undefined;

    const hint = 'Ensure Python code does not print to stdout and bridge outputs only JSON lines.';

    const msg = snippet
      ? `Protocol error: ${details}\n${hint}\nOffending line: ${snippet}`
      : `Protocol error: ${details}\n${hint}`;

    const error = new BridgeProtocolError(msg);
    this.rejectAllPending(error);
    this.markForRestart();
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
