/**
 * Transport framing (tywrap-frame/1) — W1 foundation tests.
 *
 * W1 lays the protocol-negotiation foundation with NO runtime behavior change:
 *  - the `tywrap-frame/1` framing constants exist;
 *  - the `meta`/BridgeInfo validator accepts an OLD payload (no transport block)
 *    AND a NEW payload (with a transport block, carried through);
 *  - the validator accepts each honest BridgeBackend identity and tolerates a
 *    null pid for non-subprocess backends.
 *
 * The validator (`validateBridgeInfoPayload`) is module-private in rpc-client.ts,
 * so it is exercised end-to-end through `RpcClient.getBridgeInfo()` with a stub
 * Transport whose `send` returns a crafted `meta` response.
 */

import { describe, it, expect } from 'vitest';

import {
  FRAME_PROTOCOL_ID,
  FRAME_PROTOCOL_VERSION,
  PROTOCOL_ID,
  TYWRAP_PROTOCOL_VERSION,
  type ChunkFrame,
  type Transport,
  type TransportCapabilities,
} from '../src/runtime/transport.js';
import { RpcClient } from '../src/runtime/rpc-client.js';
import { BridgeProtocolError } from '../src/runtime/errors.js';
import type { BridgeBackend, BridgeInfo } from '../src/types/index.js';

// =============================================================================
// FIXTURES
// =============================================================================

/** A wire-shaped meta result (what Python's build_meta returns). */
function metaResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: PROTOCOL_ID,
    protocolVersion: TYWRAP_PROTOCOL_VERSION,
    bridge: 'python-subprocess',
    pythonVersion: '3.12.1',
    pid: 4242,
    codecFallback: 'none',
    arrowAvailable: true,
    scipyAvailable: false,
    torchAvailable: false,
    sklearnAvailable: false,
    instances: 0,
    ...overrides,
  };
}

/**
 * A stub Transport whose `send` returns one crafted RPC response string. Drives
 * the real RpcClient.getBridgeInfo() path (which runs validateBridgeInfoPayload).
 */
function stubTransportReturning(result: unknown): Transport {
  const capabilities: TransportCapabilities = {
    backend: 'subprocess',
    supportsArrow: true,
    supportsBinary: true,
    supportsChunking: false,
    supportsStreaming: false,
    maxFrameBytes: Number.POSITIVE_INFINITY,
  };
  return {
    init: async () => {},
    send: async () => JSON.stringify({ id: 0, protocol: PROTOCOL_ID, result }),
    dispose: async () => {},
    isReady: true,
    capabilities: () => capabilities,
  };
}

function clientReturning(result: unknown): RpcClient {
  return new RpcClient({ transport: stubTransportReturning(result) });
}

// =============================================================================
// FRAMING CONSTANTS
// =============================================================================

describe('tywrap-frame/1 framing constants', () => {
  it('FRAME_PROTOCOL_ID is present and distinct from the logical PROTOCOL_ID', () => {
    expect(FRAME_PROTOCOL_ID).toBe('tywrap-frame/1');
    expect(FRAME_PROTOCOL_ID).not.toBe(PROTOCOL_ID);
  });

  it('FRAME_PROTOCOL_VERSION is derived from the trailing number', () => {
    expect(FRAME_PROTOCOL_VERSION).toBe(1);
    expect(FRAME_PROTOCOL_VERSION).toBe(Number.parseInt(FRAME_PROTOCOL_ID.split('/')[1] ?? '', 10));
  });

  it('ChunkFrame envelope shape type-checks against the spec', () => {
    // Compile-time assertion: the spec'd envelope is assignable to ChunkFrame.
    const frame: ChunkFrame = {
      __tywrap_frame__: 'chunk',
      frameProtocol: FRAME_PROTOCOL_ID,
      stream: 'response',
      id: 42,
      seq: 0,
      total: 8,
      totalBytes: 7340032,
      encoding: 'utf8-slice',
      data: '...',
    };
    expect(frame.frameProtocol).toBe(FRAME_PROTOCOL_ID);
    expect(frame.encoding).toBe('utf8-slice');
  });
});

// =============================================================================
// VALIDATOR — BACKWARD COMPATIBILITY (no transport block)
// =============================================================================

