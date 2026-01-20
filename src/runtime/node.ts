/**
 * Node.js Runtime Bridge with Optional Connection Pooling
 *
 * NodeBridge is the unified Node.js runtime bridge that supports both single-process
 * (correctness-first) and multi-process (pooled) configurations. By default, it runs
 * in single-process mode for maximum compatibility with the original NodeBridge behavior.
 *
 * For high-throughput workloads, configure pooling via minProcesses/maxProcesses options.
 */

import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

import { globalCache } from '../utils/cache.js';
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
import { getComponentLogger } from '../utils/logger.js';

const log = getComponentLogger('NodeBridge');

/**
 * Configuration options for NodeBridge.
 *
 * By default, NodeBridge runs in single-process mode (minProcesses=1, maxProcesses=1).
 * For high-throughput workloads, increase these values to enable process pooling.
 */
export interface NodeBridgeOptions {
  /** Minimum number of Python processes to keep alive. Default: 1 */
  minProcesses?: number;
  /** Maximum number of Python processes to spawn. Default: 1 (single-process mode) */
  maxProcesses?: number;
  /** Time in ms to keep idle processes alive before termination. Default: 300000 (5 min) */
  maxIdleTime?: number;
  /** Restart process after this many requests. Default: 1000 */
  maxRequestsPerProcess?: number;
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
  /** Maximum line length for JSONL protocol. */
  maxLineLength?: number;
  /** Inherit all environment variables from parent process. Default: false */
  inheritProcessEnv?: boolean;
  /**
   * When true, sets TYWRAP_CODEC_FALLBACK=json for the Python process to prefer JSON encoding
   * for rich types (ndarray/dataframe/series). Default: false for fast-fail on Arrow path issues.
   */
  enableJsonFallback?: boolean;
  /** Enable result caching for pure functions. Default: false */
  enableCache?: boolean;
  /** Optional extra environment variables to pass to the Python subprocess. */
  env?: Record<string, string | undefined>;
  /** Commands to run on each process at startup for warming up. */
  warmupCommands?: Array<{ method: string; params: unknown }>;
}

interface ResolvedOptions {
  minProcesses: number;
  maxProcesses: number;
  maxIdleTime: number;
  maxRequestsPerProcess: number;
  pythonPath: string;
  scriptPath: string;
  virtualEnv?: string;
  cwd: string;
  timeoutMs: number;
  maxLineLength?: number;
  inheritProcessEnv: boolean;
  enableJsonFallback: boolean;
  enableCache: boolean;
  env: Record<string, string | undefined>;
  warmupCommands: Array<{ method: string; params: unknown }>;
}

interface WorkerProcess {
  process: ChildProcess;
  id: string;
  requestCount: number;
  lastUsed: number;
  busy: boolean;
  quarantined: boolean;
  core: BridgeCore;
  stats: {
    totalRequests: number;
    totalTime: number;
    averageTime: number;
    errorCount: number;
  };
}

interface BridgeStats {
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
}

interface BridgeStatsSnapshot extends BridgeStats {
  poolSize: number;
  busyWorkers: number;
  memoryUsage: NodeJS.MemoryUsage;
  workerStats: Array<{
    id: string;
    requestCount: number;
    averageTime: number;
    errorCount: number;
    busy: boolean;
    pendingRequests: number;
  }>;
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

/**
 * Node.js runtime bridge for executing Python code.
 *
 * By default, runs in single-process mode for correctness-first behavior.
 * Configure minProcesses/maxProcesses for process pooling in high-throughput scenarios.
 *
 * @example
 * ```typescript
 * // Single-process mode (default)
 * const bridge = new NodeBridge();
 *
 * // Multi-process pooling for high throughput
 * const pooledBridge = new NodeBridge({
 *   minProcesses: 2,
 *   maxProcesses: 8,
 *   enableCache: true,
 * });
 * ```
 */
export class NodeBridge extends RuntimeBridge {
  private processPool: WorkerProcess[] = [];
  private roundRobinIndex = 0;
  private cleanupTimer?: NodeJS.Timeout;
  private options: ResolvedOptions;
  private emitter = new EventEmitter();
  private disposed = false;
  private bridgeInfo?: BridgeInfo;
  private initPromise?: Promise<void>;

