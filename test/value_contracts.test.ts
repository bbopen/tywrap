import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeCodec } from '../src/runtime/bridge-codec.js';
import { DecodedProvenance } from '../src/runtime/decoded-provenance.js';
import {
  MAX_SAFE_JSON_INTEGER,
  VALUE_CONTRACT_REVISION,
  isSafeJsonInteger,
} from '../src/contracts/value-contract.js';
import {
  clearArrowDecoder,
  decodeValue,
  decodeValueAsync,
  registerArrowDecoder,
  type ArrowTable,
} from '../src/utils/codec.js';

const specification = JSON.parse(
  readFileSync(new URL('../docs/maintainers/value-contracts.v2.json', import.meta.url), 'utf8')
) as {
  revision: number;
  rules: {
    integer: { minimum: number; maximum: number };
    bytes: { decodedAs: string };
  };
};
const fixtures = JSON.parse(
  readFileSync(
    new URL('../docs/maintainers/value-contract-fixtures.v2.json', import.meta.url),
    'utf8'
  )
) as {
  revision: number;
  bytesCases: readonly {
    logicalHex: string;
    requestEnvelope: object;
    responseEnvelope: object;
    decodedAs: string;
  }[];
  binary16Cases: readonly { wordHex: string; outcome: string }[];
};

function referenceBinary16(bits: number): number {
  const sign = (bits & 0x8000) << 16;
  let exponent = (bits >>> 10) & 0x1f;
  let fraction = bits & 0x03ff;
  let floatBits: number;

  if (exponent === 0 && fraction !== 0) {
    exponent = -14;
    while ((fraction & 0x0400) === 0) {
      fraction <<= 1;
      exponent -= 1;
    }
    fraction &= 0x03ff;
    floatBits = sign | ((exponent + 127) << 23) | (fraction << 13);
  } else if (exponent === 0) {
    floatBits = sign;
  } else {
    floatBits = sign | ((exponent + 112) << 23) | (fraction << 13);
  }

  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, floatBits, true);
  return view.getFloat32(0, true);
}

function envelope(shape: number[]): object {
  return {
    __tywrap__: 'ndarray',
    codecVersion: 1,
    encoding: 'arrow',
    b64: 'AA==',
    shape,
    dtype: 'float16',
  };
}

function registerWords(words: readonly number[]): void {
  registerArrowDecoder(
    () =>
      ({
        getChildAt: () => ({ toArray: () => Uint16Array.from(words) }),
      }) as ArrowTable
  );
}

afterEach(() => clearArrowDecoder());

describe('frozen value policy', () => {
  it('keeps the TypeScript safe-integer range equal to the JSON specification', () => {
    expect(VALUE_CONTRACT_REVISION).toBe(specification.revision);
    expect(fixtures.revision).toBe(specification.revision);
    expect(MAX_SAFE_JSON_INTEGER).toBe(specification.rules.integer.maximum);
    expect(-MAX_SAFE_JSON_INTEGER).toBe(specification.rules.integer.minimum);
    expect(isSafeJsonInteger(MAX_SAFE_JSON_INTEGER)).toBe(true);
    expect(isSafeJsonInteger(-MAX_SAFE_JSON_INTEGER)).toBe(true);
    expect(isSafeJsonInteger(2 ** 53)).toBe(false);
    expect(isSafeJsonInteger(-(2 ** 53))).toBe(false);
    expect(isSafeJsonInteger(1.5)).toBe(false);
  });

  it('matches the shared bytes request and response fixtures', async () => {
    const codec = new BridgeCodec();
    expect(specification.rules.bytes.decodedAs).toBe('JavaScript Uint8Array');
    for (const fixture of fixtures.bytesCases) {
      const bytes = Uint8Array.from(Buffer.from(fixture.logicalHex, 'hex'));
      const request = JSON.parse(codec.encodeRequest({ value: bytes }));
      expect(request.value).toEqual(fixture.requestEnvelope);

      const decoded = await codec.decodeResponseAsync<Uint8Array>(
        JSON.stringify({ id: 1, protocol: 'tywrap/1', result: fixture.responseEnvelope })
      );
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect([...decoded]).toEqual([...bytes]);
      expect(`Uint8Array[${[...decoded].join(',')}]`).toBe(fixture.decodedAs);
    }
  });
});

