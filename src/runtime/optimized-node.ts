/**
 * Optimized Node.js Runtime Bridge with Connection Pooling and Memory Management
 * High-performance Python subprocess management for production workloads
 */

import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { decodeValueAsync } from '../utils/codec.js';
import { RuntimeBridge } from './base.js';
import { globalCache } from '../utils/cache.js';

interface RpcRequest {
  id: number;
  method: 'call' | 'instantiate' | 'dispose_instance';
  params: unknown;
}

interface RpcResponse<T = unknown> {
  id: number;
  result?: T;
  error?: { type: string; message: string; traceback?: string };
}

interface ProcessPoolOptions {
  minProcesses?: number;
  maxProcesses?: number;
  maxIdleTime?: number; // ms to keep idle processes alive
  maxRequestsPerProcess?: number; // restart process after N requests
  pythonPath?: string;
  scriptPath?: string;
  cwd?: string;
  timeoutMs?: number;
  enableJsonFallback?: boolean;
  env?: Record<string, string | undefined>;
  warmupCommands?: Array<{ method: string; params: unknown }>; // Commands to warm up processes
}

interface WorkerProcess {
  process: ChildProcess;
  id: string;
  requestCount: number;
  lastUsed: number;
  busy: boolean;
  buffer: string;
  pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    timer?: NodeJS.Timeout;
    startTime: number;
  }>;
  stats: {
    totalRequests: number;
    totalTime: number;
    averageTime: number;
    errorCount: number;
  };
}

export class OptimizedNodeBridge extends RuntimeBridge {
  private processPool: WorkerProcess[] = [];
  private roundRobinIndex = 0;
  private nextId = 1;
  private cleanupTimer?: NodeJS.Timeout;
  private options: Required<ProcessPoolOptions>;
  private emitter = new EventEmitter();
  private disposed = false;

  // Performance monitoring
  private stats = {
    totalRequests: 0,
    totalTime: 0,
    cacheHits: 0,
    poolHits: 0,
    poolMisses: 0,
    processSpawns: 0,
    processDeaths: 0,
    memoryPeak: 0,
  };

  constructor(options: ProcessPoolOptions = {}) {
    super();
    this.options = {
      minProcesses: options.minProcesses ?? 2,
      maxProcesses: options.maxProcesses ?? 8,
      maxIdleTime: options.maxIdleTime ?? 300000, // 5 minutes
      maxRequestsPerProcess: options.maxRequestsPerProcess ?? 1000,
      pythonPath: options.pythonPath ?? 'python3',
      scriptPath: options.scriptPath ?? 'runtime/python_bridge.py',
      cwd: options.cwd ?? process.cwd(),
      timeoutMs: options.timeoutMs ?? 30000,
      enableJsonFallback: options.enableJsonFallback ?? false,
      env: options.env ?? {},
      warmupCommands: options.warmupCommands ?? [],
    };

    // Start with minimum processes
    this.startCleanupScheduler();
  }

  async init(): Promise<void> {
    if (this.disposed) {
      throw new Error('Bridge has been disposed');
    }

    // Ensure minimum processes are available
    while (this.processPool.length < this.options.minProcesses) {
      await this.spawnProcess();
    }

    // Warm up processes if configured
    if (this.options.warmupCommands.length > 0) {
      await this.warmupProcesses();
    }
  }

  async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const startTime = performance.now();

    // Try cache first for pure functions
    const cacheKey = globalCache.generateKey('runtime_call', module, functionName, args, kwargs);
    const cached = await globalCache.get<T>(cacheKey);
    if (cached !== null) {
      this.stats.cacheHits++;
      console.log(`Runtime cache HIT for ${module}.${functionName}`);
      return cached;
    }

