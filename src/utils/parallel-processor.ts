/**
 * Parallel Processing System for tywrap
 * High-performance parallel processing for large Python codebases
 */

import { EventEmitter } from 'events';
import { cpus } from 'os';
import { performance } from 'perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'node:url';

import type { AnalysisResult, PythonModule, GeneratedCode } from '../types/index.js';

import { CodeGenerator } from '../core/generator.js';
import { PyAnalyzer } from '../core/analyzer.js';
import { globalCache } from './cache.js';

export interface ParallelTask<Data = unknown> {
  id: string;
  type: 'analyze' | 'generate' | 'validate' | 'custom';
  data: Data;
  options?: Record<string, unknown>;
  priority?: number;
  timeout?: number;
}

export interface ParallelResult<T = unknown> {
  taskId: string;
  success: boolean;
  result?: T;
  error?: string;
  duration: number;
  memoryUsage?: number;
}

export interface WorkerStats {
  workerId: string;
  tasksCompleted: number;
  totalTime: number;
  averageTime: number;
  errorCount: number;
  memoryPeak: number;
  isActive: boolean;
}

export interface ParallelProcessorOptions {
  maxWorkers?: number;
  taskTimeout?: number; // milliseconds
  retryAttempts?: number;
  enableMemoryMonitoring?: boolean;
  enableCaching?: boolean;
  workerScript?: string; // Custom worker script path
  batchSize?: number; // Number of tasks to batch per worker
  loadBalancing?: 'round-robin' | 'least-loaded' | 'weighted';
  debug?: boolean;
}

export interface ParallelProcessorStats {
  activeWorkers: number;
  totalWorkers: number;
  tasksCompleted: number;
  totalErrors: number;
  averageTaskTime: number;
  queueLength: number;
  activeTasks: number;
  workerStats: WorkerStats[];
}

interface AnalyzeTaskData {
  sources: Array<{ name: string; content: string; path?: string }>;
}

interface GenerationTaskData {
  modules: Array<{ name: string; module: PythonModule; options?: Record<string, unknown> }>;
}

type ValidationTaskData = unknown;

interface AnalyzeTaskResult extends Array<ParallelResult<AnalysisResult>> {}
interface GenerateTaskResult extends Array<ParallelResult<GeneratedCode>> {}
interface ValidateTaskResult {
  validated: true;
}

type AnalyzeTask = ParallelTask<AnalyzeTaskData> & { type: 'analyze' };
type GenerateTask = ParallelTask<GenerationTaskData> & { type: 'generate' };
type ValidateTask = ParallelTask<ValidationTaskData> & { type: 'validate' };
type CustomTask = ParallelTask<unknown> & { type: 'custom' };

type WorkerTask = AnalyzeTask | GenerateTask | ValidateTask | CustomTask;

interface WorkerTaskResult {
  result: unknown;
  error?: string;
  duration: number;
  memoryUsage: number;
}

type WorkerMessage =
  | {
      type: 'task_complete';
      taskId: string;
      result?: unknown;
      error?: string;
      duration: number;
      memoryUsage?: number;
    }
  | {
      type: 'worker_ready';
      workerId: string;
    };

type WorkerControlMessage = { type: 'task'; task: WorkerTask } | { type: 'shutdown' };

interface WorkerData {
  workerId: string;
  options?: {
    enableMemoryMonitoring: boolean;
    enableCaching: boolean;
  };
}

export class ParallelProcessor extends EventEmitter {
  private workers = new Map<string, Worker>();
  private workerStats = new Map<string, WorkerStats>();
  private taskQueue: ParallelTask[] = [];
  private activeTasks = new Map<string, ParallelTask>();
  private pendingResults = new Map<
    string,
    {
      resolve: (result: ParallelResult<unknown>) => void;
      reject: (error: Error) => void;
      timeout?: NodeJS.Timeout;
    }
  >();
  private roundRobinIndex = 0;
  private options: Required<ParallelProcessorOptions>;
  private disposed = false;
  private debug = false;

  constructor(options: ParallelProcessorOptions = {}) {
    super();

    const defaultWorkerScript = fileURLToPath(import.meta.url);
    this.options = {
      maxWorkers: options.maxWorkers ?? Math.min(cpus().length, 8),
      taskTimeout: options.taskTimeout ?? 30000,
      retryAttempts: options.retryAttempts ?? 2,
      enableMemoryMonitoring: options.enableMemoryMonitoring ?? true,
      enableCaching: options.enableCaching ?? true,
      workerScript: options.workerScript ?? defaultWorkerScript,
      batchSize: options.batchSize ?? 1,
      loadBalancing: options.loadBalancing ?? 'least-loaded',
      debug: options.debug ?? false,
    };

    this.debug = this.options.debug;

    if (this.debug) {
      this.debugLog(`🚀 Parallel processor initialized with ${this.options.maxWorkers} workers`);
    }
  }