  // Performance monitoring
  private stats: BridgeStats = {
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
  };

  constructor(options: NodeBridgeOptions = {}) {
    super();
    const cwd = options.cwd ?? process.cwd();
    const virtualEnv = options.virtualEnv ? resolve(cwd, options.virtualEnv) : undefined;
    const venv = virtualEnv ? resolveVirtualEnv(virtualEnv, cwd) : undefined;
    const scriptPath = options.scriptPath ?? resolveDefaultScriptPath();
    const resolvedScriptPath = isAbsolute(scriptPath) ? scriptPath : resolve(cwd, scriptPath);
    this.options = {
      // Default to single-process mode for backward compatibility
      minProcesses: options.minProcesses ?? 1,
      maxProcesses: options.maxProcesses ?? 1,
      maxIdleTime: options.maxIdleTime ?? 300000, // 5 minutes
      maxRequestsPerProcess: options.maxRequestsPerProcess ?? 1000,
      pythonPath: options.pythonPath ?? venv?.pythonPath ?? getDefaultPythonPath(),
      scriptPath: resolvedScriptPath,
      virtualEnv,
      cwd,
      timeoutMs: options.timeoutMs ?? 30000,
      maxLineLength: options.maxLineLength,
      inheritProcessEnv: options.inheritProcessEnv ?? false,
      enableJsonFallback: options.enableJsonFallback ?? false,
      enableCache: options.enableCache ?? false,
      env: options.env ?? {},
      warmupCommands: options.warmupCommands ?? [],
    };

    // Start cleanup scheduler for pooled mode
    this.startCleanupScheduler();
  }

  async init(): Promise<void> {
    if (this.disposed) {
      throw new BridgeDisposedError('Bridge has been disposed');
    }
    if (this.processPool.length >= this.options.minProcesses) {
      return; // Already initialized
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- script path is user-configured
    if (!existsSync(this.options.scriptPath)) {
      throw new BridgeProtocolError(`Python bridge script not found at ${this.options.scriptPath}`);
    }

    const require = createRequire(import.meta.url);
    await autoRegisterArrowDecoder({
      loader: () => require('apache-arrow'),
    });

    // Ensure minimum processes are available
    while (this.processPool.length < this.options.minProcesses) {
      await this.spawnProcess();
    }

    // Validate protocol version
    await this.refreshBridgeInfo();

    // Warm up processes if configured
    if (this.options.warmupCommands.length > 0) {
      await this.warmupProcesses();
    }
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
    const startTime = performance.now();

    const cacheKey = this.options.enableCache
      ? this.safeCacheKey('runtime_call', module, functionName, args, kwargs)
      : null;
    if (cacheKey) {
      const cached = await globalCache.get<T>(cacheKey);
      if (cached !== null) {
        this.stats.cacheHits++;
        this.updateStats(performance.now() - startTime);
        return cached;
      }
    }

    try {
      const result = await this.executeRequest<T>({
        method: 'call',
        params: { module, functionName, args, kwargs },
      });

      const duration = performance.now() - startTime;

      // Cache result for pure functions (simple heuristic)
      if (cacheKey && this.isPureFunctionCandidate(functionName, args)) {
        await globalCache.set(cacheKey, result, {
          computeTime: duration,
          dependencies: [module],
        });
      }

      this.updateStats(duration);
      return result;
    } catch (error) {
      this.updateStats(performance.now() - startTime, true);
      throw error;
    }
  }

  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.init();
    const startTime = performance.now();

    try {
      const result = await this.executeRequest<T>({
        method: 'instantiate',
        params: { module, className, args, kwargs },
      });

      this.updateStats(performance.now() - startTime);
      return result;
    } catch (error) {
      this.updateStats(performance.now() - startTime, true);
      throw error;
    }
  }

  async callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.init();
    const startTime = performance.now();

    try {
      const result = await this.executeRequest<T>({
        method: 'call_method',
        params: { handle, methodName, args, kwargs },
      });

      this.updateStats(performance.now() - startTime);
      return result;
    } catch (error) {
      this.updateStats(performance.now() - startTime, true);
      throw error;
    }
  }

  async disposeInstance(handle: string): Promise<void> {
    await this.init();
    await this.executeRequest<void>({
      method: 'dispose_instance',
      params: { handle },
    });
  }

