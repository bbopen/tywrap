/**
 * Disposable Test Suite
 *
 * Tests for the Disposable interface and helper functions.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isDisposable,
  safeDispose,
  disposeAll,
  type Disposable,
} from '../src/runtime/disposable.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

class MockDisposable implements Disposable {
  disposed = false;
  disposeCount = 0;

  async dispose(): Promise<void> {
    this.disposed = true;
    this.disposeCount++;
  }
}

class FailingDisposable implements Disposable {
  constructor(private errorMessage: string = 'Dispose failed') {}

  async dispose(): Promise<void> {
    throw new Error(this.errorMessage);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// isDisposable
// ═══════════════════════════════════════════════════════════════════════════

describe('isDisposable', () => {
  it('returns true for objects with dispose method', () => {
    const disposable = new MockDisposable();
    expect(isDisposable(disposable)).toBe(true);
  });

  it('returns true for plain objects with dispose function', () => {
    const obj = {
      dispose: async () => {},
    };
    expect(isDisposable(obj)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isDisposable(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isDisposable(undefined)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isDisposable(42)).toBe(false);
    expect(isDisposable('string')).toBe(false);
    expect(isDisposable(true)).toBe(false);
  });

  it('returns false for objects without dispose method', () => {
    expect(isDisposable({})).toBe(false);
    expect(isDisposable({ close: () => {} })).toBe(false);
  });

  it('returns false for objects with non-function dispose', () => {
    expect(isDisposable({ dispose: 'not a function' })).toBe(false);
    expect(isDisposable({ dispose: 42 })).toBe(false);
    expect(isDisposable({ dispose: null })).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isDisposable([])).toBe(false);
    expect(isDisposable([{ dispose: () => {} }])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// safeDispose
// ═══════════════════════════════════════════════════════════════════════════

describe('safeDispose', () => {
  it('calls dispose on disposable objects', async () => {
    const disposable = new MockDisposable();
    await safeDispose(disposable);
    expect(disposable.disposed).toBe(true);
  });

  it('does nothing for non-disposable objects', async () => {
    await expect(safeDispose({})).resolves.toBeUndefined();
    await expect(safeDispose(null)).resolves.toBeUndefined();
    await expect(safeDispose(undefined)).resolves.toBeUndefined();
    await expect(safeDispose(42)).resolves.toBeUndefined();
  });

  it('propagates errors from dispose', async () => {
    const failing = new FailingDisposable('Test error');
    await expect(safeDispose(failing)).rejects.toThrow('Test error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// disposeAll
// ═══════════════════════════════════════════════════════════════════════════

describe('disposeAll', () => {
  it('disposes all resources in order', async () => {
    const order: number[] = [];
    const resources = [1, 2, 3].map(i => ({
      dispose: async () => {
        order.push(i);
      },
    }));

    const errors = await disposeAll(resources);

    expect(errors).toHaveLength(0);
    expect(order).toEqual([1, 2, 3]);
  });

  it('returns empty array when all succeed', async () => {
    const resources = [new MockDisposable(), new MockDisposable()];
    const errors = await disposeAll(resources);

    expect(errors).toHaveLength(0);
    expect(resources.every(r => r.disposed)).toBe(true);
  });

  it('collects errors from failing resources', async () => {
    const resources = [
      new FailingDisposable('Error 1'),
      new FailingDisposable('Error 2'),
    ];

    const errors = await disposeAll(resources);

    expect(errors).toHaveLength(2);
    expect(errors[0].message).toBe('Error 1');
    expect(errors[1].message).toBe('Error 2');
  });

  it('continues disposing after errors', async () => {
    const successful = new MockDisposable();
    const resources = [
      new FailingDisposable('First error'),
      successful,
      new FailingDisposable('Second error'),
    ];

    const errors = await disposeAll(resources);

    expect(errors).toHaveLength(2);
    expect(successful.disposed).toBe(true);
  });

  it('converts non-Error throws to Error', async () => {
    const resource = {
      dispose: async () => {
        throw 'string error';
      },
    };

    const errors = await disposeAll([resource]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0].message).toBe('string error');
  });

  it('handles empty resource list', async () => {
    const errors = await disposeAll([]);
    expect(errors).toHaveLength(0);
  });

  it('works with Set of resources', async () => {
    const resources = new Set([new MockDisposable(), new MockDisposable()]);
    const errors = await disposeAll(resources);

    expect(errors).toHaveLength(0);
    for (const r of resources) {
      expect(r.disposed).toBe(true);
    }
  });

  it('handles mixed success and failure', async () => {
    const ok1 = new MockDisposable();
    const ok2 = new MockDisposable();
    const fail1 = new FailingDisposable('fail1');

    const errors = await disposeAll([ok1, fail1, ok2]);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('fail1');
    expect(ok1.disposed).toBe(true);
    expect(ok2.disposed).toBe(true);
  });
});
