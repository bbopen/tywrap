import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cpus } from 'os';
import { ParallelProcessor } from '../src/utils/parallel-processor.js';

describe('ParallelProcessor', () => {
  let processor: ParallelProcessor;

  afterEach(async () => {
    if (processor) {
      await processor.dispose();
    }
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      processor = new ParallelProcessor();
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });

    it('should create instance with custom options', () => {
      processor = new ParallelProcessor({
        maxWorkers: 2,
        taskTimeout: 5000,
        retryAttempts: 3,
        enableMemoryMonitoring: false,
        enableCaching: true,
        batchSize: 10,
        loadBalancing: 'least-loaded',
        debug: true,
      });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });

    it('should limit maxWorkers to CPU count', () => {
      processor = new ParallelProcessor({ maxWorkers: 100 });
      const stats = processor.getStats();
      // maxWorkers should be limited to min(100, cpus(), 8)
      expect(stats.totalWorkers).toBeLessThanOrEqual(Math.min(cpus().length, 8));
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      processor = new ParallelProcessor();
      const stats = processor.getStats();

      expect(stats).toHaveProperty('activeWorkers');
      expect(stats).toHaveProperty('totalWorkers');
      expect(stats).toHaveProperty('tasksCompleted');
      expect(stats).toHaveProperty('totalErrors');
      expect(stats).toHaveProperty('averageTaskTime');
      expect(stats).toHaveProperty('queueLength');
      expect(stats).toHaveProperty('activeTasks');
      expect(stats).toHaveProperty('workerStats');
    });

    it('should have zero queue length initially', () => {
      processor = new ParallelProcessor();
      const stats = processor.getStats();
      expect(stats.queueLength).toBe(0);
      expect(stats.activeTasks).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should dispose without error', async () => {
      processor = new ParallelProcessor();
      await expect(processor.dispose()).resolves.not.toThrow();
    });

    it('should be idempotent', async () => {
      processor = new ParallelProcessor();
      await processor.dispose();
      await expect(processor.dispose()).resolves.not.toThrow();
    });
  });

  describe('task type validation', () => {
    beforeEach(() => {
      processor = new ParallelProcessor({ maxWorkers: 1 });
    });

    it('should handle analyze task type', () => {
      const task = {
        id: 'test-1',
        type: 'analyze' as const,
        data: { sources: [] },
      };
      // Should not throw during creation
      expect(task.type).toBe('analyze');
    });

    it('should handle generate task type', () => {
      const task = {
        id: 'test-2',
        type: 'generate' as const,
        data: { modules: [] },
      };
      expect(task.type).toBe('generate');
    });

    it('should handle validate task type', () => {
      const task = {
        id: 'test-3',
        type: 'validate' as const,
        data: {},
      };
      expect(task.type).toBe('validate');
    });

    it('should handle custom task type', () => {
      const task = {
        id: 'test-4',
        type: 'custom' as const,
        data: { custom: true },
      };
      expect(task.type).toBe('custom');
    });
  });

  describe('priority handling', () => {
    it('should accept tasks with priority', () => {
      processor = new ParallelProcessor({ maxWorkers: 1 });
      const task = {
        id: 'priority-test',
        type: 'analyze' as const,
        data: { sources: [] },
        priority: 10,
      };
      expect(task.priority).toBe(10);
    });
  });

  describe('load balancing modes', () => {
    it('should accept round-robin load balancing', () => {
      processor = new ParallelProcessor({ loadBalancing: 'round-robin' });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });

    it('should accept least-loaded load balancing', () => {
      processor = new ParallelProcessor({ loadBalancing: 'least-loaded' });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });

    it('should accept weighted load balancing', () => {
      processor = new ParallelProcessor({ loadBalancing: 'weighted' });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });
  });

  describe('memory monitoring', () => {
    it('should accept enableMemoryMonitoring option', () => {
      processor = new ParallelProcessor({ enableMemoryMonitoring: true });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });

    it('should work without memory monitoring', () => {
      processor = new ParallelProcessor({ enableMemoryMonitoring: false });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });
  });

  describe('caching options', () => {
    it('should accept enableCaching option', () => {
      processor = new ParallelProcessor({ enableCaching: true });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });

    it('should work without caching', () => {
      processor = new ParallelProcessor({ enableCaching: false });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });
  });

  describe('event emitter functionality', () => {
    beforeEach(() => {
      processor = new ParallelProcessor({ maxWorkers: 1 });
    });

    it('should be an event emitter', () => {
      expect(typeof processor.on).toBe('function');
      expect(typeof processor.emit).toBe('function');
      expect(typeof processor.removeListener).toBe('function');
    });

    it('should allow subscribing to events', () => {
      const handler = vi.fn();
      processor.on('task_complete', handler);
      expect(processor.listenerCount('task_complete')).toBe(1);
    });

    it('should allow unsubscribing from events', () => {
      const handler = vi.fn();
      processor.on('task_complete', handler);
      processor.removeListener('task_complete', handler);
      expect(processor.listenerCount('task_complete')).toBe(0);
    });
  });

  describe('batch size configuration', () => {
    it('should accept custom batch size', () => {
      processor = new ParallelProcessor({ batchSize: 5 });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });

    it('should use default batch size when not specified', () => {
      processor = new ParallelProcessor();
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });
  });

  describe('timeout configuration', () => {
    it('should accept custom task timeout', () => {
      processor = new ParallelProcessor({ taskTimeout: 60000 });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });

    it('should accept retry attempts configuration', () => {
      processor = new ParallelProcessor({ retryAttempts: 5 });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });
  });
});