  /**
   * Execute request with intelligent process selection
   */
  private async executeRequest<T>(payload: Omit<RpcRequest, 'id' | 'protocol'>): Promise<T> {
    let worker = this.selectOptimalWorker();

    // Spawn new process if none available and under limit
    if (!worker && this.processPool.length < this.options.maxProcesses) {
      try {
        worker = await this.spawnProcess();
        this.stats.poolMisses++;
      } catch (error) {
        throw new Error(`Failed to spawn worker process: ${error}`);
      }
    }

    // Wait for worker if all are busy
    worker ??= await this.waitForAvailableWorker();

    this.stats.poolHits++;
    return this.sendToWorker<T>(worker, payload);
  }

  /**
   * Select optimal worker based on load and performance
   */
  private selectOptimalWorker(): WorkerProcess | null {
    // For single-process mode, allow concurrent requests to the same worker.
    // BridgeCore handles request ID multiplexing, so multiple in-flight requests are safe.
    // This preserves original NodeBridge behavior where concurrent calls were allowed.
    if (this.options.maxProcesses === 1 && this.processPool.length === 1) {
      const worker = this.processPool[0];
      if (worker && !worker.quarantined && worker.process.exitCode === null) {
        return worker;
      }
      return null;
    }

    // For multi-worker pools, use busy status for load balancing
    const availableWorkers = this.processPool.filter(
      w => !w.busy && !w.quarantined && w.process.exitCode === null
    );

    if (availableWorkers.length === 0) {
      return null;
    }

    // Simple round-robin for now, could be enhanced with load-based selection
    const worker = availableWorkers[this.roundRobinIndex % availableWorkers.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % availableWorkers.length;

    return worker ?? null;
  }

  /**
   * Wait for any worker to become available
   */
  private async waitForAvailableWorker(timeoutMs: number = 5000): Promise<WorkerProcess> {
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for available worker'));
      }, timeoutMs);

      const checkWorker = (): void => {
        const worker = this.selectOptimalWorker();
        if (worker) {
          clearTimeout(timeout);
          resolvePromise(worker);
        } else {
          // Check again in 10ms
          setTimeout(checkWorker, 10);
        }
      };