describe('validateBridgeInfoPayload — old payload (no transport block)', () => {
  it('accepts a subprocess meta payload without a transport block', async () => {
    const client = clientReturning(metaResult());
    const info = await client.getBridgeInfo();
    expect(info.bridge).toBe('python-subprocess');
    expect(info.pid).toBe(4242);
    expect(info.transport).toBeUndefined();
  });
});

// =============================================================================
// VALIDATOR — NEW PAYLOAD (transport block carried through)
// =============================================================================

describe('validateBridgeInfoPayload — new payload (transport block)', () => {
  it('carries through a valid transport negotiation block', async () => {
    const client = clientReturning(
      metaResult({
        transport: {
          frameProtocol: FRAME_PROTOCOL_ID,
          supportsChunking: true,
          maxFrameBytes: 104857600,
        },
      })
    );
    const info: BridgeInfo = await client.getBridgeInfo();
    expect(info.transport).toEqual({
      frameProtocol: FRAME_PROTOCOL_ID,
      supportsChunking: true,
      maxFrameBytes: 104857600,
    });
  });

  it('rejects a transport block with a non-boolean supportsChunking', async () => {
    const client = clientReturning(
      metaResult({
        transport: {
          frameProtocol: FRAME_PROTOCOL_ID,
          supportsChunking: 'yes',
          maxFrameBytes: 104857600,
        },
      })
    );
    await expect(client.getBridgeInfo()).rejects.toThrow(BridgeProtocolError);
  });

  it('rejects a transport block with a non-positive maxFrameBytes', async () => {
    const client = clientReturning(
      metaResult({
        transport: {
          frameProtocol: FRAME_PROTOCOL_ID,
          supportsChunking: true,
          maxFrameBytes: 0,
        },
      })
    );
    await expect(client.getBridgeInfo()).rejects.toThrow(BridgeProtocolError);
  });

  it('rejects a transport block with an empty frameProtocol', async () => {
    const client = clientReturning(
      metaResult({
        transport: { frameProtocol: '', supportsChunking: true, maxFrameBytes: 1024 },
      })
    );
    await expect(client.getBridgeInfo()).rejects.toThrow(BridgeProtocolError);
  });

  it('rejects a non-object transport block', async () => {
    const client = clientReturning(metaResult({ transport: 'tywrap-frame/1' }));
    await expect(client.getBridgeInfo()).rejects.toThrow(BridgeProtocolError);
  });
});

// =============================================================================
// VALIDATOR — BACKEND UNION + OPTIONAL PID
// =============================================================================

describe('validateBridgeInfoPayload — backend identity + pid', () => {
  const backends: BridgeBackend[] = ['python-subprocess', 'pyodide', 'http'];

  for (const backend of backends) {
    it(`accepts bridge="${backend}"`, async () => {
      // Non-subprocess backends carry no local process; report pid: null.
      const pid = backend === 'python-subprocess' ? 4242 : null;
      const client = clientReturning(metaResult({ bridge: backend, pid }));
      const info = await client.getBridgeInfo();
      expect(info.bridge).toBe(backend);
      expect(info.pid).toBe(pid);
    });
  }

  it('tolerates a null pid (in-WASM / no local process)', async () => {
    const client = clientReturning(metaResult({ bridge: 'pyodide', pid: null }));
    const info = await client.getBridgeInfo();
    expect(info.pid).toBeNull();
  });

  it('still accepts a positive integer pid for subprocess', async () => {
    const client = clientReturning(metaResult({ bridge: 'python-subprocess', pid: 99 }));
    const info = await client.getBridgeInfo();
    expect(info.pid).toBe(99);
  });

  it('rejects an unknown bridge value', async () => {
    const client = clientReturning(metaResult({ bridge: 'some-other-bridge' }));
    await expect(client.getBridgeInfo()).rejects.toThrow(BridgeProtocolError);
  });

  it('rejects a zero pid', async () => {
    const client = clientReturning(metaResult({ pid: 0 }));
    await expect(client.getBridgeInfo()).rejects.toThrow(BridgeProtocolError);
  });

  it('rejects a negative pid', async () => {
    const client = clientReturning(metaResult({ pid: -1 }));
    await expect(client.getBridgeInfo()).rejects.toThrow(BridgeProtocolError);
  });

  it('rejects a non-integer pid', async () => {
    const client = clientReturning(metaResult({ pid: 3.14 }));
    await expect(client.getBridgeInfo()).rejects.toThrow(BridgeProtocolError);
  });
});
