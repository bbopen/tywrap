import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  BridgeCodecError,
  BridgeExecutionError,
  BridgeTimeoutError,
} from '../src/runtime/errors.js';
import { HttpBridge } from '../src/runtime/http.js';
import { clearArrowDecoder, hasArrowDecoder } from '../src/utils/codec.js';

const originalFetch = globalThis.fetch;

async function withHttpFixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseURL: string) => Promise<void>
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error('Failed to resolve test HTTP fixture address');
  }
  const baseURL = `http://127.0.0.1:${(address as AddressInfo).port}`;

  try {
    await run(baseURL);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
}

describe('HttpBridge serialization guardrails', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('surfaces BigInt args serialization failures as BridgeCodecError', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const bridge = new HttpBridge({ baseURL: 'http://localhost:8000' });
    try {
      try {
        await bridge.call('math', 'sqrt', [1n]);
        expect.fail('Expected serialization failure');
      } catch (error) {
        expect(error).toBeInstanceOf(BridgeCodecError);
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toMatch(/JSON serialization failed/i);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await bridge.dispose();
    }
  });

  it('surfaces circular args serialization failures as BridgeCodecError', async () => {
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
        expect(error).toBeInstanceOf(BridgeCodecError);
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toMatch(/JSON serialization failed/i);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await bridge.dispose();
    }
  });
});

describe('HttpBridge runtime error handling', () => {
  it('surfaces invalid JSON responses as BridgeCodecError with payload context', async () => {
    await withHttpFixture(
      (_, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end('{"id": 1, "result": ');
      },
      async baseURL => {
        const bridge = new HttpBridge({ baseURL });
        try {
          try {
            await bridge.call('math', 'sqrt', [4]);
            expect.fail('Expected JSON parse failure');
          } catch (error) {
            expect(error).toBeInstanceOf(BridgeCodecError);
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toMatch(/JSON parse failed/i);
            expect(message).toMatch(/Payload snippet:/i);
          }
        } finally {
          await bridge.dispose();
        }
      }
    );
  });

  it('treats top-level error payloads as execution failures', async () => {
    await withHttpFixture(
      (_, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: {
              type: 'ValueError',
              message: 'bad input',
            },
          })
        );
      },
      async baseURL => {
        const bridge = new HttpBridge({ baseURL });
        try {
          try {
            await bridge.call('math', 'sqrt', [4]);
            expect.fail('Expected error payload failure');
          } catch (error) {
            expect(error).toBeInstanceOf(BridgeExecutionError);
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toMatch(/ValueError: bad input/);
          }
        } finally {
          await bridge.dispose();
        }
      }
    );
  });

  it('surfaces HTTP 500 JSON body context in execution errors', async () => {
    await withHttpFixture(
      (_, res) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: {
              type: 'RuntimeError',
              message: 'server exploded',
            },
          })
        );
      },
      async baseURL => {
        const bridge = new HttpBridge({ baseURL });
        try {
          try {
            await bridge.call('math', 'sqrt', [4]);
            expect.fail('Expected HTTP execution failure');
          } catch (error) {
            expect(error).toBeInstanceOf(BridgeExecutionError);
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toMatch(/HTTP 500/);
            expect(message).toMatch(/server exploded/);
          }
        } finally {
          await bridge.dispose();
        }
      }
    );
  });

  it('surfaces consistent timeout errors with context', async () => {
    await withHttpFixture(
      (_, res) => {
        const timer = setTimeout(() => {
          if (!res.writableEnded) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ id: 1, result: 4 }));
          }
        }, 200);
        res.on('close', () => {
          clearTimeout(timer);
        });
      },
      async baseURL => {
        const bridge = new HttpBridge({ baseURL, timeoutMs: 50 });
        try {
          try {
            await bridge.call('math', 'sqrt', [4]);
            expect.fail('Expected timeout');
          } catch (error) {
            expect(error).toBeInstanceOf(BridgeTimeoutError);
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toMatch(/timed out|aborted/i);
          }
        } finally {
          await bridge.dispose();
        }
      }
    );
  });
});

describe('HttpBridge Arrow auto-registration', () => {
  it('registers Arrow decoder during init when apache-arrow is available', async () => {
    let arrowAvailable = false;
    try {
      await import('apache-arrow');
      arrowAvailable = true;
    } catch {
      arrowAvailable = false;
    }
    if (!arrowAvailable) return;

    clearArrowDecoder();
    expect(hasArrowDecoder()).toBe(false);

    const bridge = new HttpBridge({ baseURL: 'http://localhost:8000' });
    try {
      await bridge.init();
      expect(hasArrowDecoder()).toBe(true);
    } finally {
      await bridge.dispose();
    }
  });
});
