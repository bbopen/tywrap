import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PYTHON, PYTHON_AVAILABLE } from './helpers/python-probe.js';
import {
  decodeExactResponse,
  encodeExactRequest,
  requireCapability,
  validateDataclassOrigin,
  type PrototypeContract,
} from './prototypes/value_extensions.js';

const pythonScript = join(process.cwd(), 'test', 'prototypes', 'value_extensions.py');
const pythonPath = PYTHON ?? 'python3';

function pythonAction(action: string, input: string): unknown {
  return JSON.parse(
    execFileSync(pythonPath, [pythonScript, action], {
      input,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
  ) as unknown;
}

const integerContract: PrototypeContract = {
  kind: 'record',
  fields: {
    positive: { kind: 'array', item: { kind: 'integer' } },
    negative: { kind: 'record', fields: { value: { kind: 'integer' } } },
    safe: { kind: 'integer' },
    flag: { kind: 'boolean' },
  },
};

describe.skipIf(!PYTHON_AVAILABLE || !existsSync(pythonScript))(
  'exact integer cross-language prototype',
  () => {
    it('round-trips nested positive and negative values beyond int64 in both directions', () => {
      const positive = 2n ** 80n + 1n;
      const negative = -(2n ** 130n + 7n);
      const value = { positive: [positive], negative: { value: negative }, safe: 7n, flag: true };

      const pythonWire = pythonAction(
        'encode-integer',
        `{"positive":[${positive}],"negative":{"value":${negative}},"safe":7,"flag":true}`
      );
      expect(decodeExactResponse(pythonWire, integerContract)).toEqual(value);

      requireCapability(
        { valueCapabilities: ['exactIntegerDecimalV2'] },
        'exactIntegerDecimalV2',
        'bigint-v2'
      );
      const request = encodeExactRequest(value, integerContract);
      const response = pythonAction(
        'roundtrip-integer',
        JSON.stringify({
          meta: { valueCapabilities: ['exactIntegerDecimalV2'] },
          policy: 'bigint-v2',
          value: request,
        })
      );
      expect(decodeExactResponse(response, integerContract)).toEqual(value);
    });
  }
);

describe('exact integer rejection prototype', () => {
  const integer: PrototypeContract = { kind: 'integer' };

  it('rejects an old bridge, a number under bigint typing, and a version 1 tag', () => {
    expect(() => requireCapability({}, 'exactIntegerDecimalV2', 'bigint-v2')).toThrow(
      /bridge lacks/
    );
    expect(() => encodeExactRequest(42, integer)).toThrow(/expected bigint at args/);
    expect(() =>
      decodeExactResponse(
        { __tywrap__: 'integer', codecVersion: 1, encoding: 'decimal', value: '42' },
        integer
      )
    ).toThrow(/invalid integer envelope/);
  });

  it.each(['-0', '+1', '01', '-01', '1.0', '1e2', ' 1', '١'])(
    'rejects noncanonical decimal %s',
    decimal => {
      expect(() =>
        decodeExactResponse(
          { __tywrap__: 'integer', codecVersion: 2, encoding: 'decimal', value: decimal },
          integer
        )
      ).toThrow(/noncanonical integer decimal/);
    }
  );

  it('enforces digit and payload limits', () => {
    const max = BigInt('9'.repeat(4096));
    expect(decodeExactResponse(encodeExactRequest(max, integer), integer)).toBe(max);
    expect(() => encodeExactRequest(BigInt('9'.repeat(4097)), integer)).toThrow(/4096 digits/);
    expect(() => encodeExactRequest(1n, integer, 20)).toThrow(/payload exceeds 20 bytes/);
  });

  it('rejects a record key reserved for envelopes', () => {
    const record: PrototypeContract = {
      kind: 'record',
      fields: { __tywrap__: { kind: 'string' } },
    };
    expect(() => encodeExactRequest({ __tywrap__: 'ordinary' }, record)).toThrow(
      /reserved record key/
    );
  });
});

describe.skipIf(!PYTHON_AVAILABLE || !existsSync(pythonScript))(
  'dataclass output prototype',
  () => {
    const point: PrototypeContract = {
      kind: 'dataclass',
      typeId: '__main__.Point',
      fields: { x: { kind: 'safe-integer' }, y: { kind: 'safe-integer' } },
    };

    it('decodes Point and preserves verified origin', () => {
      const wire = pythonAction('encode-point', JSON.stringify({ x: 1, y: 2 }));
      const decoded = decodeExactResponse(wire, point);
      expect(decoded).toEqual({ x: 1, y: 2 });
      expect(() => validateDataclassOrigin(decoded, point)).not.toThrow();
      expect(() => validateDataclassOrigin({ x: 1, y: 2 }, point)).toThrow(/lacks verified/);
      expect(() =>
        decodeExactResponse({ ...(wire as object), type: 'other.Point' }, point)
      ).toThrow(/invalid dataclass identity/);
      expect(() => decodeExactResponse({ ...(wire as object), fields: { x: 1 } }, point)).toThrow(
        /fields differ/
      );
      expect(() =>
        decodeExactResponse({ ...(wire as object), fields: { x: '1', y: 2 } }, point)
      ).toThrow(/expected safe integer/);
    });
  }
);