    try {
      const result = await this.executeRequest<T>({
        method: 'call',
        params: { module, functionName, args, kwargs }
      });

      const duration = performance.now() - startTime;

      // Cache result for pure functions (simple heuristic)
      if (this.isPureFunctionCandidate(functionName, args)) {
        await globalCache.set(cacheKey, result, {
          computeTime: duration,
          dependencies: [module]
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
    const startTime = performance.now();

    try {
      const result = await this.executeRequest<T>({
        method: 'instantiate',
        params: { module, className, args, kwargs }
      });

      this.updateStats(performance.now() - startTime);
      return result;
    } catch (error) {
      this.updateStats(performance.now() - startTime, true);
      throw error;
    }
  }

  /**
   * Execute request with intelligent process selection
   */
  private async executeRequest<T>(payload: Omit<RpcRequest, 'id'>): Promise<T> {
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
    if (!worker) {
      worker = await this.waitForAvailableWorker();
    }

    this.stats.poolHits++;
    return this.sendToWorker<T>(worker, payload);
  }

  /**
   * Select optimal worker based on load and performance
   */
  private selectOptimalWorker(): WorkerProcess | null {
    const availableWorkers = this.processPool.filter(w => !w.busy && w.process.connected);

    if (availableWorkers.length === 0) {
      return null;
    }

    // Simple round-robin for now, could be enhanced with load-based selection
    const worker = availableWorkers[this.roundRobinIndex % availableWorkers.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % availableWorkers.length;
    
    return worker || null;
  }

  /**
   * Wait for any worker to become available
   */
  private async waitForAvailableWorker(timeoutMs: number = 5000): Promise<WorkerProcess> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for available worker'));
      }, timeoutMs);

      const checkWorker = () => {
        const worker = this.selectOptimalWorker();
        if (worker) {
          clearTimeout(timeout);
          resolve(worker);
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
  private async sendToWorker<T>(worker: WorkerProcess, payload: Omit<RpcRequest, 'id'>): Promise<T> {
    const id = this.nextId++;
    const message: RpcRequest = { id, ...payload } as RpcRequest;
    const text = `${JSON.stringify(message)}\n`;

    worker.busy = true;
    worker.requestCount++;
    worker.lastUsed = Date.now();

    return new Promise<T>((resolve, reject) => {
      const startTime = performance.now();

      const timer = setTimeout(() => {
        worker.pendingRequests.delete(id);
        worker.busy = false;
        reject(new Error(`Request ${id} timed out after ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);

      worker.pendingRequests.set(id, {
        resolve: (value: unknown) => {
          const duration = performance.now() - startTime;
          worker.stats.totalTime += duration;
          worker.stats.totalRequests++;
          worker.stats.averageTime = worker.stats.totalTime / worker.stats.totalRequests;
          worker.busy = false;
          resolve(value as T);
        },
        reject: (error: unknown) => {
          worker.stats.errorCount++;
          worker.busy = false;
          reject(error);
        },
        timer,
        startTime
      });

      if (!worker.process.stdin?.writable) {
        worker.pendingRequests.delete(id);
        worker.busy = false;
        clearTimeout(timer);
        reject(new Error('Worker process stdin not writable'));
        return;
      }

      try {
        worker.process.stdin.write(text);
      } catch (error) {
        worker.pendingRequests.delete(id);
        worker.busy = false;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Spawn new worker process with optimizations
   */
  private async spawnProcess(): Promise<WorkerProcess> {
    const { spawn } = await import('child_process');
    
    const workerId = `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const env: NodeJS.ProcessEnv = { 
      ...process.env, 
      ...this.options.env,
      PYTHONUNBUFFERED: '1', // Ensure immediate output
      PYTHONDONTWRITEBYTECODE: '1', // Skip .pyc files for faster startup
    };

    if (this.options.enableJsonFallback && !env.TYWRAP_CODEC_FALLBACK) {
      env.TYWRAP_CODEC_FALLBACK = 'json';
    }

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
      buffer: '',
      pendingRequests: new Map(),
      stats: {
        totalRequests: 0,
        totalTime: 0,
        averageTime: 0,
        errorCount: 0,
      }
    };

    // Setup process event handlers
    this.setupProcessHandlers(worker);

    this.processPool.push(worker);
    this.stats.processSpawns++;

    console.log(`Spawned Python worker process ${workerId} (pool size: ${this.processPool.length})`);

    return worker;
  }

  /**
   * Setup event handlers for worker process
   */
  private setupProcessHandlers(worker: WorkerProcess): void {
    const childProcess = worker.process;

    // Handle stdout data with efficient buffering
    childProcess.stdout?.on('data', (chunk: Buffer) => {
      worker.buffer += chunk.toString();
      
      let idx: number;
      while ((idx = worker.buffer.indexOf('\n')) !== -1) {
        const line = worker.buffer.slice(0, idx).trim();
        worker.buffer = worker.buffer.slice(idx + 1);
        
        if (!line) continue;

        this.handleWorkerResponse(worker, line).catch(error => {
          console.error(`Error handling worker response: ${error}`);
        });
      }
    });

    // Handle stderr for debugging
    childProcess.stderr?.on('data', (chunk: Buffer) => {
      const errorText = chunk.toString().trim();
      if (errorText) {
        console.warn(`Worker ${worker.id} stderr:`, errorText);
      }
    });

    // Handle process exit
    childProcess.on('exit', (code) => {
      console.warn(`Worker ${worker.id} exited with code ${code}`);
      this.handleWorkerExit(worker, code);
    });

    // Handle process errors
    childProcess.on('error', (error) => {
      console.error(`Worker ${worker.id} error:`, error);
      this.handleWorkerExit(worker, -1);
    });
  }

  /**
   * Handle response from worker process
   */
  private async handleWorkerResponse(worker: WorkerProcess, line: string): Promise<void> {
    try {
      const msg = JSON.parse(line) as RpcResponse;
      const pending = worker.pendingRequests.get(msg.id);
      
      if (pending) {
        worker.pendingRequests.delete(msg.id);
        
        if (pending.timer) {
          clearTimeout(pending.timer);
        }

        if (msg.error) {
          pending.reject(this.errorFrom(msg.error));
        } else {
          try {
            const decoded = await decodeValueAsync(msg.result);
            pending.resolve(decoded);
          } catch (decodeError) {
            pending.reject(new Error(`Failed to decode response: ${decodeError}`));
          }
        }
      }
    } catch (parseError) {
      console.warn(`Failed to parse worker response: ${parseError} - Line: ${line}`);
    }
  }

  /**
   * Handle worker process exit
   */
  private handleWorkerExit(worker: WorkerProcess, code: number | null): void {
    // Reject all pending requests
    for (const [, pending] of worker.pendingRequests) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new Error(`Worker process exited with code ${code}`));
    }

    worker.pendingRequests.clear();

    // Remove from pool
    const index = this.processPool.indexOf(worker);
    if (index >= 0) {
      this.processPool.splice(index, 1);
      this.stats.processDeaths++;
    }

    // Spawn replacement if needed and not disposing
    if (!this.disposed && this.processPool.length < this.options.minProcesses) {
      this.spawnProcess().catch(error => {
        console.error(`Failed to spawn replacement worker: ${error}`);
      });
    }
  }

  /**
   * Warm up processes with configured commands
   */
  private async warmupProcesses(): Promise<void> {
    const warmupPromises = this.processPool.map(async (worker) => {
      for (const cmd of this.options.warmupCommands) {
        try {
          await this.sendToWorker(worker, {
            method: cmd.method as 'call' | 'instantiate' | 'dispose_instance',
            params: cmd.params
          });
        } catch (error) {
          console.warn(`Warmup command failed for worker ${worker.id}:`, error);
        }
      }
    });

    await Promise.all(warmupPromises);
    console.log(`Warmed up ${this.processPool.length} worker processes`);
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
    const hasComplexArgs = args.some(arg => 
      arg !== null && typeof arg === 'object' && !(arg instanceof Date)
    );

    return !hasComplexArgs && args.length <= 3; // Cache simple calls with few args
  }

  /**
   * Update performance statistics
   */
  private updateStats(duration: number, error: boolean = false): void {
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
  getStats() {
    const avgTime = this.stats.totalRequests > 0 ? this.stats.totalTime / this.stats.totalRequests : 0;
    const hitRate = this.stats.totalRequests > 0 ? this.stats.cacheHits / this.stats.totalRequests : 0;
    
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
        pendingRequests: w.pendingRequests.size,
      }))
    };
  }

  /**
   * Cleanup idle processes
   */
  private async cleanup(): Promise<void> {
    const now = Date.now();
    const idleWorkers = this.processPool.filter(
      w => !w.busy && 
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
  private async terminateWorker(worker: WorkerProcess): Promise<void> {
    const index = this.processPool.indexOf(worker);
    if (index >= 0) {
      this.processPool.splice(index, 1);
    }

    // Reject pending requests
    for (const [, pending] of worker.pendingRequests) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new Error('Worker process terminated'));
    }

    // Graceful termination
    try {
      if (worker.process.connected) {
        worker.process.kill('SIGTERM');
        
        // Force kill if not terminated in 5 seconds
        setTimeout(() => {
          if (!worker.process.killed) {
            worker.process.kill('SIGKILL');
          }
        }, 5000);
      }
    } catch (error) {
      console.warn(`Error terminating worker ${worker.id}:`, error);
    }

    console.log(`Terminated worker ${worker.id}`);
  }

  /**
   * Start cleanup scheduler
   */
  private startCleanupScheduler(): void {
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        console.error('Cleanup error:', error);
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
    const terminationPromises = this.processPool.map(worker => this.terminateWorker(worker));
    await Promise.all(terminationPromises);

    this.processPool.length = 0;
    this.emitter.removeAllListeners();

    console.log('Disposed optimized Node.js bridge');
  }

  private errorFrom(err: { type: string; message: string; traceback?: string }): Error {
    const e = new Error(`${err.type}: ${err.message}`);
    (e as Error & { traceback?: string }).traceback = err.traceback;
    return e;
  }
}