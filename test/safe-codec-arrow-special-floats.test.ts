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

describe('SafeCodec.decodeResponseAsync - post-Arrow special float validation', () => {
  it('rejects special floats introduced by Arrow decoding', async () => {
    const { SafeCodec } = await import('../src/runtime/safe-codec.js');
    const { BridgeCodecError } = await import('../src/runtime/errors.js');

    const codec = new SafeCodec({ rejectSpecialFloats: true });
    const payload = JSON.stringify({
      id: 1,
      protocol: 'tywrap/1',
      result: { __tywrap_arrow__: true },
    });

    await expect(codec.decodeResponseAsync(payload)).rejects.toThrow(BridgeCodecError);
    await expect(codec.decodeResponseAsync(payload)).rejects.toThrow(/non-finite number/);
  });
});
