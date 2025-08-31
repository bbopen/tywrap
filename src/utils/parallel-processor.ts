/**
 * Parallel Processing System for tywrap
 * High-performance parallel processing for large Python codebases
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { globalCache } from './cache.js';
import { globalMemoryProfiler } from './memory-profiler.js';
import type { AnalysisResult, PythonModule, GeneratedCode } from '../types/index.js';

export interface ParallelTask<T = unknown> {
  id: string;
  type: 'analyze' | 'generate' | 'validate' | 'custom';
  data: unknown;
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
}

export class ParallelProcessor extends EventEmitter {
  private workers = new Map<string, Worker>();
  private workerStats = new Map<string, WorkerStats>();
  private taskQueue: ParallelTask[] = [];
  private activeTasks = new Map<string, ParallelTask>();
  private pendingResults = new Map<string, {
    resolve: (result: ParallelResult<any>) => void;
    reject: (error: Error) => void;
    timeout?: NodeJS.Timeout;
  }>();
  private roundRobinIndex = 0;
  private options: Required<ParallelProcessorOptions>;
  private disposed = false;

  constructor(options: ParallelProcessorOptions = {}) {
    super();
    
    this.options = {
      maxWorkers: options.maxWorkers ?? Math.min(cpus().length, 8),
      taskTimeout: options.taskTimeout ?? 30000,
      retryAttempts: options.retryAttempts ?? 2,
      enableMemoryMonitoring: options.enableMemoryMonitoring ?? true,
      enableCaching: options.enableCaching ?? true,
      workerScript: options.workerScript ?? __filename,
      batchSize: options.batchSize ?? 1,
      loadBalancing: options.loadBalancing ?? 'least-loaded',
    };

    console.log(`🚀 Parallel processor initialized with ${this.options.maxWorkers} workers`);
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

    console.log(`✅ Worker pool initialized with ${this.workers.size} workers`);
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
    
    console.log(`📊 Analyzing ${sources.length} modules in ${chunks.length} chunks`);

    const tasks: ParallelTask<AnalysisResult>[] = chunks.map((chunk, index) => ({
      id: `analyze_chunk_${index}`,
      type: 'analyze',
      data: { sources: chunk },
      priority: 1,
    }));

    const results = await this.executeTasks(tasks);
    
    // Flatten chunked results
    const flatResults: ParallelResult<AnalysisResult>[] = [];
    for (const result of results) {
      if (!result.success || !result.result) {
        continue;
      }
      if (result.success && result.result) {
        const chunkResults = result.result as unknown as ParallelResult<AnalysisResult>[];
        if (Array.isArray(chunkResults)) {
          flatResults.push(...chunkResults);
        } else {
          flatResults.push(result as ParallelResult<AnalysisResult>);
        }
      }
    }

    return flatResults;
  }

  /**
   * Generate TypeScript wrappers in parallel
   */
  async generateWrappersParallel(
    modules: Array<{ name: string; module: PythonModule; options?: any }>,
    options: { chunkSize?: number } = {}
  ): Promise<Array<ParallelResult<GeneratedCode>>> {
    const chunkSize = options.chunkSize ?? Math.ceil(modules.length / this.options.maxWorkers);
    const chunks = this.chunkArray(modules, chunkSize);

    console.log(`🏗️  Generating ${modules.length} wrappers in ${chunks.length} chunks`);

    const tasks: ParallelTask<GeneratedCode>[] = chunks.map((chunk, index) => ({
      id: `generate_chunk_${index}`,
      type: 'generate',
      data: { modules: chunk },
      priority: 1,
    }));

    const results = await this.executeTasks(tasks);
    
    // Flatten chunked results
    const flatResults: ParallelResult<GeneratedCode>[] = [];
    for (const result of results) {
      if (result.success && result.result) {
        const chunkResults = result.result as unknown as ParallelResult<GeneratedCode>[];
        if (Array.isArray(chunkResults)) {
          flatResults.push(...chunkResults);
        } else {
          flatResults.push(result as ParallelResult<GeneratedCode>);
        }
      }
    }

    return flatResults;
  }

  /**
   * Execute tasks in parallel with load balancing
   */
  async executeTasks<T>(tasks: ParallelTask<T>[]): Promise<Array<ParallelResult<T>>> {
    if (this.workers.size === 0) {
      await this.init();
    }

    // Sort tasks by priority
    const sortedTasks = [...tasks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    
    // Execute tasks with batching
    const results: Array<ParallelResult<T>> = [];
    const promises: Array<Promise<ParallelResult<T>>> = [];

    for (const task of sortedTasks) {
      const promise = this.executeTask(task);
      promises.push(promise);
      
      // Limit concurrent tasks to prevent overwhelming workers
      if (promises.length >= this.workers.size * 2) {
        const completed = await Promise.race(promises);
        results.push(completed);
        
        // Remove completed promise
        const index = promises.indexOf(
          promises.find(p => (p as any)._result === completed) as Promise<ParallelResult<T>>
        );
        if (index >= 0) {
          promises.splice(index, 1);
        }
      }
    }

    // Wait for remaining tasks
    const remaining = await Promise.all(promises);
    results.push(...remaining);

    return results;
  }

  /**
   * Execute single task
   */
  private async executeTask<T>(task: ParallelTask<T>): Promise<ParallelResult<T>> {
    // Check cache first if enabled
    if (this.options.enableCaching) {
      const cacheKey = globalCache.generateKey('parallel_task', task.type, task.data);
      const cached = await globalCache.get<ParallelResult<T>>(cacheKey);
      if (cached) {
        console.log(`🎯 Cache HIT for task ${task.id}`);
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

        const result = await this.sendTaskToWorker(worker, task);
        
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
      error: lastError?.message || 'Task failed after retries',
      duration: 0,
    };
  }

  /**
   * Select optimal worker using load balancing strategy
   */
  private selectOptimalWorker(): Worker | null {
    const availableWorkers = Array.from(this.workers.values()).filter(w => 
      !(w as any).destroyed && w.threadId !== undefined
    );

    if (availableWorkers.length === 0) {
      return null;
    }

    switch (this.options.loadBalancing) {
      case 'round-robin':
        const worker = availableWorkers[this.roundRobinIndex % availableWorkers.length];
        this.roundRobinIndex = (this.roundRobinIndex + 1) % availableWorkers.length;
        return worker || null;

      case 'least-loaded':
        // Find worker with least active tasks
        const workerLoads = availableWorkers.map(w => {
          const workerId = this.getWorkerId(w);
          const stats = this.workerStats.get(workerId);
          return { worker: w, load: stats?.tasksCompleted || 0 };
        });
        
        workerLoads.sort((a, b) => a.load - b.load);
        return workerLoads[0]?.worker || null;

      case 'weighted':
        // Weight by average task completion time
        const workerWeights = availableWorkers.map(w => {
          const workerId = this.getWorkerId(w);
          const stats = this.workerStats.get(workerId);
          const avgTime = stats?.averageTime || 1000;
          return { worker: w, weight: 1 / avgTime };
        });
        
        // Weighted random selection
        const totalWeight = workerWeights.reduce((sum, w) => sum + w.weight, 0);
        let random = Math.random() * totalWeight;
        
        for (const { worker, weight } of workerWeights) {
          random -= weight;
          if (random <= 0) {
            return worker;
          }
        }
        
        return workerWeights[0]?.worker || null;

      default:
        return availableWorkers[0] || null;
    }
  }

  /**
   * Send task to specific worker
   */
  private async sendTaskToWorker<T>(worker: Worker, task: ParallelTask<T>): Promise<ParallelResult<T>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResults.delete(task.id);
        reject(new Error(`Task ${task.id} timed out after ${task.timeout || this.options.taskTimeout}ms`));
      }, task.timeout || this.options.taskTimeout);

      this.pendingResults.set(task.id, {
        resolve,
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
        }
      }
    });

    // Setup worker message handling
    worker.on('message', (message) => {
      this.handleWorkerMessage(workerId, message);
    });

    // Setup worker error handling
    worker.on('error', (error) => {
      console.error(`❌ Worker ${workerId} error:`, error);
      this.handleWorkerError(workerId, error);
    });

    // Setup worker exit handling
    worker.on('exit', (code) => {
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

    console.log(`👷 Spawned worker ${workerId}`);
    return worker;
  }

  /**
   * Handle message from worker
   */
  private handleWorkerMessage(workerId: string, message: any): void {
    const { type, taskId, result, error, duration, memoryUsage } = message;

    if (type === 'task_complete') {
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
    } else if (type === 'worker_ready') {
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
  getStats() {
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

    console.log('🛑 Disposing parallel processor...');

    // Terminate all workers
    const terminationPromises = Array.from(this.workers.values()).map(worker => {
      return new Promise<void>((resolve) => {
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

    console.log('✅ Parallel processor disposed');
  }
}

// Worker script implementation (this runs in worker threads)
if (!isMainThread && parentPort) {
  const { workerId, options } = workerData;
  
  // Import required modules in worker context
  const workerImplementation = {
    async processTask(task: ParallelTask): Promise<unknown> {
      const startTime = performance.now();
      let result: unknown;
      let error: string | undefined;

      try {
        switch (task.type) {
          case 'analyze':
            result = await this.processAnalysisTask(task.data as any);
            break;
          case 'generate':
            result = await this.processGenerationTask(task.data as any);
            break;
          case 'validate':
            result = await this.processValidationTask(task.data as any);
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

    async processAnalysisTask(data: { sources: Array<{ name: string; content: string; path?: string }> }) {
      const results = [];
      
      for (const source of data.sources) {
        try {
          // This would import and use PyAnalyzer
          const result = {
            success: true,
            moduleName: source.name,
            // Actual analysis would happen here
          };
          results.push(result);
        } catch (error) {
          results.push({
            success: false,
            moduleName: source.name,
            error: String(error)
          });
        }
      }
      
      return results;
    },

    async processGenerationTask(data: { modules: Array<{ name: string; module: any; options?: any }> }) {
      const results = [];
      
      for (const moduleData of data.modules) {
        try {
          // This would import and use CodeGenerator
          const result = {
            success: true,
            moduleName: moduleData.name,
            // Actual generation would happen here
          };
          results.push(result);
        } catch (error) {
          results.push({
            success: false,
            moduleName: moduleData.name,
            error: String(error)
          });
        }
      }
      
      return results;
    },

    async processValidationTask(data: unknown) {
      // Validation logic would go here
      return { validated: true };
    }
  };

  parentPort.on('message', async (message) => {
    const { type, task } = message;

    if (type === 'task') {
      try {
        const taskResult = await workerImplementation.processTask(task);
        
        parentPort!.postMessage({
          type: 'task_complete',
          taskId: task.id,
          ...(typeof taskResult === 'object' && taskResult !== null ? taskResult : { result: taskResult }),
        });
      } catch (error) {
        parentPort!.postMessage({
          type: 'task_complete',
          taskId: task.id,
          error: String(error),
          duration: 0,
        });
      }
    } else if (type === 'shutdown') {
      process.exit(0);
    }
  });

  // Signal that worker is ready
  parentPort.postMessage({
    type: 'worker_ready',
    workerId,
  });
}

export const globalParallelProcessor = new ParallelProcessor();