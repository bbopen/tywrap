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
import { BridgeDisposedError, BridgeProtocolError } from './errors.js';
import {
  BridgeCore,
  type RpcRequest,
  ensureJsonFallback,
  ensurePythonEncoding,
  getMaxLineLengthFromEnv,
  getPathKey,
  normalizeEnv,
  validateBridgeInfo,
} from './bridge-core.js';

export interface NodeBridgeOptions {
  pythonPath?: string;
  scriptPath?: string; // path to python_bridge.py
  virtualEnv?: string;
  cwd?: string;
  timeoutMs?: number;
  maxLineLength?: number;
  inheritProcessEnv?: boolean;
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
  maxLineLength?: number;
  inheritProcessEnv: boolean;
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
  private core?: BridgeCore;
  private readonly options: ResolvedNodeBridgeOptions;
  private disposed = false;
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
      maxLineLength: options.maxLineLength,
      inheritProcessEnv: options.inheritProcessEnv ?? false,
      enableJsonFallback: options.enableJsonFallback ?? false,
      env: options.env ?? {},
    };
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
    this.core?.handleProcessExit();
    this.resetProcess();
  }

  private async send<T>(payload: Omit<RpcRequest, 'id' | 'protocol'>): Promise<T> {
    if (this.disposed) {
      throw new BridgeDisposedError('Bridge has been disposed');
    }
    if (!this.core) {
      throw new BridgeProtocolError('Python process not available');
    }
    return this.core.send<T>(payload);
  }

  private async startProcess(): Promise<void> {
    try {
      const require = createRequire(import.meta.url);
      await autoRegisterArrowDecoder({
        loader: () => require('apache-arrow'),
      });
      const { spawn } = await import('child_process');

      const env = this.buildEnv();
      const maxLineLength = this.options.maxLineLength ?? getMaxLineLengthFromEnv(env);

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
      this.core = new BridgeCore(
        {
          write: (data: string): void => {
            if (!this.child?.stdin) {
              throw new BridgeProtocolError('Python process not available');
            }
            this.child.stdin.write(data);
          },
        },
        {
          timeoutMs: this.options.timeoutMs,
          maxLineLength,
          decodeValue: decodeValueAsync,
          onFatalError: (): void => this.resetProcess(),
        }
      );

      this.child.stdout?.on('data', chunk => {
        this.core?.handleStdoutData(chunk);
      });

      this.child.stderr?.on('data', chunk => {
        this.core?.handleStderrData(chunk);
      });

      this.child.on('error', err => {
        this.core?.handleProcessError(err);
      });

      this.child.on('exit', () => {
        this.core?.handleProcessExit();
        this.resetProcess();
      });

      await this.refreshBridgeInfo();
    } catch (err) {
      this.resetProcess();
      throw err;
    }
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const allowedPrefixes = ['TYWRAP_'];
    const allowedKeys = new Set(['path', 'pythonpath', 'virtual_env', 'pythonhome']);
    const baseEnv: Record<string, string | undefined> = {};
    if (this.options.inheritProcessEnv) {
      for (const [key, value] of Object.entries(process.env)) {
        // eslint-disable-next-line security/detect-object-injection -- env keys are dynamic by design
        baseEnv[key] = value;
      }
    } else {
      for (const [key, value] of Object.entries(process.env)) {
        if (
          allowedKeys.has(key.toLowerCase()) ||
          allowedPrefixes.some(prefix => key.startsWith(prefix))
        ) {
          // eslint-disable-next-line security/detect-object-injection -- env keys are dynamic by design
          baseEnv[key] = value;
        }
      }
    }

    let env = normalizeEnv(baseEnv, this.options.env);

    if (this.options.virtualEnv) {
      const venv = resolveVirtualEnv(this.options.virtualEnv, this.options.cwd);
      env.VIRTUAL_ENV = venv.venvPath;
      const pathKey = getPathKey(env);
      // eslint-disable-next-line security/detect-object-injection -- env keys are dynamic by design
      const currentPath = env[pathKey] ?? '';
      // eslint-disable-next-line security/detect-object-injection -- env keys are dynamic by design
      env[pathKey] = `${venv.binDir}${delimiter}${currentPath}`;
    }

    ensurePythonEncoding(env);
    // Respect explicit request for JSON fallback only; otherwise fast-fail by default
    ensureJsonFallback(env, this.options.enableJsonFallback);

    env = normalizeEnv(env, {});
    return env;
  }

  private resetProcess(): void {
    this.core?.clear();
    this.core = undefined;
    if (this.child) {
      try {
        if (this.child.exitCode === null) {
          this.child.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    }
    this.child = undefined;
    this.initPromise = undefined;
    this.bridgeInfo = undefined;
  }

  private async refreshBridgeInfo(): Promise<void> {
    const info = await this.send<BridgeInfo>({ method: 'meta', params: {} });
    validateBridgeInfo(info);
    this.bridgeInfo = info;
  }
}