      checkWorker();
    });
  }

  /**
   * Send request to specific worker
   */
  private async sendToWorker<T>(
    worker: WorkerProcess,
    payload: Omit<RpcRequest, 'id' | 'protocol'>
  ): Promise<T> {
    worker.busy = true;
    worker.requestCount++;
    worker.lastUsed = Date.now();

    const startTime = performance.now();

    try {
      const result = await worker.core.send<T>(payload);
      const duration = performance.now() - startTime;
      worker.stats.totalTime += duration;
      worker.stats.totalRequests++;
      worker.stats.averageTime = worker.stats.totalTime / worker.stats.totalRequests;
      return result;
    } catch (error) {
      worker.stats.errorCount++;
      throw error;
    } finally {
      worker.busy = false;
    }
  }

  private quarantineWorker(worker: WorkerProcess, error: Error): void {
    if (worker.quarantined) {
      return;
    }
    worker.quarantined = true;
    log.warn('Quarantining worker', { workerId: worker.id, error: String(error) });
    this.terminateWorker(worker, { force: true })
      .then(() => {
        if (!this.disposed && this.processPool.length < this.options.minProcesses) {
          this.spawnProcess().catch(spawnError => {
            log.error('Failed to spawn replacement worker after quarantine', {
              error: String(spawnError),
            });
          });
        }
      })
      .catch(terminateError => {
        log.warn('Failed to terminate quarantined worker', {
          workerId: worker.id,
          error: String(terminateError),
        });
      });
  }

  /**
   * Spawn new worker process with optimizations
   */
  private async spawnProcess(): Promise<WorkerProcess> {
    const { spawn } = await import('child_process');

    const workerId = `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const env = this.buildEnv();
    env.PYTHONUNBUFFERED = '1'; // Ensure immediate output
    env.PYTHONDONTWRITEBYTECODE = '1'; // Skip .pyc files for faster startup
    const maxLineLength = this.options.maxLineLength ?? getMaxLineLengthFromEnv(env);

    const childProcess = spawn(this.options.pythonPath, [this.options.scriptPath], {
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    const worker: WorkerProcess = {
      process: childProcess,
      id: workerId,
      requestCount: 0,
      lastUsed: Date.now(),
      busy: false,
      quarantined: false,
      core: null as unknown as BridgeCore,
      stats: {
        totalRequests: 0,
        totalTime: 0,
        averageTime: 0,
        errorCount: 0,
      },
    };

    worker.core = new BridgeCore(
      {
        write: (data: string): void => {
          if (!worker.process.stdin?.writable) {
            throw new BridgeProtocolError('Worker process stdin not writable');
          }
          worker.process.stdin.write(data);
        },
      },
      {
        timeoutMs: this.options.timeoutMs,
        maxLineLength,
        decodeValue: decodeValueAsync,
        onFatalError: (error: Error): void => this.quarantineWorker(worker, error),
        onTimeout: (error: Error): void => this.quarantineWorker(worker, error),
      }
    );

    // Setup process event handlers
    this.setupProcessHandlers(worker);

    this.processPool.push(worker);
    this.stats.processSpawns++;

    return worker;
  }

  /**
   * Setup event handlers for worker process
   */
  private setupProcessHandlers(worker: WorkerProcess): void {
    const childProcess = worker.process;

    childProcess.stdout?.on('data', (chunk: Buffer) => {
      worker.core.handleStdoutData(chunk);
    });

    childProcess.stderr?.on('data', (chunk: Buffer) => {
      worker.core.handleStderrData(chunk);
      const errorText = chunk.toString().trim();
      if (errorText) {
        log.warn('Worker stderr', { workerId: worker.id, output: errorText });
      }
    });

    // Handle process exit
    childProcess.on('exit', code => {
      log.warn('Worker exited', { workerId: worker.id, code });
      worker.core.handleProcessExit();
      this.handleWorkerExit(worker, code);
    });

    // Handle process errors
    childProcess.on('error', error => {
      log.error('Worker error', { workerId: worker.id, error: String(error) });
      worker.core.handleProcessError(error);
      this.handleWorkerExit(worker, -1);
    });
  }

  /**
   * Handle worker process exit
   */
  private handleWorkerExit(worker: WorkerProcess, _code: number | null): void {
    if (!this.processPool.includes(worker)) {
      return;
    }

    worker.core.clear();

    // Remove from pool
    const index = this.processPool.indexOf(worker);
    if (index >= 0) {
      this.processPool.splice(index, 1);
      this.stats.processDeaths++;
    }

    // Spawn replacement if needed and not disposing
    if (!this.disposed && this.processPool.length < this.options.minProcesses) {
      this.spawnProcess().catch(error => {
        log.error('Failed to spawn replacement worker', { error: String(error) });
      });
    }
  }

  /**
   * Warm up processes with configured commands
   */
  private async warmupProcesses(): Promise<void> {
    const warmupPromises = this.processPool.map(async worker => {
      for (const cmd of this.options.warmupCommands) {
        try {
          await this.sendToWorker(worker, {
            method: cmd.method as 'call' | 'instantiate' | 'call_method' | 'dispose_instance',
            params: cmd.params,
          });
        } catch (error) {
          log.warn('Warmup command failed', { workerId: worker.id, error: String(error) });
        }
      }
    });

    await Promise.all(warmupPromises);
  }

  private safeCacheKey(prefix: string, ...inputs: unknown[]): string | null {
    try {
      return globalCache.generateKey(prefix, ...inputs);
    } catch {
      return null;
    }
  }

  /**
   * Heuristic to determine if function result should be cached
   */
  private isPureFunctionCandidate(functionName: string, args: unknown[]): boolean {
    // Simple heuristics - could be made more sophisticated
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

    // Don't cache if function name suggests mutation
    if (impureFunctionPatterns.some(pattern => pattern.test(functionName))) {
      return false;
    }

    // Cache if function name suggests pure computation
    if (pureFunctionPatterns.some(pattern => pattern.test(functionName))) {
      return true;
    }

    // Don't cache if args contain mutable objects (very basic check)
    const hasComplexArgs = args.some(
      arg => arg !== null && typeof arg === 'object' && !(arg instanceof Date)
    );

    return !hasComplexArgs && args.length <= 3; // Cache simple calls with few args
  }

  /**
   * Update performance statistics
   */
  private updateStats(duration: number, _error: boolean = false): void {
    this.stats.totalRequests++;
    this.stats.totalTime += duration;

    const currentMemory = process.memoryUsage().heapUsed;
    if (currentMemory > this.stats.memoryPeak) {
      this.stats.memoryPeak = currentMemory;
    }
  }

  /**
   * Get performance statistics
   */
  getStats(): BridgeStatsSnapshot {
    const avgTime =
      this.stats.totalRequests > 0 ? this.stats.totalTime / this.stats.totalRequests : 0;
    const hitRate =
      this.stats.totalRequests > 0 ? this.stats.cacheHits / this.stats.totalRequests : 0;

    return {
      ...this.stats,
      averageTime: avgTime,
      cacheHitRate: hitRate,
      poolSize: this.processPool.length,
      busyWorkers: this.processPool.filter(w => w.busy).length,
      memoryUsage: process.memoryUsage(),
      workerStats: this.processPool.map(w => ({
        id: w.id,
        requestCount: w.requestCount,
        averageTime: w.stats.averageTime,
        errorCount: w.stats.errorCount,
        busy: w.busy,
        pendingRequests: w.core.getPendingCount(),
      })),
    };
  }

  /**
   * Cleanup idle processes
   */
  private async cleanup(): Promise<void> {
    const now = Date.now();
    const idleWorkers = this.processPool.filter(
      w =>
        !w.busy &&
        now - w.lastUsed > this.options.maxIdleTime &&
        this.processPool.length > this.options.minProcesses
    );

    for (const worker of idleWorkers) {
      await this.terminateWorker(worker);
    }

    // Restart workers that have handled too many requests
    const overusedWorkers = this.processPool.filter(
      w => !w.busy && w.requestCount >= this.options.maxRequestsPerProcess
    );

    for (const worker of overusedWorkers) {
      await this.terminateWorker(worker);
      if (this.processPool.length < this.options.minProcesses) {
        await this.spawnProcess();
      }
    }
  }

  /**
   * Gracefully terminate a worker
   */
  private async terminateWorker(
    worker: WorkerProcess,
    options: { force?: boolean } = {}
  ): Promise<void> {
    if (worker.busy && !options.force) {
      return;
    }

    const index = this.processPool.indexOf(worker);
    if (index >= 0) {
      this.processPool.splice(index, 1);
      this.stats.processDeaths++;
    }

    worker.core.handleProcessExit();
    worker.core.clear();

    // Graceful termination
    try {
      if (worker.process.exitCode === null) {
        worker.process.kill('SIGTERM');

        // Force kill if not terminated in 5 seconds
        setTimeout(() => {
          if (worker.process.exitCode === null) {
            worker.process.kill('SIGKILL');
          }
        }, 5000);
      }
    } catch (error) {
      log.warn('Error terminating worker', { workerId: worker.id, error: String(error) });
    }
  }

  /**
   * Start cleanup scheduler
   */
  private startCleanupScheduler(): void {
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        log.error('Cleanup error', { error: String(error) });
      }
    }, 60000); // Cleanup every minute
  }

  /**
   * Dispose all resources
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Terminate all workers
    const terminationPromises = this.processPool.map(worker =>
      this.terminateWorker(worker, { force: true })
    );
    await Promise.all(terminationPromises);

    this.processPool.length = 0;
    this.emitter.removeAllListeners();
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
    ensureJsonFallback(env, this.options.enableJsonFallback);

    env = normalizeEnv(env, {});
    return env;
  }

  private async refreshBridgeInfo(): Promise<void> {
    const info = await this.executeRequest<BridgeInfo>({ method: 'meta', params: {} });
    validateBridgeInfo(info);
    this.bridgeInfo = info;
  }
}

/**
 * @deprecated Use NodeBridge with minProcesses/maxProcesses options instead.
 * This alias is provided for backward compatibility.
 */
export { NodeBridge as OptimizedNodeBridge };

/**
 * @deprecated Use NodeBridgeOptions instead.
 */
export type { NodeBridgeOptions as ProcessPoolOptions };
