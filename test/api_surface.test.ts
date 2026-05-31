import { describe, expect, it } from 'vitest';

import * as RootApi from '../src/index.js';
import * as RuntimeApi from '../src/runtime/index.js';

/**
 * Runtime snapshot of the package's public surface.
 *
 * This locks the value-level exports actually present at runtime. The
 * complementary type-only lock lives in test-d/types.test-d.ts (it also catches
 * type-only moves, which Object.keys cannot see). When the public surface
 * changes on purpose, update both snapshots in the same commit.
 */
describe('public API surface', () => {
  it('exposes exactly the intended root exports', () => {
    const expected = [
      'BridgeCodecError',
      'BridgeDisposedError',
      'BridgeError',
      'BridgeExecutionError',
      'BridgeProtocolError',
      'BridgeTimeoutError',
      'VERSION',
      'autoRegisterArrowDecoder',
      'clearArrowDecoder',
      'decodeValue',
      'decodeValueAsync',
      'default',
      'defineConfig',
      'detectRuntime',
      'generate',
      'isBrowser',
      'isBun',
      'isDeno',
      'isNodejs',
      'registerArrowDecoder',
      'resolveConfig',
      'tywrap',
    ];
    expect(Object.keys(RootApi).sort()).toEqual(expected);
  });

  it('keeps the default export pointing at the tywrap factory', () => {
    expect(RootApi.default).toBe(RootApi.tywrap);
  });

  it('does not leak runtime plumbing from the package root', () => {
    const root = RootApi as Record<string, unknown>;
    // Codec + transport contract moved to tywrap/runtime.
    expect(root.SafeCodec).toBeUndefined();
    expect(root.isTransport).toBeUndefined();
    expect(root.PROTOCOL_ID).toBeUndefined();
    // Registry moved to tywrap/runtime.
    expect(root.setRuntimeBridge).toBeUndefined();
    expect(root.getRuntimeBridge).toBeUndefined();
    expect(root.clearRuntimeBridge).toBeUndefined();
    // Concrete bridges live behind their own subpaths.
    expect(root.NodeBridge).toBeUndefined();
    expect(root.PyodideBridge).toBeUndefined();
    expect(root.HttpBridge).toBeUndefined();
    // Deprecated alias removed.
    expect(root.RuntimeBridge).toBeUndefined();
    // Other runtime plumbing is non-public.
    expect(root.RpcClient).toBeUndefined();
    expect(root.DisposableBase).toBeUndefined();
    expect(root.WorkerPool).toBeUndefined();
    expect(root.SubprocessTransport).toBeUndefined();
    expect(root.ValidationError).toBeUndefined();
  });

  it('exposes the registry and codec/transport contract from tywrap/runtime', () => {
    expect(typeof RuntimeApi.setRuntimeBridge).toBe('function');
    expect(typeof RuntimeApi.getRuntimeBridge).toBe('function');
    expect(typeof RuntimeApi.clearRuntimeBridge).toBe('function');
    expect(typeof RuntimeApi.SafeCodec).toBe('function');
    expect(typeof RuntimeApi.isTransport).toBe('function');
    expect(typeof RuntimeApi.isProtocolMessage).toBe('function');
    expect(typeof RuntimeApi.isProtocolResponse).toBe('function');
    expect(RuntimeApi.PROTOCOL_ID).toBe('tywrap/1');
  });
});
