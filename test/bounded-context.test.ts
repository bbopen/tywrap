/**
 * BoundedContext Test Suite
 *
 * Tests for the unified boundary abstraction: lifecycle, validation,
 * error classification, bounded execution, and resource ownership.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BoundedContext,
  type ContextState,
  type ExecuteOptions,
} from '../src/runtime/bounded-context.js';
import {
  BridgeDisposedError,
  BridgeError,
  BridgeExecutionError,
  BridgeProtocolError,
  BridgeTimeoutError,
} from '../src/runtime/errors.js';
import type { Disposable } from '../src/runtime/disposable.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Concrete implementation of BoundedContext for testing.
 */
class TestContext extends BoundedContext {
  public initCalls = 0;
  public disposeCalls = 0;
  public shouldFailInit = false;
  public initDelay = 0;
  public initError?: Error;

  protected async doInit(): Promise<void> {
    this.initCalls++;
    if (this.initDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.initDelay));
    }
    if (this.shouldFailInit) {
      throw this.initError ?? new Error('Init failed');
    }
  }

  protected async doDispose(): Promise<void> {
    this.disposeCalls++;
  }

  // Expose protected methods for testing
  public testValidateNumeric(value: unknown, name: string): number {
    return this.validateNumeric(value, name);
  }

  public testValidatePositive(value: unknown, name: string): number {
    return this.validatePositive(value, name);
  }

  public testValidateString(value: unknown, name: string): string {
    return this.validateString(value, name);
  }

  public testValidateNonEmptyString(value: unknown, name: string): string {
    return this.validateNonEmptyString(value, name);
  }

  public testClassifyError(error: unknown): BridgeError {
    return this.classifyError(error);
  }

  public async testExecute<T>(
    operation: () => Promise<T>,
    options?: ExecuteOptions<T>
  ): Promise<T> {
    return this.execute(operation, options);
  }

  public testTrackResource<T extends Disposable>(resource: T): T {
    return this.trackResource(resource);
  }

  public testUntrackResource(resource: Disposable): boolean {
    return this.untrackResource(resource);
  }

  public getResourceCount(): number {
    return this.resourceCount;
  }

  // RuntimeExecution interface (not tested here, just stubs)
  async call<T>(): Promise<T> {
    return {} as T;
  }

  async instantiate<T>(): Promise<T> {
    return {} as T;
  }

  async callMethod<T>(): Promise<T> {
    return {} as T;
  }

  async disposeInstance(): Promise<void> {}
}

class MockResource implements Disposable {
  disposed = false;
  disposeError?: Error;

