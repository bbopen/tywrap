/**
 * Node.js runtime bridge (minimal MVP)
 */

import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { autoRegisterArrowDecoder, decodeValueAsync } from '../utils/codec.js';
import { getDefaultPythonPath } from '../utils/python.js';
import { getVenvBinDir, getVenvPythonExe } from '../utils/runtime.js';
import type { BridgeInfo } from '../types/index.js';

import { RuntimeBridge } from './base.js';
import {
  BridgeDisposedError,
  BridgeExecutionError,
  BridgeProtocolError,
  BridgeTimeoutError,
} from './errors.js';
import { TYWRAP_PROTOCOL, TYWRAP_PROTOCOL_VERSION } from './protocol.js';
import { TimedOutRequestTracker } from './timed-out-request-tracker.js';

interface RpcRequest {
  id: number;
  protocol: string;
  method: 'call' | 'instantiate' | 'call_method' | 'dispose_instance' | 'meta';
  params: unknown;
}

interface RpcResponse<T = unknown> {
  id: number;
  protocol: string;
  result?: T;
  error?: { type: string; message: string; traceback?: string };
}

export interface NodeBridgeOptions {
  pythonPath?: string;
  scriptPath?: string; // path to python_bridge.py
  virtualEnv?: string;
  cwd?: string;
  timeoutMs?: number;
  /**
   * When true, sets TYWRAP_CODEC_FALLBACK=json for the Python process to prefer JSON encoding
   * for rich types (ndarray/dataframe/series). Default: false for fast-fail on Arrow path issues.
   */
  enableJsonFallback?: boolean;
  /**
   * Optional extra environment variables to pass to the Python subprocess.
   */
  env?: Record<string, string | undefined>;
}

interface ResolvedNodeBridgeOptions {
  pythonPath: string;
  scriptPath: string;
  virtualEnv?: string;
  cwd: string;
  timeoutMs: number;
  enableJsonFallback: boolean;
  env: Record<string, string | undefined>;
}

function resolveDefaultScriptPath(): string {
  try {
    return fileURLToPath(new URL('../../runtime/python_bridge.py', import.meta.url));
  } catch {
    return 'runtime/python_bridge.py';
  }
}

function resolveVirtualEnv(
  virtualEnv: string,
  cwd: string
): {
  venvPath: string;
  binDir: string;
  pythonPath: string;
} {
  const venvPath = resolve(cwd, virtualEnv);
  const binDir = join(venvPath, getVenvBinDir());
  const pythonPath = join(binDir, getVenvPythonExe());
  return { venvPath, binDir, pythonPath };
}

