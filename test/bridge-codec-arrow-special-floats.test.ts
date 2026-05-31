import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/codec.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/utils/codec.js')>('../src/utils/codec.js');

  return {
    ...actual,
    // Arrow decoders can introduce NaN/Infinity from binary representations.
    // This mock forces that condition so we can validate the post-decode special-float check.
    decodeValueAsync: vi.fn(async () => ({ introduced: NaN })),
  };
});

describe('BridgeCodec.decodeResponseAsync - post-Arrow special float validation', () => {
  it('rejects special floats introduced by Arrow decoding', async () => {
    const { BridgeCodec } = await import('../src/runtime/bridge-codec.js');
    const { BridgeCodecError } = await import('../src/runtime/errors.js');
    const { PROTOCOL_ID } = await import('../src/runtime/transport.js');

    const codec = new BridgeCodec({ rejectSpecialFloats: true });
    const payload = JSON.stringify({
      id: 1,
      protocol: PROTOCOL_ID,
      result: { __tywrap_arrow__: true },
    });

    const p = codec.decodeResponseAsync(payload);
    await expect(p).rejects.toThrow(BridgeCodecError);
    await expect(p).rejects.toThrow(/non-finite number/);
  });
});