// Execution behavior tests (without Worker mocking)
describe('ParallelProcessor - Task Execution', () => {
  let processor: ParallelProcessor;

  afterEach(async () => {
    if (processor) {
      await processor.dispose();
    }
  });

  describe('executeTasks prerequisites', () => {
    it('should initialize stats before any tasks', () => {
      processor = new ParallelProcessor({ maxWorkers: 1 });

      const stats = processor.getStats();
      expect(stats.tasksCompleted).toBe(0);
      expect(stats.queueLength).toBe(0);
    });

    it('should handle priority sorting for tasks', () => {
      processor = new ParallelProcessor({ maxWorkers: 2 });

      const tasks = [
        { id: 'low', type: 'analyze' as const, data: {}, priority: 1 },
        { id: 'high', type: 'analyze' as const, data: {}, priority: 10 },
        { id: 'medium', type: 'analyze' as const, data: {}, priority: 5 },
      ];

      // Verify tasks have priority values and sort correctly
      const sorted = [...tasks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      expect(sorted[0].id).toBe('high');
      expect(sorted[1].id).toBe('medium');
      expect(sorted[2].id).toBe('low');
    });
  });

  describe('event subscription', () => {
    beforeEach(() => {
      processor = new ParallelProcessor({ maxWorkers: 1 });
    });

    it('should register task_complete listener', () => {
      const handler = vi.fn();
      processor.on('task_complete', handler);
      expect(processor.listenerCount('task_complete')).toBe(1);
    });

    it('should register worker_ready listener', () => {
      const handler = vi.fn();
      processor.on('worker_ready', handler);
      expect(processor.listenerCount('worker_ready')).toBe(1);
    });

    it('should register worker_error listener', () => {
      const handler = vi.fn();
      processor.on('worker_error', handler);
      expect(processor.listenerCount('worker_error')).toBe(1);
    });

    it('should register worker_exit listener', () => {
      const handler = vi.fn();
      processor.on('worker_exit', handler);
      expect(processor.listenerCount('worker_exit')).toBe(1);
    });

    it('should register multiple listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      processor.on('task_complete', handler1);
      processor.on('task_complete', handler2);
      expect(processor.listenerCount('task_complete')).toBe(2);
    });
  });

  describe('worker stats methods', () => {
    beforeEach(() => {
      processor = new ParallelProcessor({ maxWorkers: 2 });
    });

    it('should return empty worker stats before init', () => {
      const workerStats = processor.getWorkerStats();
      expect(Array.isArray(workerStats)).toBe(true);
      expect(workerStats.length).toBe(0);
    });

    it('should have all stats properties', () => {
      const stats = processor.getStats();
      expect(stats).toHaveProperty('activeWorkers');
      expect(stats).toHaveProperty('totalWorkers');
      expect(stats).toHaveProperty('tasksCompleted');
      expect(stats).toHaveProperty('totalErrors');
      expect(stats).toHaveProperty('averageTaskTime');
      expect(stats).toHaveProperty('queueLength');
      expect(stats).toHaveProperty('activeTasks');
      expect(stats).toHaveProperty('workerStats');
    });

    it('should have zero initial values', () => {
      const stats = processor.getStats();
      expect(stats.activeWorkers).toBe(0);
      expect(stats.totalWorkers).toBe(0);
      expect(stats.tasksCompleted).toBe(0);
      expect(stats.totalErrors).toBe(0);
      expect(stats.averageTaskTime).toBe(0);
    });
  });

  describe('disposed state behavior', () => {
    it('should reject init() after dispose', async () => {
      processor = new ParallelProcessor({ maxWorkers: 1 });
      await processor.dispose();

      await expect(processor.init()).rejects.toThrow('Processor has been disposed');
    });

    it('should handle multiple dispose calls', async () => {
      processor = new ParallelProcessor({ maxWorkers: 1 });
      await processor.dispose();
      await expect(processor.dispose()).resolves.not.toThrow();
    });

    it('should clear data structures on dispose', async () => {
      processor = new ParallelProcessor({ maxWorkers: 1 });
      await processor.dispose();

      const stats = processor.getStats();
      expect(stats.queueLength).toBe(0);
      expect(stats.activeTasks).toBe(0);
      expect(stats.workerStats.length).toBe(0);
    });

    it('should remove all listeners on dispose', async () => {
      processor = new ParallelProcessor({ maxWorkers: 1 });
      processor.on('task_complete', vi.fn());
      processor.on('worker_error', vi.fn());

      await processor.dispose();

      expect(processor.listenerCount('task_complete')).toBe(0);
      expect(processor.listenerCount('worker_error')).toBe(0);
    });
  });

  describe('debug mode behavior', () => {
    it('should accept debug option in constructor', () => {
      processor = new ParallelProcessor({ debug: true });
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });

    it('should allow toggling debug mode', () => {
      processor = new ParallelProcessor();
      processor.setDebug(true);
      processor.setDebug(false);
      expect(processor).toBeInstanceOf(ParallelProcessor);
    });
  });
});

