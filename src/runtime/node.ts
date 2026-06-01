/**
 * Node.js runtime bridge.
 *
 * NodeBridge is a thin facade: it extends DisposableBase (lifecycle/resources)
 * and implements PythonRuntime by HOLDING an RpcClient. It uses SubprocessTransport
 * transports with optional pooling for concurrent Python execution.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { autoRegisterArrowDecoder } from '../utils/codec.js';
import { getDefaultPythonPath } from '../utils/python.js';
import { getVenvBinDir, getVenvPythonExe } from '../utils/runtime.js';
import { globalCache } from '../utils/cache.js';

import { BasePythonBridge } from './base-bridge.js';
import { RpcClient } from './rpc-client.js';
import { BridgeCodecError, BridgeExecutionError, BridgeProtocolError } from './errors.js';
import { SubprocessTransport } from './subprocess-transport.js';
import { PooledTransport } from './pooled-transport.js';
import type { CodecOptions } from './bridge-codec.js';
import type { TransportLease } from './transport-pool.js';

// =============================================================================
// OPTIONS
// =============================================================================

/**
 * Configuration options for NodeBridge.
 */
export interface NodeBridgeOptions {
  /** Minimum number of Python processes to keep alive. Default: 1 */
  minProcesses?: number;

  /** Maximum number of Python processes to spawn. Default: 1 (single-process mode) */
  maxProcesses?: number;

  /** Maximum concurrent requests per process. Default: 10 */
  maxConcurrentPerProcess?: number;

  /** Path to Python executable. Auto-detected if not specified. */
  pythonPath?: string;

  /** Path to python_bridge.py script. Auto-detected if not specified. */
  scriptPath?: string;

  /** Path to Python virtual environment. */
  virtualEnv?: string;

  /** Working directory for Python process. Default: process.cwd() */
  cwd?: string;

  /** Timeout in ms for Python calls. Default: 30000 */
  timeoutMs?: number;

  /** Timeout in ms for waiting in pool queue. Default: 30000 */
  queueTimeoutMs?: number;

  /** Inherit all environment variables from parent process. Default: false */
  inheritProcessEnv?: boolean;

  /** Enable result caching for pure functions. Default: false */
  enableCache?: boolean;

  /** Optional extra environment variables to pass to the Python subprocess. */
  env?: Record<string, string | undefined>;

  /** Codec options for validation/serialization */
  codec?: CodecOptions;

  /** Commands to run on each process at startup for warming up. */
  warmupCommands?: Array<
    { module: string; functionName: string; args?: unknown[] } | { method: string; params: unknown } // Legacy shape preserved so runtime can surface a migration error
  >;

  // ===========================================================================
  // DEPRECATED OPTIONS (kept for backwards compatibility, ignored internally)
  // ===========================================================================

  /**
   * @deprecated No longer used. Pool idle time is managed by TransportPool.
   */
  maxIdleTime?: number;

  /**
   * @deprecated No longer used. Process restart is managed by SubprocessTransport.
   */
  maxRequestsPerProcess?: number;

  /**
   * @deprecated Use codec.bytesHandling option instead.
   */
  enableJsonFallback?: boolean;

  /**
   * @deprecated Use SubprocessTransport options instead.
   */
  maxLineLength?: number;
}

// =============================================================================
// INTERNAL TYPES
// =============================================================================

interface ResolvedOptions {
  minProcesses: number;
  maxProcesses: number;
  maxConcurrentPerProcess: number;
  pythonPath: string;
  scriptPath: string;
  virtualEnv?: string;
  cwd: string;
  timeoutMs: number;
  queueTimeoutMs: number;
  inheritProcessEnv: boolean;
  enableCache: boolean;
  env: Record<string, string | undefined>;
  codec?: CodecOptions;
  warmupCommands: WarmupCommand[];
}

interface WarmupCommand {
  module: string;
  functionName: string;
  args?: unknown[];
}

