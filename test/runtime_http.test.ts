import { afterEach, describe, expect, it, vi } from 'vitest';

import { BridgeProtocolError } from '../src/runtime/errors.js';
import { HttpBridge } from '../src/runtime/http.js';

const originalFetch = globalThis.fetch;

describe('HttpBridge serialization guardrails', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('surfaces BigInt args serialization failures as BridgeProtocolError', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const bridge = new HttpBridge({ baseURL: 'http://localhost:8000' });
    try {
      try {
        await bridge.call('math', 'sqrt', [1n]);
        expect.fail('Expected serialization failure');
      } catch (error) {
        expect(error).toBeInstanceOf(BridgeProtocolError);
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toMatch(/JSON serialization failed/i);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await bridge.dispose();
    }
  });

  it('surfaces circular args serialization failures as BridgeProtocolError', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const circular: { self?: unknown } = {};
    circular.self = circular;

    const bridge = new HttpBridge({ baseURL: 'http://localhost:8000' });
    try {
      try {
        await bridge.call('math', 'sqrt', [circular]);
        expect.fail('Expected serialization failure');
      } catch (error) {
        expect(error).toBeInstanceOf(BridgeProtocolError);
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toMatch(/JSON serialization failed/i);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await bridge.dispose();
    }
  });
});
