/**
 * Node.js runtime bridge (minimal MVP)
 */

import { decodeValueAsync } from '../utils/codec.js';

import { RuntimeBridge } from './base.js';

interface RpcRequest {
  id: number;
  method: 'call' | 'instantiate';
  params: unknown;
}

interface RpcResponse<T = unknown> {
  id: number;
  result?: T;
  error?: { type: string; message: string; traceback?: string };
}

export interface NodeBridgeOptions {
  pythonPath?: string;
  scriptPath?: string; // path to python_bridge.py
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

export class NodeBridge extends RuntimeBridge {
  private child?: import('child_process').ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer?: NodeJS.Timeout }
  >();
  private readonly options: Required<NodeBridgeOptions>;
  private stderrBuffer = '';

  constructor(options: NodeBridgeOptions = {}) {
    super();
    this.options = {
      pythonPath: options.pythonPath ?? 'python3',
      scriptPath: options.scriptPath ?? 'runtime/python_bridge.py',
      cwd: options.cwd ?? process.cwd(),
      timeoutMs: options.timeoutMs ?? 30000,
      enableJsonFallback: options.enableJsonFallback ?? false,
      env: options.env ?? {},
    };
  }

  async init(): Promise<void> {
    if (this.child) {
      return;
    }
    const { spawn } = await import('child_process');
    const allowedPrefixes = ['TYWRAP_'];
    const allowedKeys = new Set(['PATH', 'PYTHONPATH']);
    const baseEnv: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (allowedKeys.has(k) || allowedPrefixes.some((p) => k.startsWith(p))) {
        baseEnv[k] = v;
      }
    }
    const env: NodeJS.ProcessEnv = { ...baseEnv, ...this.options.env };
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
      throw new Error(`Failed to start Python process: ${(err as Error).message}`);
    }

    const startupError = await new Promise<Error | null>((resolve) => {
      child.once('error', (e) => resolve(e));
      child.once('spawn', () => resolve(null));
    });
    if (startupError) {
      throw new Error(`Failed to start Python process: ${startupError.message}`);
    }

    this.child = child;

    this.child?.on('error', (err) => {
      const msg = `Python process error: ${err instanceof Error ? err.message : String(err)}`;
      for (const [, p] of this.pending) {
        p.reject(new Error(msg));
      }
      this.pending.clear();
      this.child = undefined;
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
            const pending = this.pending.get(msg.id);
            if (pending) {
              this.pending.delete(msg.id);
              if (pending.timer) {
                clearTimeout(pending.timer);
              }
              if (msg.error) {
                pending.reject(this.errorFrom(msg.error));
              } else {
                const decoded = await decodeValueAsync(msg.result);
                pending.resolve(decoded);
              }
            }
          } catch {
            // ignore invalid lines
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
        p.reject(new Error(msg));
      }
      this.pending.clear();
      this.child = undefined;
    });
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

  async dispose(): Promise<void> {
    if (!this.child) {
      return;
    }
    this.child.kill('SIGTERM');
    this.child = undefined;
  }

  private async send<T>(payload: Omit<RpcRequest, 'id'>): Promise<T> {
    const id = this.nextId++;
    const message: RpcRequest = { id, ...payload } as RpcRequest;
    const text = `${JSON.stringify(message)}\n`;
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id);
        const stderrTail = this.stderrBuffer.trim();
        const msg = stderrTail
          ? `Python call timed out. Recent stderr from Python:\n${stderrTail}`
          : 'Python call timed out';
        reject(new Error(msg));
      }, this.options.timeoutMs);
      const resolveWrapped = (v: unknown): void => {
        resolve(v as T);
      };
      this.pending.set(id, { resolve: resolveWrapped, reject, timer });
    });
    try {
      if (!this.child?.stdin) {
        throw new Error('Python process not available');
      }
      this.child.stdin.write(text);
    } catch (err) {
      this.pending.delete(id);
      if (timer) {
        clearTimeout(timer);
      }
      throw new Error(`IPC failure: ${(err as Error).message}`);
    }
    return promise;
  }

  private errorFrom(err: { type: string; message: string; traceback?: string }): Error {
    const e = new Error(`${err.type}: ${err.message}`);
    (e as Error & { traceback?: string }).traceback = err.traceback;
    return e;
  }
}