const WORKER_READY_TIMEOUT_MS = 5000;

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Resolve the default bridge script path.
 */
function resolveDefaultScriptPath(): string {
  try {
    return fileURLToPath(new URL('../../runtime/python_bridge.py', import.meta.url));
  } catch {
    return 'runtime/python_bridge.py';
  }
}

/**
 * Resolve virtual environment paths.
 */
function resolveVirtualEnv(
  virtualEnv: string,
  cwd: string
): { venvPath: string; binDir: string; pythonPath: string } {
  const venvPath = resolve(cwd, virtualEnv);
  const binDir = join(venvPath, getVenvBinDir());
  const pythonPath = join(binDir, getVenvPythonExe());
  return { venvPath, binDir, pythonPath };
}

/**
 * Get the environment variable key for PATH (case-insensitive on Windows).
 */
function getPathKey(env: Record<string, string | undefined>): string {
  if (Object.prototype.hasOwnProperty.call(env, 'PATH')) {
    return 'PATH';
  }

  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') {
      return key;
    }
  }
  return 'PATH';
}

function setPathValue(env: Record<string, string>, value: string): void {
  setEnvValue(env, 'PATH', value);

  if (process.platform !== 'win32') {
    return;
  }

  for (const key of Object.keys(env)) {
    if (key !== 'PATH' && key.toLowerCase() === 'path') {
      setEnvValue(env, key, value);
    }
  }
}

const DANGEROUS_ENV_OVERRIDE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function createNullPrototypeEnv(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}