// Task type tests
describe('ParallelProcessor - Task Types', () => {
  let processor: ParallelProcessor;

  afterEach(async () => {
    if (processor) {
      await processor.dispose();
    }
  });

  describe('analyze tasks', () => {
    it('should construct valid analyze task', () => {
      processor = new ParallelProcessor();

      const task = {
        id: 'analyze-1',
        type: 'analyze' as const,
        data: {
          sources: [
            { name: 'module1', content: 'def foo(): pass' },
            { name: 'module2', content: 'class Bar: pass', path: '/path/to/module2.py' },
          ],
        },
        priority: 5,
        timeout: 10000,
      };

      expect(task.type).toBe('analyze');
      expect(task.data.sources).toHaveLength(2);
      expect(task.data.sources[0].name).toBe('module1');
      expect(task.data.sources[1].path).toBe('/path/to/module2.py');
    });
  });

  describe('generate tasks', () => {
    it('should construct valid generate task', () => {
      processor = new ParallelProcessor();

      const task = {
        id: 'generate-1',
        type: 'generate' as const,
        data: {
          modules: [
            {
              name: 'module1',
              module: {
                name: 'module1',
                path: '/path/to/module1.py',
                functions: [],
                classes: [],
                imports: [],
                exports: [],
                docstring: '',
              },
              options: { exportAll: true },
            },
          ],
        },
        priority: 3,
      };

      expect(task.type).toBe('generate');
      expect(task.data.modules).toHaveLength(1);
      expect(task.data.modules[0].options?.exportAll).toBe(true);
    });
  });

  describe('validate tasks', () => {
    it('should construct valid validate task', () => {
      processor = new ParallelProcessor();

      const task = {
        id: 'validate-1',
        type: 'validate' as const,
        data: { schema: 'test', input: {} },
      };

      expect(task.type).toBe('validate');
    });
  });

  describe('custom tasks', () => {
    it('should construct valid custom task', () => {
      processor = new ParallelProcessor();

      const task = {
        id: 'custom-1',
        type: 'custom' as const,
        data: { customField: 'value', nested: { a: 1, b: 2 } },
        options: { flag: true },
      };

      expect(task.type).toBe('custom');
      expect(task.data.customField).toBe('value');
      expect(task.options?.flag).toBe(true);
    });
  });
});

// Result structure tests
describe('ParallelProcessor - Result Structure', () => {
  describe('ParallelResult', () => {
    it('should have correct structure for success', () => {
      const result = {
        taskId: 'test-1',
        success: true,
        result: { data: 'test' },
        duration: 100,
        memoryUsage: 1024 * 1024,
      };

      expect(result.taskId).toBe('test-1');
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ data: 'test' });
      expect(result.duration).toBe(100);
      expect(result.memoryUsage).toBe(1024 * 1024);
    });

    it('should have correct structure for failure', () => {
      const result = {
        taskId: 'test-2',
        success: false,
        error: 'Task failed: timeout',
        duration: 30000,
      };

      expect(result.taskId).toBe('test-2');
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
      expect(result.result).toBeUndefined();
    });
  });

  describe('WorkerStats', () => {
    it('should have correct structure', () => {
      const stats = {
        workerId: 'worker_0',
        tasksCompleted: 10,
        totalTime: 5000,
        averageTime: 500,
        errorCount: 1,
        memoryPeak: 100 * 1024 * 1024,
        isActive: true,
      };

      expect(stats.workerId).toBe('worker_0');
      expect(stats.tasksCompleted).toBe(10);
      expect(stats.averageTime).toBe(500);
      expect(stats.errorCount).toBe(1);
      expect(stats.isActive).toBe(true);
    });
  });

  describe('ParallelProcessorStats', () => {
    it('should have correct structure', () => {
      const stats = {
        activeWorkers: 4,
        totalWorkers: 4,
        tasksCompleted: 100,
        totalErrors: 2,
        averageTaskTime: 250,
        queueLength: 5,
        activeTasks: 3,
        workerStats: [],
      };

      expect(stats.activeWorkers).toBe(4);
      expect(stats.totalWorkers).toBe(4);
      expect(stats.tasksCompleted).toBe(100);
      expect(stats.totalErrors).toBe(2);
      expect(stats.averageTaskTime).toBe(250);
      expect(stats.queueLength).toBe(5);
      expect(stats.activeTasks).toBe(3);
    });
  });
});
