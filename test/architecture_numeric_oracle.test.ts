import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as arrow from 'apache-arrow';
import * as fc from 'fast-check';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { VALUE_CONTRACT_REVISION, isSafeJsonInteger } from '../src/contracts/value-contract.js';
import {
  clearArrowDecoder,
  decodeValue,
  decodeValueAsync,
  registerArrowDecoder,
  type ArrowTable,
} from '../src/utils/codec.js';

const fixturePath = fileURLToPath(
  new URL('./fixtures/architecture-value-cases.v1.json', import.meta.url)
);
const oraclePath = fileURLToPath(
  new URL('./python/architecture_numeric_oracle.py', import.meta.url)
);
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const execFileAsync = promisify(execFile);

interface FixedCase {
  wordHex: string;
  decimal: string;
  negativeZero: boolean;
}

interface ArchitectureFixture {
  schemaVersion: number;
  contractRevision: number;
  propertySeed: number;
  safeIntegers: Array<{ decimal: string; accepted: boolean }>;
  binary16: FixedCase[];
  nonFiniteBinary16: Array<{ wordHex: string; kind: 'infinity' | 'nan' }>;
  nestedCases: Array<{ path: string; float16Words?: string[] }>;
}

interface NumericOracle {
  contractRevision: number;
  method: string;
  words: Array<[decimalOrKind: string, negativeZero: boolean]>;
  integers: Array<{ decimal: string; accepted: boolean }>;
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as ArchitectureFixture;
const lockfile = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
) as { packages: Record<string, { version?: string }> };
let oracle: NumericOracle;

function isNonFinite(label: string): boolean {
  return label === 'NaN' || label === '+Infinity' || label === '-Infinity';
}

function decimalFor(word: number): number {
  const entry = oracle.words[word];
  if (!entry || isNonFinite(entry[0])) {
    throw new Error(`Expected a finite Python oracle value for word 0x${word.toString(16)}`);
  }
  return Number(entry[0]);
}

function envelope(shape: number[], b64 = 'AA=='): object {
  return {
    __tywrap__: 'ndarray',
    codecVersion: 1,
    encoding: 'arrow',
    b64,
    shape,
    dtype: 'float16',
  };
}

function registerStorageWords(words: readonly number[]): void {
  registerArrowDecoder(
    () =>
      ({
        getChildAt: () => ({
          type: 'Float16',
          nullCount: 0,
          toArray: () => Uint16Array.from(words),
        }),
      }) as ArrowTable
  );
}

beforeAll(async () => {
  const { stdout } = await execFileAsync(python, [oraclePath, fixturePath], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PYTHONNOUSERSITE: '1' },
  });
  oracle = JSON.parse(stdout) as NumericOracle;
  expect(fixture.schemaVersion).toBe(1);
  expect(fixture.contractRevision).toBe(VALUE_CONTRACT_REVISION);
  expect(oracle.contractRevision).toBe(VALUE_CONTRACT_REVISION);
  expect(oracle.method).toBe('python-stdlib-struct-unpack-binary16');
  expect(lockfile.packages['node_modules/apache-arrow']?.version).toBe('21.1.0');
  expect(oracle.words).toHaveLength(0x10000);
  expect(oracle.integers).toHaveLength(fixture.safeIntegers.length);
}, 30_000);

afterEach(() => clearArrowDecoder());

