/**
 * Architecture Stories Verification Tests
 *
 * This test suite verifies that the BoundedContext implementation
 * addresses the acceptance criteria from architecture issues:
 * - #141: Unified numeric validation layer for NaN/Infinity handling
 * - #142: Shared BridgeLifecycle mixin for init/dispose state management
 * - #143: Standardized error classification across all bridges
 *
 * Related issues that should be addressed:
 * - #114, #95, #93, #87, #45 (via #141)
 * - #137, #116, #102, #69, #63, #57 (via #142)
 * - #120, #118, #94, #56, #49, #47 (via #143)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BoundedContext,
  type ContextState,
} from '../src/runtime/bounded-context.js';
import {
  BridgeDisposedError,
  BridgeError,
  BridgeExecutionError,
  BridgeProtocolError,
  BridgeTimeoutError,
} from '../src/runtime/errors.js';
import {
  isFiniteNumber,
  isPositiveNumber,
  isNonNegativeNumber,
  assertFiniteNumber,
  assertPositive,
  assertNonNegative,
  containsSpecialFloat,
  assertNoSpecialFloats,
  ValidationError,
} from '../src/runtime/validators.js';
import { NodeBridge } from '../src/runtime/node.js';
import { PyodideBridge } from '../src/runtime/pyodide.js';
import { HttpBridge } from '../src/runtime/http.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

class TestBridge extends BoundedContext {
  public initCalls = 0;
  public disposeCalls = 0;
  public shouldFailInit = false;
  public initDelay = 0;

  protected async doInit(): Promise<void> {
    this.initCalls++;
    if (this.initDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.initDelay));
    }
    if (this.shouldFailInit) {
      throw new Error('Init failed');
    }
  }

  protected async doDispose(): Promise<void> {
    this.disposeCalls++;
  }

  // Expose for testing
  public testClassifyError(error: unknown): BridgeError {
    return this.classifyError(error);
  }

  public testValidatePositive(value: unknown, name: string): number {
    return this.validatePositive(value, name);
  }

  public testValidateNumeric(value: unknown, name: string): number {
    return this.validateNumeric(value, name);
  }

  // RuntimeExecution stubs
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

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #141: UNIFIED NUMERIC VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Issue #141: Unified numeric validation layer', () => {
  describe('Acceptance: All bridge constructors validate numeric options', () => {
    it('validators reject NaN', () => {
      expect(isFiniteNumber(NaN)).toBe(false);
      expect(isPositiveNumber(NaN)).toBe(false);
      expect(() => assertFiniteNumber(NaN, 'test')).toThrow(ValidationError);
      expect(() => assertPositive(NaN, 'test')).toThrow(ValidationError);
    });

    it('validators reject Infinity', () => {
      expect(isFiniteNumber(Infinity)).toBe(false);
      expect(isFiniteNumber(-Infinity)).toBe(false);
      expect(isPositiveNumber(Infinity)).toBe(false);
      expect(() => assertFiniteNumber(Infinity, 'test')).toThrow(ValidationError);
    });

    it('validators reject negative numbers when positive required', () => {
      expect(isPositiveNumber(-1)).toBe(false);
      expect(isPositiveNumber(0)).toBe(false);
      expect(() => assertPositive(-1, 'test')).toThrow(ValidationError);
      expect(() => assertPositive(0, 'test')).toThrow(ValidationError);
    });

    it('validators accept valid positive numbers', () => {
      expect(isPositiveNumber(1)).toBe(true);
      expect(isPositiveNumber(0.001)).toBe(true);
      expect(assertPositive(42, 'test')).toBe(42);
    });
  });

  describe('Acceptance: Deep NaN/Infinity detection in arguments', () => {
    it('containsSpecialFloat detects NaN in nested objects', () => {
      expect(containsSpecialFloat({ a: { b: NaN } })).toBe(true);
      expect(containsSpecialFloat([1, [2, NaN]])).toBe(true);
      expect(containsSpecialFloat({ arr: [1, Infinity] })).toBe(true);
    });

    it('containsSpecialFloat returns false for valid data', () => {
      expect(containsSpecialFloat({ a: 1, b: 'str', c: null })).toBe(false);
      expect(containsSpecialFloat([1, 2, 3])).toBe(false);
    });

    it('assertNoSpecialFloats throws for invalid data', () => {
      expect(() => assertNoSpecialFloats({ x: NaN }, 'args')).toThrow(ValidationError);
      expect(() => assertNoSpecialFloats([Infinity], 'args')).toThrow(ValidationError);
    });

    it('assertNoSpecialFloats passes for valid data', () => {
      expect(() => assertNoSpecialFloats({ x: 1 }, 'args')).not.toThrow();
    });
  });

  describe('Acceptance: BoundedContext validation helpers', () => {
    let bridge: TestBridge;

    beforeEach(() => {
      bridge = new TestBridge();
    });

    afterEach(async () => {
      if (bridge.state !== 'disposed') {
        await bridge.dispose();
      }
    });

    it('validateNumeric rejects NaN/Infinity with BridgeProtocolError', () => {
      expect(() => bridge.testValidateNumeric(NaN, 'maxRetries')).toThrow(BridgeProtocolError);
      expect(() => bridge.testValidateNumeric(Infinity, 'maxRetries')).toThrow(BridgeProtocolError);
    });

    it('validatePositive rejects negative/zero with BridgeProtocolError', () => {
      expect(() => bridge.testValidatePositive(-1, 'maxRetries')).toThrow(BridgeProtocolError);
      expect(() => bridge.testValidatePositive(0, 'maxRetries')).toThrow(BridgeProtocolError);
    });
  });

  describe('Related issues coverage', () => {
    it('#114/#87: Guards against negative/NaN timeoutMs', () => {
      expect(() => assertPositive(NaN, 'timeoutMs')).toThrow();
      expect(() => assertPositive(-100, 'timeoutMs')).toThrow();
    });

    it('#95/#93: Rejects NaN/Infinity in serializable data', () => {
      expect(containsSpecialFloat({ result: NaN })).toBe(true);
      expect(() => assertNoSpecialFloats({ value: Infinity }, 'response')).toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #142: SHARED BRIDGE LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

describe('Issue #142: Shared BridgeLifecycle mixin', () => {
  describe('Acceptance: Consistent lifecycle state machine', () => {
    let bridge: TestBridge;

    beforeEach(() => {
      bridge = new TestBridge();
    });

    afterEach(async () => {
      if (bridge.state !== 'disposed') {
        await bridge.dispose();
      }
    });

    it('follows idle → initializing → ready path', async () => {
      expect(bridge.state).toBe('idle');

      bridge.initDelay = 20;
      const initPromise = bridge.init();

      expect(bridge.state).toBe('initializing');

      await initPromise;
      expect(bridge.state).toBe('ready');
    });

    it('follows ready → disposing → disposed path', async () => {
      await bridge.init();
      expect(bridge.state).toBe('ready');

      await bridge.dispose();
      expect(bridge.state).toBe('disposed');
    });
  });

  describe('Acceptance: Init failures allow retry (initPromise cleared)', () => {
    let bridge: TestBridge;

    beforeEach(() => {
      bridge = new TestBridge();
    });

    afterEach(async () => {
      if (bridge.state !== 'disposed') {
        await bridge.dispose();
      }
    });

    it('resets to idle on init failure, allowing retry', async () => {
      bridge.shouldFailInit = true;

      await expect(bridge.init()).rejects.toThrow();
      expect(bridge.state).toBe('idle');

      // Retry should work
      bridge.shouldFailInit = false;
      await bridge.init();
      expect(bridge.state).toBe('ready');
    });

    it('initPromise is cleared on failure (related #116)', async () => {
      bridge.shouldFailInit = true;

      await expect(bridge.init()).rejects.toThrow();

      // Second call should create a new promise, not return cached failure
      bridge.shouldFailInit = false;
      await bridge.init();
      expect(bridge.initCalls).toBe(2);
    });
  });

  describe('Acceptance: Post-dispose operations throw BridgeDisposedError', () => {
    let bridge: TestBridge;

    beforeEach(() => {
      bridge = new TestBridge();
    });

    it('init() throws BridgeDisposedError after dispose', async () => {
      await bridge.dispose();
      await expect(bridge.init()).rejects.toThrow(BridgeDisposedError);
    });

    it('init() throws BridgeDisposedError during dispose', async () => {
      const slowBridge = new (class extends TestBridge {
        protected async doDispose(): Promise<void> {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      })();

      await slowBridge.init();
      const disposePromise = slowBridge.dispose();

      // Try to init during disposal
      await expect(slowBridge.init()).rejects.toThrow(BridgeDisposedError);

      await disposePromise;
    });
  });

  describe('Acceptance: Dispose does not revive context', () => {
    it('dispose during init does not flip state back to ready', async () => {
      const bridge = new TestBridge();
      bridge.initDelay = 50;

      const initPromise = bridge.init();
      expect(bridge.state).toBe('initializing');

      await bridge.dispose();
      expect(bridge.state).toBe('disposed');

      // Wait for init to complete
      await initPromise;

      // State should stay disposed
      expect(bridge.state).toBe('disposed');
    });

    it('failed init during dispose does not reset to idle', async () => {
      const bridge = new TestBridge();
      bridge.initDelay = 50;
      bridge.shouldFailInit = true;

      const initPromise = bridge.init();
      await bridge.dispose();

      await expect(initPromise).rejects.toThrow();

      // State should stay disposed, not reset to idle
      expect(bridge.state).toBe('disposed');
    });
  });

  describe('Related issues coverage', () => {
    it('#137: Robust initialization state tracking', async () => {
      const bridge = new TestBridge();
      bridge.initDelay = 20;

      // Concurrent init calls should deduplicate
      const [r1, r2, r3] = await Promise.all([bridge.init(), bridge.init(), bridge.init()]);

      expect(bridge.initCalls).toBe(1);
      await bridge.dispose();
    });

    it('#69: Dispose resets state properly', async () => {
      const bridge = new TestBridge();
      await bridge.init();
      await bridge.dispose();

      expect(bridge.state).toBe('disposed');
      expect(bridge.isDisposed).toBe(true);
    });

    it('#57: Retry after init failure', async () => {
      const bridge = new TestBridge();
      bridge.shouldFailInit = true;

      await expect(bridge.init()).rejects.toThrow();
      expect(bridge.state).toBe('idle');

      bridge.shouldFailInit = false;
      await bridge.init();
      expect(bridge.state).toBe('ready');

      await bridge.dispose();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ISSUE #143: STANDARDIZED ERROR CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Issue #143: Standardized error classification', () => {
  let bridge: TestBridge;

  beforeEach(() => {
    bridge = new TestBridge();
  });

  afterEach(async () => {
    if (bridge.state !== 'disposed') {
      await bridge.dispose();
    }
  });

  describe('Acceptance: Consistent Bridge* error types', () => {
    it('classifies timeout errors as BridgeTimeoutError', () => {
      expect(bridge.testClassifyError(new Error('timeout'))).toBeInstanceOf(BridgeTimeoutError);
      expect(bridge.testClassifyError(new Error('ETIMEDOUT'))).toBeInstanceOf(BridgeTimeoutError);
      expect(bridge.testClassifyError(new Error('timed out'))).toBeInstanceOf(BridgeTimeoutError);
      expect(bridge.testClassifyError(new Error('aborted'))).toBeInstanceOf(BridgeTimeoutError);
    });

    it('classifies protocol errors as BridgeProtocolError', () => {
      expect(bridge.testClassifyError(new Error('protocol error'))).toBeInstanceOf(BridgeProtocolError);
      expect(bridge.testClassifyError(new Error('invalid json'))).toBeInstanceOf(BridgeProtocolError);
      expect(bridge.testClassifyError(new Error('parse error'))).toBeInstanceOf(BridgeProtocolError);
      expect(bridge.testClassifyError(new Error('unexpected token'))).toBeInstanceOf(BridgeProtocolError);
      expect(bridge.testClassifyError(new Error('not found'))).toBeInstanceOf(BridgeProtocolError);
    });

    it('classifies disposed state errors as BridgeDisposedError', async () => {
      await bridge.dispose();
      expect(bridge.testClassifyError(new Error('any error'))).toBeInstanceOf(BridgeDisposedError);
    });

    it('classifies unknown errors as BridgeExecutionError', () => {
      expect(bridge.testClassifyError(new Error('random error'))).toBeInstanceOf(BridgeExecutionError);
    });
  });

  describe('Acceptance: Errors preserve cause', () => {
    it('original error is preserved as cause', () => {
      const original = new Error('Original error');
      const classified = bridge.testClassifyError(original);

      expect(classified.cause).toBe(original);
    });
  });

  describe('Acceptance: Existing BridgeErrors pass through', () => {
    it('does not double-wrap BridgeError instances', () => {
      const timeout = new BridgeTimeoutError('test');
      expect(bridge.testClassifyError(timeout)).toBe(timeout);

      const protocol = new BridgeProtocolError('test');
      expect(bridge.testClassifyError(protocol)).toBe(protocol);
    });
  });

  describe('Related issues coverage', () => {
    it('#118: Timeouts classified as BridgeTimeoutError', () => {
      const err = bridge.testClassifyError(new Error('Request timed out after 5000ms'));
      expect(err).toBeInstanceOf(BridgeTimeoutError);
    });

    it('#118/#120: Protocol errors classified as BridgeProtocolError', () => {
      const jsonErr = bridge.testClassifyError(new Error('Invalid JSON in response'));
      expect(jsonErr).toBeInstanceOf(BridgeProtocolError);
    });

    it('#94: Python ProtocolError pattern matches', () => {
      const err = bridge.testClassifyError(new Error('Protocol violation from Python'));
      expect(err).toBeInstanceOf(BridgeProtocolError);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ALL BRIDGES EXTEND BOUNDED CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

describe('All bridges extend BoundedContext', () => {
  it('NodeBridge extends BoundedContext', () => {
    const bridge = new NodeBridge();
    expect(bridge).toBeInstanceOf(BoundedContext);
    expect(typeof bridge.init).toBe('function');
    expect(typeof bridge.dispose).toBe('function');
    expect(bridge.state).toBe('idle');
  });

  it('PyodideBridge extends BoundedContext', () => {
    const bridge = new PyodideBridge();
    expect(bridge).toBeInstanceOf(BoundedContext);
    expect(typeof bridge.init).toBe('function');
    expect(typeof bridge.dispose).toBe('function');
    expect(bridge.state).toBe('idle');
  });

  it('HttpBridge extends BoundedContext', () => {
    const bridge = new HttpBridge();
    expect(bridge).toBeInstanceOf(BoundedContext);
    expect(typeof bridge.init).toBe('function');
    expect(typeof bridge.dispose).toBe('function');
    expect(bridge.state).toBe('idle');
  });
});