  private debugLog(message: string): void {
    if (!this.debug) {
      return;
    }
    process.stdout.write(`${message}\n`);
  }

  /**
   * Initialize worker pool
   */
  async init(): Promise<void> {
    if (this.disposed) {
      throw new Error('Processor has been disposed');
    }

    // Spawn initial worker pool
    for (let i = 0; i < this.options.maxWorkers; i++) {
      await this.spawnWorker(`worker_${i}`);
    }

    // Start task processing
    this.processQueue();

    this.debugLog(`✅ Worker pool initialized with ${this.workers.size} workers`);
  }

  /**
   * Process Python module analysis in parallel
   */
  async analyzeModulesParallel(
    sources: Array<{ name: string; content: string; path?: string }>,
    options: { chunkSize?: number } = {}
  ): Promise<Array<ParallelResult<AnalysisResult>>> {
    const chunkSize = options.chunkSize ?? Math.ceil(sources.length / this.options.maxWorkers);
    const chunks = this.chunkArray(sources, chunkSize);

    this.debugLog(`📊 Analyzing ${sources.length} modules in ${chunks.length} chunks`);

    const tasks: Array<ParallelTask<AnalyzeTaskData>> = chunks.map((chunk, index) => ({
      id: `analyze_chunk_${index}`,
      type: 'analyze',
      data: { sources: chunk },
      priority: 1,
    }));

    const results = await this.executeTasks<AnalyzeTaskData, AnalyzeTaskResult>(tasks);

    // Flatten chunked results
    const flatResults: ParallelResult<AnalysisResult>[] = [];
    for (const result of results) {
      if (!result.success || !result.result) {
        continue;
      }
      if (result.success && result.result) {
        const chunkResults = result.result;
        if (Array.isArray(chunkResults)) {
          flatResults.push(...chunkResults);
        }
      }
    }

    return flatResults;
  }

  /**
   * Generate TypeScript wrappers in parallel
   */
  async generateWrappersParallel(
    modules: Array<{ name: string; module: PythonModule; options?: Record<string, unknown> }>,
    options: { chunkSize?: number } = {}
  ): Promise<Array<ParallelResult<GeneratedCode>>> {
    const chunkSize = options.chunkSize ?? Math.ceil(modules.length / this.options.maxWorkers);
    const chunks = this.chunkArray(modules, chunkSize);

    this.debugLog(`🏗️  Generating ${modules.length} wrappers in ${chunks.length} chunks`);

    const tasks: Array<ParallelTask<GenerationTaskData>> = chunks.map((chunk, index) => ({
      id: `generate_chunk_${index}`,
      type: 'generate',
      data: { modules: chunk },
      priority: 1,
    }));

    const results = await this.executeTasks<GenerationTaskData, GenerateTaskResult>(tasks);

    // Flatten chunked results
    const flatResults: ParallelResult<GeneratedCode>[] = [];
    for (const result of results) {
      if (result.success && result.result) {
        const chunkResults = result.result;
        if (Array.isArray(chunkResults)) {
          flatResults.push(...chunkResults);
        }
      }
    }

    return flatResults;
  }