describe('architecture numeric oracle', () => {
  it('agrees with Python on the fixed safe-integer domain', () => {
    for (const [index, fixed] of fixture.safeIntegers.entries()) {
      expect(oracle.integers[index]).toEqual(fixed);
      const asNumber = Number(fixed.decimal);
      expect(isSafeJsonInteger(asNumber), fixed.decimal).toBe(fixed.accepted);
      if (fixed.accepted) {
        expect(BigInt(asNumber)).toBe(BigInt(fixed.decimal));
      }
    }
  });

  it('matches every finite binary16 word against Python struct.unpack', () => {
    const words: number[] = [];
    const expected: number[] = [];
    let nonFiniteCount = 0;
    for (let word = 0; word < oracle.words.length; word += 1) {
      const entry = oracle.words[word];
      if (!entry) throw new Error(`Python oracle omitted word ${word}`);
      if (isNonFinite(entry[0])) {
        nonFiniteCount += 1;
        if (entry[1]) throw new Error(`Non-finite word 0x${word.toString(16)} has a zero flag`);
        continue;
      }
      const value = Number(entry[0]);
      if (!Number.isFinite(value)) {
        throw new Error(`Python oracle word 0x${word.toString(16)} is not finite`);
      }
      if (Object.is(value, -0) !== entry[1]) {
        throw new Error(`Python oracle word 0x${word.toString(16)} has the wrong zero flag`);
      }
      words.push(word);
      expected.push(value);
    }
    expect(words).toHaveLength(63_488);
    expect(nonFiniteCount).toBe(2_048);

    // This injects Arrow storage words. The clean consumer test covers real Python Arrow output.
    registerStorageWords(words);
    const decoded = decodeValue(envelope([words.length])) as number[];
    expect(decoded).toHaveLength(words.length);
    for (let index = 0; index < words.length; index += 1) {
      if (!Object.is(decoded[index], expected[index])) {
        throw new Error(`binary16 word 0x${words[index]?.toString(16)} differs from Python`);
      }
    }
  }, 30_000);

  it('matches fixed finite cases and rejects NaN and infinity', () => {
    for (const fixed of fixture.binary16) {
      const word = Number.parseInt(fixed.wordHex, 16);
      const expected = Number(fixed.decimal);
      expect(Object.is(decimalFor(word), expected), fixed.wordHex).toBe(true);
      expect(oracle.words[word]?.[1], fixed.wordHex).toBe(fixed.negativeZero);
      registerStorageWords([word]);
      const decoded = decodeValue(envelope([1])) as number[];
      expect(Object.is(decoded[0], expected), fixed.wordHex).toBe(true);
    }
    for (const fixed of fixture.nonFiniteBinary16) {
      const word = Number.parseInt(fixed.wordHex, 16);
      const label = oracle.words[word]?.[0];
      expect(fixed.kind === 'nan' ? label === 'NaN' : label?.endsWith('Infinity')).toBe(true);
      registerStorageWords([word]);
      expect(() => decodeValue(envelope([1]))).toThrow(/non-finite float16/);
    }
  });

  it('decodes scalar and multidimensional shapes through real Arrow IPC', () => {
    const words = Uint16Array.of(0x3e00, 0xc080, 0x0001, 0x8000);
    const vector = arrow.makeVector({ type: new arrow.Float16(), data: words });
    const table = arrow.tableFromArrays({ value: vector });
    const b64 = Buffer.from(arrow.tableToIPC(table, 'stream')).toString('base64');
    registerArrowDecoder(bytes => arrow.tableFromIPC(bytes) as unknown as ArrowTable);

    const decoded = decodeValue(envelope([2, 2], b64)) as number[][];
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toEqual([decimalFor(0x3e00), decimalFor(0xc080)]);
    expect(decoded[1]?.[0]).toBe(decimalFor(0x0001));
    expect(Object.is(decoded[1]?.[1], -0)).toBe(true);

    const scalar = arrow.tableFromArrays({
      value: arrow.makeVector({ type: new arrow.Float16(), data: Uint16Array.of(0x3e00) }),
    });
    const scalarB64 = Buffer.from(arrow.tableToIPC(scalar, 'stream')).toString('base64');
    expect(decodeValue(envelope([], scalarB64))).toBe(decimalFor(0x3e00));
  });

  it('reuses float16 conversion inside Torch and records with a retained seed', async () => {
    const nested = fixture.nestedCases.find(testCase => testCase.float16Words);
    if (!nested?.float16Words) throw new Error('Missing nested Torch fixture');
    expect(nested.path).toBe('result.outer[0].tensor.value');
    const fixedWords = nested.float16Words.map(word => Number.parseInt(word, 16));

    const finiteWord = fc.integer({ min: 0, max: 0xffff }).filter(word => {
      const entry = oracle.words[word];
      return entry !== undefined && !isNonFinite(entry[0]);
    });
    await fc.assert(
      fc.asyncProperty(fc.array(finiteWord, { minLength: 1, maxLength: 8 }), async sampledWords => {
        const words = [...fixedWords, ...sampledWords];
        registerStorageWords(words);
        const decoded = (await decodeValueAsync({
          outer: [
            {
              tensor: {
                __tywrap__: 'torch.tensor',
                codecVersion: 1,
                encoding: 'ndarray',
                value: envelope([words.length]),
                shape: [words.length],
                dtype: 'torch.float16',
                device: 'cpu',
              },
            },
          ],
        })) as { outer: Array<{ tensor: { data: number[] } }> };
        const values = decoded.outer[0]?.tensor.data;
        if (!values || values.length !== words.length) {
          throw new Error('Nested Torch value did not keep its shape');
        }
        for (let index = 0; index < words.length; index += 1) {
          if (!Object.is(values[index], decimalFor(words[index] as number))) {
            throw new Error(`Nested float16 word 0x${words[index]?.toString(16)} differs`);
          }
        }
      }),
      { seed: fixture.propertySeed, numRuns: 64, verbose: true }
    );
  }, 30_000);
});
