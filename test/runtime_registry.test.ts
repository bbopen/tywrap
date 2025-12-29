import { describe, it, expect, afterEach } from 'vitest';
import { clearRuntimeBridge, getRuntimeBridge, setRuntimeBridge } from '../src/runtime/index.js';

describe('Runtime bridge registry', () => {
  afterEach(() => {
    clearRuntimeBridge();
  });

  it('throws when no bridge is configured', () => {
    clearRuntimeBridge();
    expect(() => getRuntimeBridge()).toThrow('No runtime bridge configured');
  });

  it('returns the configured bridge', () => {
    const bridge = {
      call: async () => 42,
      instantiate: async () => 'handle',
      callMethod: async () => 1,
      disposeInstance: async () => {},
      dispose: async () => {},
    };

    setRuntimeBridge(bridge);
    expect(getRuntimeBridge()).toBe(bridge);
  });
});