describe('Arrow float16 value contract', () => {
  it('matches the fixed proof fixtures', () => {
    for (const fixture of fixtures.binary16Cases) {
      registerWords([Number.parseInt(fixture.wordHex, 16)]);
      if (fixture.outcome === 'reject') {
        expect(() => decodeValue(envelope([1]))).toThrow(/non-finite float16/);
      } else {
        const decoded = decodeValue(envelope([1])) as number[];
        expect(Object.is(decoded[0], Number(fixture.outcome)), fixture.wordHex).toBe(true);
      }
    }
  });

  it('matches an independent float32 bit reference for every finite binary16 word', () => {
    const words = Array.from({ length: 0x10000 }, (_, word) => word).filter(
      word => ((word >>> 10) & 0x1f) !== 0x1f
    );
    registerWords(words);
    const decoded = decodeValue(envelope([words.length])) as number[];
    expect(decoded).toHaveLength(words.length);
    for (let index = 0; index < words.length; index += 1) {
      if (!Object.is(decoded[index], referenceBinary16(words[index] as number))) {
        throw new Error(`binary16 word ${words[index]} decoded incorrectly`);
      }
    }
    expect(Object.is(decoded[0], 0)).toBe(true);
    expect(Object.is(decoded[words.indexOf(0x8000)], -0)).toBe(true);
    expect(decoded[words.indexOf(0x0001)]).toBe(2 ** -24);
    expect(decoded[words.indexOf(0x7bff)]).toBe(65504);
    expect(decoded[words.indexOf(0xfbff)]).toBe(-65504);
  });

  it('decodes scalar and multidimensional arrays before reshaping', () => {
    registerWords([0x3e00]);
    expect(decodeValue(envelope([]))).toBe(1.5);
    registerWords([0x3e00, 0xc080, 0x0001, 0x8000]);
    expect(decodeValue(envelope([2, 2]))).toEqual([
      [1.5, -2.25],
      [2 ** -24, -0],
    ]);
  });

  it('carries Arrow scalar float16 proof with the decoded number', async () => {
    registerWords([0x3e00]);
    const provenance = new DecodedProvenance();
    expect(await decodeValueAsync(envelope([]), provenance)).toBe(1.5);
    expect(provenance.atRoot()).toEqual({ marker: 'ndarray', dims: 0, dtype: 'float16' });
  });

  it('uses the ndarray rule inside nested Torch and record values', async () => {
    registerWords([0x3e00, 0xc080]);
    const value = {
      outer: [
        {
          __tywrap__: 'torch.tensor',
          codecVersion: 1,
          encoding: 'ndarray',
          value: envelope([2]),
          shape: [2],
          dtype: 'torch.float16',
          device: 'cpu',
        },
      ],
    };
    await expect(decodeValueAsync(value)).resolves.toEqual({
      outer: [{ data: [1.5, -2.25], shape: [2], dtype: 'torch.float16', device: 'cpu' }],
    });
  });

  it.each([0x7c00, 0xfc00, 0x7e00])('rejects non-finite word %s', word => {
    registerWords([word]);
    expect(() => decodeValue(envelope([1]))).toThrow(/non-finite float16 value at b64\[0\]/);
  });

  it('rejects a mismatched Arrow type or null storage', () => {
    registerArrowDecoder(
      () =>
        ({
          getChildAt: () => ({
            type: 'Int16',
            nullCount: 0,
            toArray: () => Uint16Array.of(0x3e00),
          }),
        }) as ArrowTable
    );
    expect(() => decodeValue(envelope([1]))).toThrow(/column type does not match/);
    registerArrowDecoder(
      () =>
        ({
          getChildAt: () => ({
            type: 'Float16',
            nullCount: 1,
            toArray: () => Uint16Array.of(0),
          }),
        }) as ArrowTable
    );
    expect(() => decodeValue(envelope([1]))).toThrow(/column contains null values/);
  });

  it('keeps JSON fallback numeric and Arrow int64 exact', () => {
    expect(
      decodeValue({
        __tywrap__: 'ndarray',
        codecVersion: 1,
        encoding: 'json',
        data: [1.5, -2.25],
        shape: [2],
        dtype: 'float16',
      })
    ).toEqual([1.5, -2.25]);

    registerArrowDecoder(
      () =>
        ({
          getChildAt: () => ({
            toArray: () => BigInt64Array.of(-9223372036854775808n, 9223372036854775807n),
          }),
        }) as ArrowTable
    );
    expect(
      decodeValue({
        __tywrap__: 'ndarray',
        codecVersion: 1,
        encoding: 'arrow',
        b64: 'AA==',
        shape: [2],
        dtype: 'int64',
      })
    ).toEqual([-9223372036854775808n, 9223372036854775807n]);
  });
});