export class NodeBridge extends RuntimeBridge {
  private child?: import('child_process').ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer?: NodeJS.Timeout }
  >();
  private readonly timedOutRequests: TimedOutRequestTracker;
  private readonly options: ResolvedNodeBridgeOptions;
  private stderrBuffer = '';
  private disposed = false;
  private protocolError = false;
  private initPromise?: Promise<void>;
  private bridgeInfo?: BridgeInfo;

  constructor(options: NodeBridgeOptions = {}) {
    super();
    const cwd = options.cwd ?? process.cwd();
    const virtualEnv = options.virtualEnv ? resolve(cwd, options.virtualEnv) : undefined;
    const venv = virtualEnv ? resolveVirtualEnv(virtualEnv, cwd) : undefined;
    const scriptPath = options.scriptPath ?? resolveDefaultScriptPath();
    const resolvedScriptPath = isAbsolute(scriptPath) ? scriptPath : resolve(cwd, scriptPath);
    this.options = {
      pythonPath: options.pythonPath ?? venv?.pythonPath ?? getDefaultPythonPath(),
      scriptPath: resolvedScriptPath,
      virtualEnv,
      cwd,
      timeoutMs: options.timeoutMs ?? 30000,
      enableJsonFallback: options.enableJsonFallback ?? false,
      env: options.env ?? {},
    };
    this.timedOutRequests = new TimedOutRequestTracker({
      ttlMs: Math.max(1000, this.options.timeoutMs * 2),
    });
  }

  async init(): Promise<void> {
    if (this.disposed) {
      throw new BridgeDisposedError('Bridge has been disposed');
    }
    if (this.child) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- script path is user-configured
    if (!existsSync(this.options.scriptPath)) {
      throw new BridgeProtocolError(`Python bridge script not found at ${this.options.scriptPath}`);
    }
    this.initPromise = this.startProcess();
    return this.initPromise;
  }

  async getBridgeInfo(options: { refresh?: boolean } = {}): Promise<BridgeInfo> {
    await this.init();
    if (!this.bridgeInfo || options.refresh) {
      await this.refreshBridgeInfo();
    }
    if (!this.bridgeInfo) {
      throw new BridgeProtocolError('Bridge info unavailable');
    }
    return this.bridgeInfo;
  }

  async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.init();
    return this.send<T>({ method: 'call', params: { module, functionName, args, kwargs } });
  }

  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.init();
    return this.send<T>({ method: 'instantiate', params: { module, className, args, kwargs } });
  }

  async callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.init();
    return this.send<T>({ method: 'call_method', params: { handle, methodName, args, kwargs } });
  }

  async disposeInstance(handle: string): Promise<void> {
    await this.init();
    await this.send<void>({ method: 'dispose_instance', params: { handle } });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.initPromise = undefined;
    this.bridgeInfo = undefined;
    this.timedOutRequests.clear();
    if (!this.child) {
      return;
    }
    this.child.kill('SIGTERM');
    this.child = undefined;
  }

  private async send<T>(payload: Omit<RpcRequest, 'id' | 'protocol'>): Promise<T> {
    if (this.disposed) {
      throw new BridgeDisposedError('Bridge has been disposed');
    }
    const id = this.nextId++;
    const message: RpcRequest = { id, protocol: TYWRAP_PROTOCOL, ...payload } as RpcRequest;
    const text = `${JSON.stringify(message)}\n`;
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<T>((resolvePromise, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id);
        this.markTimedOutRequest(id);
        const stderrTail = this.stderrBuffer.trim();
        const msg = stderrTail
          ? `Python call timed out. Recent stderr from Python:\n${stderrTail}`
          : 'Python call timed out';
        reject(new BridgeTimeoutError(msg));
      }, this.options.timeoutMs);
      const resolveWrapped = (v: unknown): void => {
        resolvePromise(v as T);
      };
      this.pending.set(id, { resolve: resolveWrapped, reject, timer });
    });
    try {
      if (!this.child?.stdin) {
        throw new BridgeProtocolError('Python process not available');
      }
      this.child.stdin.write(text);
    } catch (err) {
      this.pending.delete(id);
      if (timer) {
        clearTimeout(timer);
      }
      throw new BridgeProtocolError(`IPC failure: ${(err as Error).message}`);
    }
    return promise;
  }

  private errorFrom(err: { type: string; message: string; traceback?: string }): Error {
    const e = new BridgeExecutionError(`${err.type}: ${err.message}`);
    e.traceback = err.traceback;
    return e;
  }

  private handleProtocolError(details: string, line?: string): void {
    if (this.protocolError) {
      return;
    }
    this.protocolError = true;
    const snippet = line ? (line.length > 500 ? `${line.slice(0, 500)}…` : line) : undefined;
    const hint =
      'Ensure your Python code does not print to stdout and that the bridge outputs only JSON lines.';
    const msg = snippet
      ? `Protocol error from Python bridge. ${details}\n${hint}\nOffending line: ${snippet}`
      : `Protocol error from Python bridge. ${details}\n${hint}`;
    const error = new BridgeProtocolError(msg);
    for (const [, p] of this.pending) {
      p.reject(error);
    }
    this.pending.clear();
    this.timedOutRequests.clear();
    this.child?.kill('SIGTERM');
    this.child = undefined;
    this.initPromise = undefined;
    this.bridgeInfo = undefined;
  }

  private markTimedOutRequest(id: number): void {
    this.timedOutRequests.mark(id);
  }

  private consumeTimedOutRequest(id: number): boolean {
    return this.timedOutRequests.consume(id);
  }

  private async startProcess(): Promise<void> {
    try {
      const require = createRequire(import.meta.url);
      await autoRegisterArrowDecoder({
        loader: async () => require('apache-arrow'),
      });
      const { spawn } = await import('child_process');
      const allowedPrefixes = ['TYWRAP_'];
      const allowedKeys = new Set(['PATH', 'PYTHONPATH', 'VIRTUAL_ENV', 'PYTHONHOME']);
      const baseEnv = new Map<string, string | undefined>();
      for (const [k, v] of Object.entries(process.env)) {
        if (allowedKeys.has(k) || allowedPrefixes.some(p => k.startsWith(p))) {
          baseEnv.set(k, v);
        }
      }
      const env: NodeJS.ProcessEnv = {
        ...(Object.fromEntries(baseEnv) as NodeJS.ProcessEnv),
        ...this.options.env,
      };
      if (this.options.virtualEnv) {
        const venv = resolveVirtualEnv(this.options.virtualEnv, this.options.cwd);
        env.VIRTUAL_ENV = venv.venvPath;
        const currentPath = env.PATH ?? process.env.PATH ?? '';
        env.PATH = `${venv.binDir}${delimiter}${currentPath}`;
      }
      if (!env.PYTHONUTF8) {
        env.PYTHONUTF8 = '1';
      }
      if (!env.PYTHONIOENCODING) {
        env.PYTHONIOENCODING = 'UTF-8';
      }
      // Respect explicit request for JSON fallback only; otherwise fast-fail by default
      if (this.options.enableJsonFallback && !env.TYWRAP_CODEC_FALLBACK) {
        env.TYWRAP_CODEC_FALLBACK = 'json';
      }

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(this.options.pythonPath, [this.options.scriptPath], {
          cwd: this.options.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });
      } catch (err) {
        throw new BridgeProtocolError(`Failed to start Python process: ${(err as Error).message}`);
      }

      const startupError = await new Promise<Error | null>(done => {
        child.once('error', e => done(e));
        child.once('spawn', () => done(null));
      });
      if (startupError) {
        throw new BridgeProtocolError(`Failed to start Python process: ${startupError.message}`);
      }

      this.child = child;
      this.protocolError = false;

      this.child?.on('error', err => {
        const msg = `Python process error: ${err instanceof Error ? err.message : String(err)}`;
        for (const [, p] of this.pending) {
          p.reject(new BridgeProtocolError(msg));
        }
        this.pending.clear();
        this.timedOutRequests.clear();
        this.child = undefined;
        this.initPromise = undefined;
        this.bridgeInfo = undefined;
      });

      let buffer = '';
      this.child.stdout?.on('data', (chunk: Buffer): void => {
        buffer += chunk.toString();
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) {
            continue;
          }
          (async (): Promise<void> => {
            try {
              const msg = JSON.parse(line) as RpcResponse;
              if (msg.protocol !== TYWRAP_PROTOCOL) {
                this.handleProtocolError(
                  `Invalid protocol. Expected ${TYWRAP_PROTOCOL} but received ${String(
                    msg.protocol
                  )}`,
                  line
                );
                return;
              }
              if (typeof msg.id !== 'number') {
                this.handleProtocolError('Invalid response id', line);
                return;
              }
              const pending = this.pending.get(msg.id);
              if (!pending) {
                if (this.consumeTimedOutRequest(msg.id)) {
                  return;
                }
                this.handleProtocolError(`Unexpected response id ${msg.id}`, line);
                return;
              }
              this.pending.delete(msg.id);
              if (pending.timer) {
                clearTimeout(pending.timer);
              }
              if (msg.error) {
                pending.reject(this.errorFrom(msg.error));
              } else {
                try {
                  const decoded = await decodeValueAsync(msg.result);
                  pending.resolve(decoded);
                } catch (err) {
                  pending.reject(
                    new BridgeProtocolError(
                      `Failed to decode Python response: ${
                        err instanceof Error ? err.message : String(err)
                      }`
                    )
                  );
                }
              }
            } catch (err) {
              const parseMessage = err instanceof Error ? err.message : String(err);
              this.handleProtocolError(`Invalid JSON: ${parseMessage}`, line);
            }
          })().catch(() => {
            /* ignore */
          });
        }
      });

      this.child?.stderr?.on('data', (chunk: Buffer) => {
        // Buffer stderr for better error diagnostics on failures/exits
        try {
          this.stderrBuffer += chunk.toString();
          // Truncate to last 8KB to avoid unbounded growth
          const MAX = 8 * 1024;
          if (this.stderrBuffer.length > MAX) {
            this.stderrBuffer = this.stderrBuffer.slice(this.stderrBuffer.length - MAX);
          }
        } catch {
          // ignore
        }
      });

      this.child?.on('exit', () => {
        for (const [, p] of this.pending) {
          const stderrTail = this.stderrBuffer.trim();
          const msg = stderrTail
            ? `Python process exited. Stderr:\n${stderrTail}`
            : 'Python process exited';
          p.reject(new BridgeProtocolError(msg));
        }
        this.pending.clear();
        this.timedOutRequests.clear();
        this.child = undefined;
        this.initPromise = undefined;
        this.bridgeInfo = undefined;
      });

      await this.refreshBridgeInfo();
    } catch (err) {
      this.child?.kill('SIGTERM');
      this.child = undefined;
      this.initPromise = undefined;
      throw err;
    }
  }

  private async refreshBridgeInfo(): Promise<void> {
    const info = await this.send<BridgeInfo>({ method: 'meta', params: {} });
    if (info.protocol !== TYWRAP_PROTOCOL || info.protocolVersion !== TYWRAP_PROTOCOL_VERSION) {
      throw new BridgeProtocolError('Invalid bridge info payload');
    }
    this.bridgeInfo = info;
  }
}