function setEnvValue(env: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(env, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function getEnvValue(env: Record<string, string>, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === 'string' ? value : undefined;
}

function assertSafeEnvOverrideKey(key: string): void {
  if (DANGEROUS_ENV_OVERRIDE_KEYS.has(key)) {
    throw new BridgeProtocolError(`Invalid environment override key "${key}" in options.env`);
  }
}

function normalizeWarmupCommands(commands: NodeBridgeOptions['warmupCommands']): WarmupCommand[] {
  if (commands === undefined) {
    return [];
  }
  if (!Array.isArray(commands)) {
    throw new BridgeProtocolError('warmupCommands must be an array when provided');
  }

  const warmups = commands;
  return warmups.map((command, index) => {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new BridgeProtocolError(
        `Invalid warmup command at index ${index + 1}: expected { module, functionName, args? }`
      );
    }

    const candidate = command as Record<string, unknown>;
    if ('method' in candidate || 'params' in candidate) {
      throw new BridgeProtocolError(
        `Invalid warmup command at index ${index + 1}: legacy { method, params } format is no longer supported. Use { module, functionName, args? }.`
      );
    }

    if (typeof candidate.module !== 'string' || candidate.module.trim().length === 0) {
      throw new BridgeProtocolError(
        `Invalid warmup command at index ${index + 1}: "module" must be a non-empty string`
      );
    }
    if (typeof candidate.functionName !== 'string' || candidate.functionName.trim().length === 0) {
      throw new BridgeProtocolError(
        `Invalid warmup command at index ${index + 1}: "functionName" must be a non-empty string`
      );
    }
    if (candidate.args !== undefined && !Array.isArray(candidate.args)) {
      throw new BridgeProtocolError(
        `Invalid warmup command at index ${index + 1}: "args" must be an array when provided`
      );
    }

    return {
      module: candidate.module,
      functionName: candidate.functionName,
      args: candidate.args as unknown[] | undefined,
    };
  });
}

// =============================================================================
// NODE BRIDGE
// =============================================================================

/**
 * Node.js runtime bridge for executing Python code.
 *
 * NodeBridge provides subprocess-based Python execution with optional pooling
 * for high-throughput workloads. By default, it runs in single-process mode.
 *
 * Features:
 * - Single or multi-process execution via process pooling
 * - Virtual environment support
 * - Full BridgeCodec validation (NaN/Infinity rejection, key validation)
 * - Automatic Arrow decoding for DataFrames/ndarrays
 * - Optional result caching for pure functions
 * - Process warmup commands
 *
 * @example
 * ```typescript
 * // Single-process mode (default)
 * const bridge = new NodeBridge();
 * await bridge.init();
 *
 * const result = await bridge.call('math', 'sqrt', [16]);
 * console.log(result); // 4.0
 *
 * await bridge.dispose();
 * ```
 *
 * @example
 * ```typescript
 * // Multi-process pooling for high throughput
 * const pooledBridge = new NodeBridge({
 *   maxProcesses: 4,
 *   maxConcurrentPerProcess: 2,
 *   enableCache: true,
 * });
 * await pooledBridge.init();
 * ```
 */
export class NodeBridge extends BasePythonBridge {
  private readonly resolvedOptions: ResolvedOptions;
  private readonly pooledTransport: PooledTransport;
  private readonly rpc: RpcClient;

  /**
   * Create a new NodeBridge instance.
   *
   * @param options - Configuration options for the bridge
   */
  constructor(options: NodeBridgeOptions = {}) {
    const cwd = options.cwd ?? process.cwd();
    const virtualEnv = options.virtualEnv ? resolve(cwd, options.virtualEnv) : undefined;
    const venv = virtualEnv ? resolveVirtualEnv(virtualEnv, cwd) : undefined;
    const scriptPath = options.scriptPath ?? resolveDefaultScriptPath();
    const resolvedScriptPath = isAbsolute(scriptPath) ? scriptPath : resolve(cwd, scriptPath);

    const maxProcesses = options.maxProcesses ?? 1;
    const minProcesses = Math.min(options.minProcesses ?? 1, maxProcesses);

    const warmupCommands = normalizeWarmupCommands(options.warmupCommands);

    const resolvedOptions: ResolvedOptions = {
      minProcesses,
      maxProcesses,
      maxConcurrentPerProcess: options.maxConcurrentPerProcess ?? 10,
      pythonPath: options.pythonPath ?? venv?.pythonPath ?? getDefaultPythonPath(),
      scriptPath: resolvedScriptPath,
      virtualEnv,
      cwd,
      timeoutMs: options.timeoutMs ?? 30000,
      queueTimeoutMs: options.queueTimeoutMs ?? 30000,
      inheritProcessEnv: options.inheritProcessEnv ?? false,
      enableCache: options.enableCache ?? false,
      env: options.env ?? {},
      codec: options.codec,
      warmupCommands,
    };
    // Build environment for SubprocessTransport
    const processEnv = buildProcessEnv(resolvedOptions);

    // Why a late-bound holder: PooledTransport copies onWorkerReady eagerly at
    // construction (before super()), but the callback needs the RpcClient, and
    // a derived constructor cannot touch `this` before super(). So the closure
    // captures a mutable holder whose .rpc is assigned right after super(). The
    // closure body only runs at worker-spawn time during init(), by which point
    // rpc is set. Warmup goes through rpc.sendOn (NOT rpc.execute): it runs
    // inside transport.init() during rpc.init(), so it must not auto-init.
    const rpcHolder: { rpc?: RpcClient } = {};
    const onWorkerReady = createWorkerReadyCallback(
      rpcHolder,
      resolvedOptions.warmupCommands,
      resolvedOptions.timeoutMs
    );

    // Create pooled transport with SubprocessTransport workers
    const transport = new PooledTransport({
      createTransport: (): SubprocessTransport =>
        new SubprocessTransport({
          pythonPath: resolvedOptions.pythonPath,
          bridgeScript: resolvedOptions.scriptPath,
          env: processEnv,
          cwd: resolvedOptions.cwd,
        }),
      maxWorkers: resolvedOptions.maxProcesses,
      minWorkers: resolvedOptions.minProcesses,
      queueTimeoutMs: resolvedOptions.queueTimeoutMs,
      maxConcurrentPerWorker: resolvedOptions.maxConcurrentPerProcess,
      onWorkerReady,
      onReplacementWorkerReady: onWorkerReady,
    });

    super();

    this.resolvedOptions = resolvedOptions;
    this.pooledTransport = transport;
    this.rpc = new RpcClient({
      transport,
      codec: resolvedOptions.codec,
      defaultTimeoutMs: resolvedOptions.timeoutMs,
    });
    // Track the RpcClient (which itself tracks the transport): one disposal
    // chain facade -> rpc -> transport, and rpc.doDispose clears its info cache.
    this.trackResource(this.rpc);

    // Publish the rpc into the holder so the warmup closure can reach it.
    rpcHolder.rpc = this.rpc;
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Initialize the bridge.
   *
   * Validates the bridge script exists, registers Arrow decoder,
   * and initializes the held RpcClient (which initializes the transport pool,
   * running warmup commands per-worker).
   */
  protected async doInit(): Promise<void> {
    // Validate script exists
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- script path is user-configured
    if (!existsSync(this.resolvedOptions.scriptPath)) {
      throw new BridgeProtocolError(
        `Python bridge script not found at ${this.resolvedOptions.scriptPath}`
      );
    }

    // Register Arrow decoder for DataFrames/ndarrays
    const require = createRequire(import.meta.url);
    await autoRegisterArrowDecoder({
      loader: () => require('apache-arrow'),
    });

    // Initialize the RpcClient (which initializes transport and runs warmup).
    await this.rpc.init();
  }

  /**
   * No facade-specific teardown: the RpcClient (and through it the transport
   * pool) is tracked as a resource and disposed automatically by DisposableBase.
   */
  protected async doDispose(): Promise<void> {
    // Intentionally empty; tracked resources handle disposal.
  }

  // ===========================================================================
  // RPC DELEGATION (the held RpcClient)
  // ===========================================================================

  /**
   * Expose the held RpcClient to BasePythonBridge's shared delegating methods
   * (instantiate/callMethod/disposeInstance/getBridgeInfo). call() is
   * overridden below to layer caching on top.
   */
  protected getRpcClient(): RpcClient {
    return this.rpc;
  }

  /**
   * Call a Python function, with optional result caching.
   *
   * Overrides BasePythonBridge.call() to layer the cache lookup/writeback on
   * top of the shared delegation. Cache lookup stays FIRST so cache hits return
   * without forcing init, preserving the pre-composition behavior.
   */
  override async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    // Check cache if enabled
    if (this.resolvedOptions.enableCache) {
      const cacheKey = this.safeCacheKey('runtime_call', module, functionName, args, kwargs);
      if (cacheKey) {
        const cached = await globalCache.get<T>(cacheKey);
        if (cached !== null) {
          return cached;
        }
      }

      // Execute and cache if pure function
      const startTime = performance.now();
      await this.ensureReady();
      const result = await this.rpc.call<T>(module, functionName, args, kwargs);
      const duration = performance.now() - startTime;

      if (cacheKey && this.isPureFunctionCandidate(functionName, args)) {
        await globalCache.set(cacheKey, result, {
          computeTime: duration,
          dependencies: [module],
        });
      }

      return result;
    }

    // No caching - direct call
    await this.ensureReady();
    return this.rpc.call<T>(module, functionName, args, kwargs);
  }

  // ===========================================================================
  // POOL STATISTICS
  // ===========================================================================

  /**
   * Get current pool statistics.
   */
  getPoolStats(): { workerCount: number; queueLength: number; totalInFlight: number } {
    return {
      workerCount: this.pooledTransport.workerCount,
      queueLength: this.pooledTransport.queueLength,
      totalInFlight: this.pooledTransport.totalInFlight,
    };
  }

  /**
   * Get bridge statistics.
   *
   * @deprecated Use getPoolStats() instead. This method is provided for
   * backwards compatibility and returns a subset of the previous stats.
   */
  getStats(): {
    totalRequests: number;
    totalTime: number;
    cacheHits: number;
    poolHits: number;
    poolMisses: number;
    processSpawns: number;
    processDeaths: number;
    memoryPeak: number;
    averageTime: number;
    cacheHitRate: number;
    poolSize: number;
    busyWorkers: number;
  } {
    const poolStats = this.getPoolStats();
    return {
      // Legacy stats (no longer tracked, return 0)
      totalRequests: 0,
      totalTime: 0,
      cacheHits: 0,
      poolHits: 0,
      poolMisses: 0,
      processSpawns: 0,
      processDeaths: 0,
      memoryPeak: 0,
      averageTime: 0,
      cacheHitRate: 0,
      // Current pool stats
      poolSize: poolStats.workerCount,
      busyWorkers: poolStats.totalInFlight,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Generate a cache key, returning null if generation fails.
   */
  private safeCacheKey(prefix: string, ...inputs: unknown[]): string | null {
    try {
      return globalCache.generateKey(prefix, ...inputs);
    } catch {
      return null;
    }
  }

  /**
   * Heuristic to determine if function result should be cached.
   */
  private isPureFunctionCandidate(functionName: string, args: unknown[]): boolean {
    const pureFunctionPatterns = [
      /^(get|fetch|read|load|find|search|query|select)_/i,
      /^(compute|calculate|process|transform|convert)_/i,
      /^(encode|decode|serialize|deserialize)_/i,
    ];

    const impureFunctionPatterns = [
      /^(set|save|write|update|insert|delete|create|modify)_/i,
      /^(send|post|put|patch)_/i,
      /random|uuid|timestamp|now|current/i,
    ];

    if (impureFunctionPatterns.some(pattern => pattern.test(functionName))) {
      return false;
    }

    if (pureFunctionPatterns.some(pattern => pattern.test(functionName))) {
      return true;
    }

    const hasComplexArgs = args.some(
      arg => arg !== null && typeof arg === 'object' && !(arg instanceof Date)
    );

    return !hasComplexArgs && args.length <= 3;
  }
}

// =============================================================================
// WARMUP CALLBACK
// =============================================================================

/**
 * Wrap an error from rpc.sendOn() with the warmup command's context label,
 * preserving the exact phrasing the warmup tests assert on. The single
 * RpcClient codec+id-counter is reused (via sendOn); only this label wrapping
 * is bespoke, and only because warmup surfaces command-specific diagnostics.
 *
 * Maps codec/protocol error shapes to the historical messages:
 * - encode failure (BridgeCodecError, e.g. BigInt) -> "failed to encode request"
 * - missing result/error envelope (BridgeProtocolError) -> "malformed response envelope"
 * - Python error (BridgeExecutionError "Type: message") -> "failed: Type: message"
 * - anything else (transport/send) -> "failed to send"
 */
function wrapWarmupError(label: string, error: unknown): BridgeExecutionError {
  const cause = error instanceof Error ? error : undefined;
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof BridgeCodecError && error.codecPhase === 'encode') {
    return new BridgeExecutionError(`${label} failed to encode request: ${message}`, { cause });
  }
  if (error instanceof BridgeProtocolError) {
    // The codec rejects an envelope that has neither "result" nor "error".
    // Distinguish that specific malformed-envelope case from transport-level
    // protocol errors (e.g. garbled stdout), whose original message must be
    // preserved so callers still see the underlying "Protocol error" text.
    if (/missing "result" or "error"/.test(message)) {
      return new BridgeExecutionError(`${label} returned malformed response envelope`, { cause });
    }
    return new BridgeExecutionError(`${label} failed to send: ${message}`, { cause });
  }
  if (error instanceof BridgeExecutionError) {
    // Python-side error already formatted as "Type: message" by the codec.
    return new BridgeExecutionError(`${label} failed: ${message}`, { cause });
  }
  return new BridgeExecutionError(`${label} failed to send: ${message}`, { cause });
}

/**
 * Build the per-worker onWorkerReady callback. It runs at worker-spawn time
 * during init(); by then rpcHolder.rpc is set (assigned right after super()).
 *
 * The callback first does a readiness `meta` probe, then runs each warmup
 * command. Both go through rpc.sendOn (raw encode/send/decode, NO auto-init)
 * so they cannot re-await the in-flight rpc.init().
 */
function createWorkerReadyCallback(
  rpcHolder: { rpc?: RpcClient },
  warmupCommands: WarmupCommand[],
  timeoutMs: number
): (worker: TransportLease) => Promise<void> {
  return async (worker: TransportLease) => {
    const rpc = rpcHolder.rpc;
    if (!rpc) {
      throw new BridgeExecutionError('Worker warmup attempted before RpcClient was wired');
    }

    const readyTimeoutMs = timeoutMs > 0 ? Math.max(timeoutMs, WORKER_READY_TIMEOUT_MS) : 0;

    // Readiness probe (mirrors getBridgeInfo's meta request, per-worker).
    try {
      await rpc.sendOn(worker.transport, { method: 'meta', params: {} }, { timeoutMs: readyTimeoutMs });
    } catch (error) {
      throw wrapWarmupError('Worker warmup check', error);
    }

    // User-provided warmup commands.
    for (const [index, cmd] of warmupCommands.entries()) {
      const label = `Warmup command #${index + 1} (${cmd.module}.${cmd.functionName})`;
      try {
        await rpc.sendOn(
          worker.transport,
          {
            method: 'call',
            params: {
              module: cmd.module,
              functionName: cmd.functionName,
              args: cmd.args ?? [],
              kwargs: {},
            },
          },
          { timeoutMs }
        );
      } catch (error) {
        throw wrapWarmupError(label, error);
      }
    }
  };
}

// =============================================================================
// ENVIRONMENT BUILDING
// =============================================================================

/**
 * Build environment variables for SubprocessTransport.
 */
function buildProcessEnv(options: ResolvedOptions): Record<string, string> {
  const allowedPrefixes = ['TYWRAP_'];
  const allowedKeys = new Set(['path', 'pythonpath', 'virtual_env', 'pythonhome']);
  const env = createNullPrototypeEnv();

  // Copy allowed env vars from process.env
  if (options.inheritProcessEnv) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        setEnvValue(env, key, value);
      }
    }
  } else {
    for (const [key, value] of Object.entries(process.env)) {
      if (
        value !== undefined &&
        (allowedKeys.has(key.toLowerCase()) || allowedPrefixes.some(p => key.startsWith(p)))
      ) {
        setEnvValue(env, key, value);
      }
    }
  }

  // Apply user overrides
  for (const [key, value] of Object.entries(options.env)) {
    assertSafeEnvOverrideKey(key);
    if (value !== undefined) {
      setEnvValue(env, key, value);
    }
  }

  // Configure virtual environment
  if (options.virtualEnv) {
    const venv = resolveVirtualEnv(options.virtualEnv, options.cwd);
    env.VIRTUAL_ENV = venv.venvPath;
    const pathKey = getPathKey(env);
    const currentPath = getEnvValue(env, pathKey);
    setPathValue(env, currentPath ? `${venv.binDir}${delimiter}${currentPath}` : venv.binDir);
  }

  // Add cwd to PYTHONPATH so Python can find modules in the working directory
  if (options.cwd) {
    const currentPythonPath = env.PYTHONPATH ?? '';
    env.PYTHONPATH = currentPythonPath
      ? `${options.cwd}${delimiter}${currentPythonPath}`
      : options.cwd;
  }

  // Ensure Python uses UTF-8
  env.PYTHONUTF8 = '1';
  env.PYTHONIOENCODING = 'UTF-8';
  env.PYTHONUNBUFFERED = '1';
  env.PYTHONDONTWRITEBYTECODE = '1';

  return env;
}