  async dispose(): Promise<void> {
    if (this.disposeError) {
      throw this.disposeError;
    }
    this.disposed = true;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LIFECYCLE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('BoundedContext Lifecycle', () => {
  let context: TestContext;

  beforeEach(() => {
    context = new TestContext();
  });

  afterEach(async () => {
    if (context.state !== 'disposed') {
      await context.dispose();
    }
  });

  describe('initial state', () => {
    it('starts in idle state', () => {
      expect(context.state).toBe('idle');
      expect(context.isReady).toBe(false);
      expect(context.isDisposed).toBe(false);
    });
  });

  describe('init()', () => {
    it('transitions to ready state on success', async () => {
      await context.init();
      expect(context.state).toBe('ready');
      expect(context.isReady).toBe(true);
    });

    it('calls doInit exactly once', async () => {
      await context.init();
      expect(context.initCalls).toBe(1);
    });

    it('is idempotent when already ready', async () => {
      await context.init();
      await context.init();
      await context.init();
      expect(context.initCalls).toBe(1);
    });

    it('deduplicates concurrent init calls', async () => {
      const promises = [context.init(), context.init(), context.init()];
      await Promise.all(promises);
      expect(context.initCalls).toBe(1);
    });

    it('allows retry after failure', async () => {
      context.shouldFailInit = true;

      await expect(context.init()).rejects.toThrow();
      expect(context.state).toBe('idle');

      context.shouldFailInit = false;
      await context.init();
      expect(context.state).toBe('ready');
      expect(context.initCalls).toBe(2);
    });

    it('throws BridgeDisposedError if already disposed', async () => {
      await context.dispose();
      await expect(context.init()).rejects.toThrow(BridgeDisposedError);
    });

    it('throws BridgeDisposedError if disposing', async () => {
      // Set up a slow dispose to allow init to be called during disposal
      const slowContext = new (class extends TestContext {
        protected async doDispose(): Promise<void> {
          await new Promise(resolve => setTimeout(resolve, 50));
          await super.doDispose();
        }
      })();

      await slowContext.init();

      // Start dispose (don't await)
      const disposePromise = slowContext.dispose();

      // Try to init during disposal
      await expect(slowContext.init()).rejects.toThrow(BridgeDisposedError);

      // Clean up
      await disposePromise;
    });

    it('does not revive context if dispose happens during failed init', async () => {
      context.initDelay = 50;
      context.shouldFailInit = true;

      const initPromise = context.init();
      expect(context.state).toBe('initializing');

      // Dispose while init is in flight
      await context.dispose();
      expect(context.state).toBe('disposed');

      // Wait for init to reject (it should not reset state to idle)
      await expect(initPromise).rejects.toThrow();

      // State should remain disposed, not reset to idle
      expect(context.state).toBe('disposed');
      expect(context.isDisposed).toBe(true);
    });

    it('classifies init errors', async () => {
      context.shouldFailInit = true;
      context.initError = new Error('timeout occurred');

      await expect(context.init()).rejects.toThrow(BridgeTimeoutError);
    });
  });

  describe('dispose()', () => {
    it('transitions to disposed state', async () => {
      await context.init();
      await context.dispose();
      expect(context.state).toBe('disposed');
      expect(context.isDisposed).toBe(true);
    });

    it('is idempotent', async () => {
      await context.init();
      await context.dispose();
      await context.dispose();
      await context.dispose();
      expect(context.disposeCalls).toBe(1);
    });

    it('disposes tracked resources', async () => {
      await context.init();
      const resource = new MockResource();
      context.testTrackResource(resource);

      await context.dispose();

      expect(resource.disposed).toBe(true);
    });

    it('disposes resources before doDispose', async () => {
      const order: string[] = [];
      const resource = {
        dispose: async () => {
          order.push('resource');
        },
      };

      const ctx = new (class extends TestContext {
        protected async doDispose(): Promise<void> {
          order.push('doDispose');
          await super.doDispose();
        }
      })();

      await ctx.init();
      ctx.testTrackResource(resource);
      await ctx.dispose();

      expect(order).toEqual(['resource', 'doDispose']);
    });

    it('throws single error if one disposal fails', async () => {
      await context.init();
      const resource = new MockResource();
      resource.disposeError = new Error('Resource error');
      context.testTrackResource(resource);

      await expect(context.dispose()).rejects.toThrow('Resource error');
      expect(context.state).toBe('disposed');
    });

    it('throws AggregateError if multiple disposals fail', async () => {
      await context.init();

      const r1 = new MockResource();
      r1.disposeError = new Error('Error 1');
      const r2 = new MockResource();
      r2.disposeError = new Error('Error 2');

      context.testTrackResource(r1);
      context.testTrackResource(r2);

      await expect(context.dispose()).rejects.toThrow(AggregateError);
      expect(context.state).toBe('disposed');
    });

    it('can dispose from idle state', async () => {
      await context.dispose();
      expect(context.state).toBe('disposed');
      expect(context.disposeCalls).toBe(1);
    });
  });

  describe('state transitions', () => {
    it('follows idle → initializing → ready path', async () => {
      const states: ContextState[] = [];
      context.initDelay = 10;

      const initPromise = context.init();
      states.push(context.state);

      await initPromise;
      states.push(context.state);

      expect(states).toEqual(['initializing', 'ready']);
    });

    it('follows ready → disposing → disposed path', async () => {
      await context.init();
      const states: ContextState[] = [context.state];

      await context.dispose();
      states.push(context.state);

      expect(states).toEqual(['ready', 'disposed']);
    });

    it('does not revive disposed context if dispose() is called during init()', async () => {
      // Set up a slow init to allow dispose to be called during initialization
      context.initDelay = 50;

      const initPromise = context.init();
      expect(context.state).toBe('initializing');

      // Dispose while init is in flight
      await context.dispose();
      expect(context.state).toBe('disposed');

      // Wait for init to complete (it should not change state back to ready)
      await initPromise;

      // State should remain disposed, not flip back to ready
      expect(context.state).toBe('disposed');
      expect(context.isDisposed).toBe(true);
      expect(context.isReady).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('BoundedContext Validation', () => {
  let context: TestContext;

  beforeEach(() => {
    context = new TestContext();
  });

  afterEach(async () => {
    if (context.state !== 'disposed') {
      await context.dispose();
    }
  });

  describe('validateNumeric', () => {
    it('returns valid numbers', () => {
      expect(context.testValidateNumeric(42, 'test')).toBe(42);
      expect(context.testValidateNumeric(0, 'test')).toBe(0);
      expect(context.testValidateNumeric(-3.14, 'test')).toBe(-3.14);
    });

    it('throws BridgeProtocolError for invalid values', () => {
      expect(() => context.testValidateNumeric(NaN, 'test')).toThrow(BridgeProtocolError);
      expect(() => context.testValidateNumeric('42', 'test')).toThrow(BridgeProtocolError);
    });
  });

  describe('validatePositive', () => {
    it('returns positive numbers', () => {
      expect(context.testValidatePositive(1, 'test')).toBe(1);
    });

    it('throws BridgeProtocolError for zero and negative', () => {
      expect(() => context.testValidatePositive(0, 'test')).toThrow(BridgeProtocolError);
      expect(() => context.testValidatePositive(-1, 'test')).toThrow(BridgeProtocolError);
    });
  });

  describe('validateString', () => {
    it('returns valid strings', () => {
      expect(context.testValidateString('hello', 'test')).toBe('hello');
      expect(context.testValidateString('', 'test')).toBe('');
    });

    it('throws BridgeProtocolError for non-strings', () => {
      expect(() => context.testValidateString(42, 'test')).toThrow(BridgeProtocolError);
    });
  });

  describe('validateNonEmptyString', () => {
    it('returns non-empty strings', () => {
      expect(context.testValidateNonEmptyString('hello', 'test')).toBe('hello');
    });

    it('throws BridgeProtocolError for empty strings', () => {
      expect(() => context.testValidateNonEmptyString('', 'test')).toThrow(BridgeProtocolError);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ERROR CLASSIFICATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('BoundedContext Error Classification', () => {
  let context: TestContext;

  beforeEach(() => {
    context = new TestContext();
  });

  afterEach(async () => {
    if (context.state !== 'disposed') {
      await context.dispose();
    }
  });

  it('passes through existing BridgeErrors', () => {
    const original = new BridgeTimeoutError('test');
    const result = context.testClassifyError(original);
    expect(result).toBe(original);
  });

  describe('timeout patterns', () => {
    it('classifies "timeout" as BridgeTimeoutError', () => {
      const result = context.testClassifyError(new Error('Operation timeout'));
      expect(result).toBeInstanceOf(BridgeTimeoutError);
    });

    it('classifies "etimedout" as BridgeTimeoutError', () => {
      const result = context.testClassifyError(new Error('ETIMEDOUT'));
      expect(result).toBeInstanceOf(BridgeTimeoutError);
    });

    it('classifies "timed out" as BridgeTimeoutError', () => {
      const result = context.testClassifyError(new Error('Connection timed out'));
      expect(result).toBeInstanceOf(BridgeTimeoutError);
    });

    it('classifies "aborted" as BridgeTimeoutError', () => {
      const result = context.testClassifyError(new Error('Request aborted'));
      expect(result).toBeInstanceOf(BridgeTimeoutError);
    });
  });

  describe('protocol patterns', () => {
    it('classifies "protocol" as BridgeProtocolError', () => {
      const result = context.testClassifyError(new Error('Protocol violation'));
      expect(result).toBeInstanceOf(BridgeProtocolError);
    });

    it('classifies "invalid json" as BridgeProtocolError', () => {
      const result = context.testClassifyError(new Error('Invalid JSON response'));
      expect(result).toBeInstanceOf(BridgeProtocolError);
    });

    it('classifies "parse error" as BridgeProtocolError', () => {
      const result = context.testClassifyError(new Error('Parse error at line 5'));
      expect(result).toBeInstanceOf(BridgeProtocolError);
    });

    it('classifies "unexpected token" as BridgeProtocolError', () => {
      const result = context.testClassifyError(new Error('Unexpected token <'));
      expect(result).toBeInstanceOf(BridgeProtocolError);
    });

    it('classifies "not found" as BridgeProtocolError', () => {
      const result = context.testClassifyError(new Error('Module not found'));
      expect(result).toBeInstanceOf(BridgeProtocolError);
    });
  });

  describe('disposed state', () => {
    it('classifies any error as BridgeDisposedError when disposed', async () => {
      await context.dispose();
      const result = context.testClassifyError(new Error('Any error'));
      expect(result).toBeInstanceOf(BridgeDisposedError);
    });
  });

  describe('default classification', () => {
    it('classifies unmatched errors as BridgeExecutionError', () => {
      const result = context.testClassifyError(new Error('Random error'));
      expect(result).toBeInstanceOf(BridgeExecutionError);
    });

    it('handles string errors', () => {
      const result = context.testClassifyError('string error');
      expect(result).toBeInstanceOf(BridgeExecutionError);
      expect(result.message).toBe('string error');
    });
  });

  describe('cause preservation', () => {
    it('preserves original error as cause', () => {
      const original = new Error('Original');
      const result = context.testClassifyError(original);
      expect(result.cause).toBe(original);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BOUNDED EXECUTION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('BoundedContext Bounded Execution', () => {
  let context: TestContext;

  beforeEach(() => {
    context = new TestContext();
  });

  afterEach(async () => {
    if (context.state !== 'disposed') {
      await context.dispose();
    }
  });

  describe('auto-initialization', () => {
    it('auto-initializes when not ready', async () => {
      expect(context.state).toBe('idle');

      const result = await context.testExecute(async () => 42);

      expect(result).toBe(42);
      expect(context.state).toBe('ready');
    });
  });

  describe('timeout', () => {
    it('succeeds within timeout', async () => {
      await context.init();

      const result = await context.testExecute(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'success';
      }, { timeoutMs: 1000 });

      expect(result).toBe('success');
    });

    it('throws BridgeTimeoutError when timeout expires', async () => {
      await context.init();

      await expect(
        context.testExecute(async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return 'never';
        }, { timeoutMs: 10 })
      ).rejects.toThrow(BridgeTimeoutError);
    });

    it('disables timeout when timeoutMs is 0', async () => {
      await context.init();

      const result = await context.testExecute(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'success';
      }, { timeoutMs: 0 });

      expect(result).toBe('success');
    });
  });

  describe('retry', () => {
    it('retries on retryable errors', async () => {
      await context.init();
      let attempts = 0;

      const result = await context.testExecute(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('ECONNRESET');
        }
        return 'success';
      }, { retries: 5, retryDelayMs: 1 });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('does not retry non-retryable errors', async () => {
      await context.init();
      let attempts = 0;

      await expect(
        context.testExecute(async () => {
          attempts++;
          throw new Error('Logic error');
        }, { retries: 5, retryDelayMs: 1 })
      ).rejects.toThrow('Logic error');

      expect(attempts).toBe(1);
    });

    it('retries on timeout errors', async () => {
      await context.init();
      let attempts = 0;

      const result = await context.testExecute(async () => {
        attempts++;
        if (attempts < 2) {
          throw new BridgeTimeoutError('Timeout');
        }
        return 'success';
      }, { retries: 3, retryDelayMs: 1 });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('applies exponential backoff', async () => {
      await context.init();
      const timestamps: number[] = [];

      await expect(
        context.testExecute(async () => {
          timestamps.push(Date.now());
          throw new Error('ECONNRESET');
        }, { retries: 2, retryDelayMs: 20 })
      ).rejects.toThrow();

      // 3 attempts: initial, +20ms, +40ms
      expect(timestamps).toHaveLength(3);
      const delay1 = timestamps[1] - timestamps[0];
      const delay2 = timestamps[2] - timestamps[1];
      expect(delay1).toBeGreaterThanOrEqual(15); // ~20ms
      expect(delay2).toBeGreaterThanOrEqual(35); // ~40ms
    });
  });

  describe('abort signal', () => {
    it('throws on already-aborted signal', async () => {
      await context.init();
      const controller = new AbortController();
      controller.abort();

      await expect(
        context.testExecute(async () => 'never', { signal: controller.signal })
      ).rejects.toThrow(BridgeTimeoutError);
    });

    it('aborts during operation', async () => {
      await context.init();
      const controller = new AbortController();

      const promise = context.testExecute(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'never';
      }, { signal: controller.signal, timeoutMs: 5000 });

      setTimeout(() => controller.abort(), 10);

      await expect(promise).rejects.toThrow(BridgeTimeoutError);
    });

    it('honors abort signal even when timeout is disabled (timeoutMs: 0)', async () => {
      await context.init();
      const controller = new AbortController();

      const promise = context.testExecute(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'never';
      }, { signal: controller.signal, timeoutMs: 0 });

      setTimeout(() => controller.abort(), 10);

      await expect(promise).rejects.toThrow(BridgeTimeoutError);
    });

    it('throws on already-aborted signal even when timeout is disabled', async () => {
      await context.init();
      const controller = new AbortController();
      controller.abort();

      await expect(
        context.testExecute(async () => 'never', { signal: controller.signal, timeoutMs: 0 })
      ).rejects.toThrow(BridgeTimeoutError);
    });
  });

  describe('validation', () => {
    it('applies custom validation to results', async () => {
      await context.init();

      const validate = (result: number) => {
        if (result < 0) throw new Error('Must be positive');
        return result * 2;
      };

      const result = await context.testExecute(async () => 5, { validate });

      expect(result).toBe(10);
    });

    it('throws when validation fails', async () => {
      await context.init();

      const validate = (result: number) => {
        if (result < 0) throw new Error('Must be positive');
        return result;
      };

      await expect(
        context.testExecute(async () => -1, { validate })
      ).rejects.toThrow('Must be positive');
    });
  });

  describe('disposed state', () => {
    it('throws BridgeDisposedError after dispose', async () => {
      await context.init();
      await context.dispose();

      await expect(
        context.testExecute(async () => 'never')
      ).rejects.toThrow(BridgeDisposedError);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RESOURCE OWNERSHIP TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('BoundedContext Resource Ownership', () => {
  let context: TestContext;

  beforeEach(() => {
    context = new TestContext();
  });

  afterEach(async () => {
    if (context.state !== 'disposed') {
      await context.dispose();
    }
  });

  describe('trackResource', () => {
    it('tracks resources for disposal', async () => {
      const resource = new MockResource();
      context.testTrackResource(resource);

      expect(context.getResourceCount()).toBe(1);

      await context.dispose();
      expect(resource.disposed).toBe(true);
    });

    it('returns the tracked resource for chaining', () => {
      const resource = new MockResource();
      const result = context.testTrackResource(resource);
      expect(result).toBe(resource);
    });

    it('can track multiple resources', () => {
      context.testTrackResource(new MockResource());
      context.testTrackResource(new MockResource());
      context.testTrackResource(new MockResource());

      expect(context.getResourceCount()).toBe(3);
    });
  });

  describe('untrackResource', () => {
    it('removes resource from tracking', async () => {
      const resource = new MockResource();
      context.testTrackResource(resource);
      expect(context.getResourceCount()).toBe(1);

      const removed = context.testUntrackResource(resource);
      expect(removed).toBe(true);
      expect(context.getResourceCount()).toBe(0);

      await context.dispose();
      expect(resource.disposed).toBe(false);
    });

    it('returns false for untracked resource', () => {
      const resource = new MockResource();
      const removed = context.testUntrackResource(resource);
      expect(removed).toBe(false);
    });
  });

  describe('resourceCount', () => {
    it('accurately tracks resource count', () => {
      expect(context.getResourceCount()).toBe(0);

      const r1 = context.testTrackResource(new MockResource());
      expect(context.getResourceCount()).toBe(1);

      context.testTrackResource(new MockResource());
      expect(context.getResourceCount()).toBe(2);

      context.testUntrackResource(r1);
      expect(context.getResourceCount()).toBe(1);
    });
  });
});