  /**
   * Execute tasks in parallel with load balancing
   */
  async executeTasks<Data, Result>(
    tasks: ParallelTask<Data>[]
  ): Promise<Array<ParallelResult<Result>>> {
    if (this.workers.size === 0) {
      await this.init();
    }

    // Sort tasks by priority
    const sortedTasks = [...tasks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // Execute tasks with batching
    const results: Array<ParallelResult<Result>> = [];
    const inFlight = new Set<Promise<ParallelResult<Result>>>();
    const maxInFlight = this.workers.size * 2;

    for (const task of sortedTasks) {
      const promise = this.executeTask<Data, Result>(task);
      inFlight.add(promise);
      promise
        .finally(() => {
          inFlight.delete(promise);
        })
        .catch(() => {
          // no-op: individual task failures are encoded in results
        });

      // Limit concurrent tasks to prevent overwhelming workers
      if (inFlight.size >= maxInFlight) {
        const completed = await Promise.race(inFlight);
        results.push(completed);
      }
    }

    // Wait for remaining tasks
    const remaining = await Promise.all(inFlight);
    results.push(...remaining);

    return results;
  }

  /**
   * Execute single task
   */
  private async executeTask<Data, Result>(
    task: ParallelTask<Data>
  ): Promise<ParallelResult<Result>> {
    // Check cache first if enabled
    if (this.options.enableCaching) {
      const cacheKey = globalCache.generateKey('parallel_task', task.type, task.data);
      const cached = await globalCache.get<ParallelResult<Result>>(cacheKey);
      if (cached) {
        this.debugLog(`🎯 Cache HIT for task ${task.id}`);
        return cached;
      }
    }

    let attempts = 0;
    let lastError: Error | undefined;

    while (attempts < this.options.retryAttempts) {
      attempts++;

      try {
        const worker = this.selectOptimalWorker();
        if (!worker) {
          throw new Error('No available workers');
        }

        const result = await this.sendTaskToWorker<Data, Result>(worker, task);

        // Cache successful results
        if (this.options.enableCaching && result.success) {
          const cacheKey = globalCache.generateKey('parallel_task', task.type, task.data);
          await globalCache.set(cacheKey, result, { computeTime: result.duration });
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️  Task ${task.id} failed (attempt ${attempts}): ${error}`);

        if (attempts < this.options.retryAttempts) {
          // Exponential backoff
          await this.sleep(Math.pow(2, attempts) * 1000);
        }
      }
    }

    // Return failure result
    return {
      taskId: task.id,
      success: false,
      error: lastError?.message ?? 'Task failed after retries',
      duration: 0,
    };
  }

  /**
   * Select optimal worker using load balancing strategy
   */
  private selectOptimalWorker(): Worker | null {
    const availableWorkers = Array.from(this.workers.values()).filter(
      worker => worker.threadId > 0
    );

    if (availableWorkers.length === 0) {
      return null;
    }

    switch (this.options.loadBalancing) {
      case 'round-robin': {
        const selected = availableWorkers[this.roundRobinIndex % availableWorkers.length];
        this.roundRobinIndex = (this.roundRobinIndex + 1) % availableWorkers.length;
        return selected ?? null;
      }

      case 'least-loaded': {
        // Find worker with least active tasks
        const workerLoads = availableWorkers.map(w => {
          const workerId = this.getWorkerId(w);
          const stats = this.workerStats.get(workerId);
          return { worker: w, load: stats?.tasksCompleted ?? 0 };
        });

        workerLoads.sort((a, b) => a.load - b.load);
        return workerLoads[0]?.worker ?? null;
      }

      case 'weighted': {
        // Weight by average task completion time
        const workerWeights = availableWorkers.map(w => {
          const workerId = this.getWorkerId(w);
          const stats = this.workerStats.get(workerId);
          const avgTime = stats?.averageTime ?? 1000;
          return { worker: w, weight: 1 / avgTime };
        });

        // Weighted random selection
        const totalWeight = workerWeights.reduce((sum, w) => sum + w.weight, 0);
        let random = Math.random() * totalWeight;

        for (const { worker: candidate, weight } of workerWeights) {
          random -= weight;
          if (random <= 0) {
            return candidate;
          }
        }

        return workerWeights[0]?.worker ?? null;
      }

      default:
        return availableWorkers[0] ?? null;
    }
  }

  /**
   * Send task to specific worker
   */
  private async sendTaskToWorker<Data, Result>(
    worker: Worker,
    task: ParallelTask<Data>
  ): Promise<ParallelResult<Result>> {
    return new Promise((resolve, reject) => {
      const timeoutMs = task.timeout ?? this.options.taskTimeout;
      const timeout = setTimeout(() => {
        this.pendingResults.delete(task.id);
        reject(new Error(`Task ${task.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingResults.set(task.id, {
        resolve: resolve as unknown as (result: ParallelResult<unknown>) => void,
        reject,
        timeout,
      });

      this.activeTasks.set(task.id, task);

      worker.postMessage({
        type: 'task',
        task,
      });
    });
  }

  /**
   * Spawn new worker
   */
  private async spawnWorker(workerId: string): Promise<Worker> {
    const worker = new Worker(this.options.workerScript, {
      workerData: {
        workerId,
        options: {
          enableMemoryMonitoring: this.options.enableMemoryMonitoring,
          enableCaching: this.options.enableCaching,
        },
      },
    });

    // Setup worker message handling
    worker.on('message', message => {
      this.handleWorkerMessage(workerId, message);
    });

    // Setup worker error handling
    worker.on('error', error => {
      console.error(`❌ Worker ${workerId} error:`, error);
      this.handleWorkerError(workerId, error);
    });

    // Setup worker exit handling
    worker.on('exit', code => {
      console.warn(`⚠️  Worker ${workerId} exited with code ${code}`);
      this.handleWorkerExit(workerId, code);
    });

    this.workers.set(workerId, worker);
    this.workerStats.set(workerId, {
      workerId,
      tasksCompleted: 0,
      totalTime: 0,
      averageTime: 0,
      errorCount: 0,
      memoryPeak: 0,
      isActive: true,
    });

    this.debugLog(`👷 Spawned worker ${workerId}`);
    return worker;
  }

  /**
   * Handle message from worker
   */
  private handleWorkerMessage(workerId: string, message: WorkerMessage): void {
    if (message.type === 'task_complete') {
      const { taskId, result, error, duration, memoryUsage } = message;
      const pending = this.pendingResults.get(taskId);
      if (pending) {
        this.pendingResults.delete(taskId);
        this.activeTasks.delete(taskId);

        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }

        // Update worker stats
        const stats = this.workerStats.get(workerId);
        if (stats) {
          stats.tasksCompleted++;
          stats.totalTime += duration;
          stats.averageTime = stats.totalTime / stats.tasksCompleted;

          if (error) {
            stats.errorCount++;
          }

          if (memoryUsage && memoryUsage > stats.memoryPeak) {
            stats.memoryPeak = memoryUsage;
          }
        }

        const parallelResult: ParallelResult = {
          taskId,
          success: !error,
          result,
          error,
          duration,
          memoryUsage,
        };

        pending.resolve(parallelResult);
      }
    } else if (message.type === 'worker_ready') {
      this.emit('worker_ready', workerId);
    }
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(workerId: string, error: Error): void {
    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.errorCount++;
      stats.isActive = false;
    }

    // Reject pending tasks for this worker
    for (const [taskId, pending] of this.pendingResults) {
      const task = this.activeTasks.get(taskId);
      if (task) {
        pending.reject(new Error(`Worker ${workerId} error: ${error.message}`));
        this.pendingResults.delete(taskId);
        this.activeTasks.delete(taskId);
      }
    }

    this.emit('worker_error', workerId, error);
  }

  /**
   * Handle worker exit
   */
  private handleWorkerExit(workerId: string, code: number): void {
    this.workers.delete(workerId);

    const stats = this.workerStats.get(workerId);
    if (stats) {
      stats.isActive = false;
    }

    // Respawn worker if not disposing
    if (!this.disposed && this.workers.size < this.options.maxWorkers) {
      this.spawnWorker(`${workerId}_respawn_${Date.now()}`).catch(error => {
        console.error(`Failed to respawn worker: ${error}`);
      });
    }

    this.emit('worker_exit', workerId, code);
  }

  /**
   * Process task queue
   */
  private processQueue(): void {
    // Simple queue processing - could be enhanced with priority scheduling
    setInterval(() => {
      if (this.taskQueue.length > 0 && this.workers.size > 0) {
        const task = this.taskQueue.shift();
        if (task) {
          this.executeTask(task).catch(error => {
            console.error(`Queue task execution failed: ${error}`);
          });
        }
      }
    }, 100);
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): WorkerStats[] {
    return Array.from(this.workerStats.values());
  }

  /**
   * Get overall processing statistics
   */
  getStats(): ParallelProcessorStats {
    const workers = Array.from(this.workerStats.values());
    const totalTasks = workers.reduce((sum, w) => sum + w.tasksCompleted, 0);
    const totalErrors = workers.reduce((sum, w) => sum + w.errorCount, 0);
    const totalTime = workers.reduce((sum, w) => sum + w.totalTime, 0);
    const avgTime = totalTasks > 0 ? totalTime / totalTasks : 0;

    return {
      activeWorkers: workers.filter(w => w.isActive).length,
      totalWorkers: workers.length,
      tasksCompleted: totalTasks,
      totalErrors,
      averageTaskTime: avgTime,
      queueLength: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      workerStats: workers,
    };
  }

  /**
   * Utility methods
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private getWorkerId(worker: Worker): string {
    for (const [id, w] of this.workers) {
      if (w === worker) {
        return id;
      }
    }
    return 'unknown';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gracefully dispose all workers
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    this.debugLog('🛑 Disposing parallel processor...');

    // Terminate all workers
    const terminationPromises = Array.from(this.workers.values()).map(worker => {
      return new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve();
        }, 5000);

        worker.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        worker.postMessage({ type: 'shutdown' });
      });
    });

    await Promise.all(terminationPromises);

    // Clear data structures
    this.workers.clear();
    this.workerStats.clear();
    this.taskQueue.length = 0;
    this.activeTasks.clear();
    this.pendingResults.clear();

    this.removeAllListeners();

    this.debugLog('✅ Parallel processor disposed');
  }

  setDebug(debug: boolean): void {
    this.debug = debug;
  }
}

// Worker script implementation (this runs in worker threads)
if (!isMainThread && parentPort) {
  const port = parentPort;
  const { workerId } = workerData as WorkerData;

  let analyzer: PyAnalyzer | null = null;
  let analyzerInitialized = false;
  let generator: CodeGenerator | null = null;

  const getAnalyzer = async (): Promise<PyAnalyzer> => {
    analyzer ??= new PyAnalyzer();
    if (!analyzerInitialized) {
      await analyzer.initialize();
      analyzerInitialized = true;
    }
    return analyzer;
  };

  const getGenerator = (): CodeGenerator => {
    generator ??= new CodeGenerator();
    return generator;
  };

  const createResultId = (prefix: string, name: string, index: number): string =>
    `${prefix}:${name}:${index}`;

  // Import required modules in worker context
  const workerImplementation = {
    async processTask(task: WorkerTask): Promise<WorkerTaskResult> {
      const startTime = performance.now();
      let result: unknown;
      let error: string | undefined;

      try {
        switch (task.type) {
          case 'analyze':
            result = await this.processAnalysisTask(task.data);
            break;
          case 'generate':
            result = await this.processGenerationTask(task.data);
            break;
          case 'validate':
            result = await this.processValidationTask(task.data);
            break;
          default:
            throw new Error(`Unknown task type: ${task.type}`);
        }
      } catch (err) {
        error = String(err);
      }

      const duration = performance.now() - startTime;
      const memoryUsage = process.memoryUsage().heapUsed;

      return { result, error, duration, memoryUsage };
    },

    async processAnalysisTask(data: AnalyzeTaskData): Promise<AnalyzeTaskResult> {
      const results: AnalyzeTaskResult = [];
      const activeAnalyzer = await getAnalyzer();

      for (const [index, source] of data.sources.entries()) {
        const start = performance.now();
        try {
          const modulePath = source.path ?? `${source.name}.py`;
          const analysis = await activeAnalyzer.analyzePythonModule(source.content, modulePath);
          results.push({
            taskId: createResultId('analyze', source.name, index),
            success: true,
            result: analysis,
            duration: performance.now() - start,
            memoryUsage: process.memoryUsage().heapUsed,
          });
        } catch (error) {
          results.push({
            taskId: createResultId('analyze', source.name, index),
            success: false,
            error: String(error),
            duration: performance.now() - start,
            memoryUsage: process.memoryUsage().heapUsed,
          });
        }
      }

      return results;
    },

    async processGenerationTask(data: GenerationTaskData): Promise<GenerateTaskResult> {
      const results: GenerateTaskResult = [];
      const activeGenerator = getGenerator();

      for (const [index, moduleData] of data.modules.entries()) {
        const start = performance.now();
        try {
          const generationOptions = {
            moduleName: moduleData.name,
            ...moduleData.options,
          } as {
            moduleName: string;
            exportAll?: boolean;
            annotatedJSDoc?: boolean;
          };
          const generated = await activeGenerator.generateModule(
            moduleData.module,
            generationOptions
          );
          results.push({
            taskId: createResultId('generate', moduleData.name, index),
            success: true,
            result: generated,
            duration: performance.now() - start,
            memoryUsage: process.memoryUsage().heapUsed,
          });
        } catch (error) {
          results.push({
            taskId: createResultId('generate', moduleData.name, index),
            success: false,
            error: String(error),
            duration: performance.now() - start,
            memoryUsage: process.memoryUsage().heapUsed,
          });
        }
      }

      return results;
    },

    async processValidationTask(_data: ValidationTaskData): Promise<ValidateTaskResult> {
      // Validation logic would go here
      return { validated: true };
    },
  };

  port.on('message', async (raw: unknown) => {
    const message = raw as WorkerControlMessage;
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'task') {
      try {
        const taskResult = await workerImplementation.processTask(message.task);

        port.postMessage({
          type: 'task_complete',
          taskId: message.task.id,
          ...(typeof taskResult === 'object' && taskResult !== null
            ? taskResult
            : { result: taskResult }),
        });
      } catch (error) {
        port.postMessage({
          type: 'task_complete',
          taskId: message.task.id,
          error: String(error),
          duration: 0,
        });
      }
    } else if (message.type === 'shutdown') {
      process.exit(0);
    }
  });

  // Signal that worker is ready
  port.postMessage({
    type: 'worker_ready',
    workerId,
  });
}

export const globalParallelProcessor = new ParallelProcessor();
