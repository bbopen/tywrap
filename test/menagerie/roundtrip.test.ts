import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeBridge } from '../../src/runtime/node.js';
import { createReturnValidator } from '../../src/runtime/validators.js';
import { isNodejs } from '../../src/utils/runtime.js';
import {
  hasPythonModule,
  pythonExprTruthy,
  PYTHON,
  PYTHON_AVAILABLE,
} from '../helpers/python-probe.js';
import {
  type CatalogueExpectation,
  type CatalogueRow,
  type OptionalLibrary,
  RUNTIME_CATALOGUE,
} from './manifest.js';

const scriptPath = join(process.cwd(), 'runtime', 'python_bridge.py');
const fixturesRoot = join(process.cwd(), 'test', 'menagerie');
const bridgeAvailable = isNodejs() && PYTHON_AVAILABLE && existsSync(scriptPath);
const timeoutMs = process.env.CI ? 60_000 : 20_000;
let bridge: NodeBridge | undefined;

const requiredLibraries = new Set(RUNTIME_CATALOGUE.flatMap(row => row.requires ?? []));
const libraryAvailability = new Map<OptionalLibrary, boolean>(
  [...requiredLibraries].map(library => [library, hasPythonModule(library)])
);
const featureAvailability = new Map(
  RUNTIME_CATALOGUE.filter(row => row.featureProbe).map(row => [
    row.id,
    pythonExprTruthy(row.featureProbe as string),
  ])
);

function rowAvailable(row: CatalogueRow): boolean {
  return (
    bridgeAvailable &&
    (row.requires ?? []).every(library => libraryAvailability.get(library) === true) &&
    (!row.featureProbe || featureAvailability.get(row.id) === true)
  );
}

function createBridge(row: CatalogueRow): NodeBridge {
  const inherited = process.env.PYTHONPATH;
  return new NodeBridge({
    scriptPath,
    pythonPath: PYTHON ?? undefined,
    timeoutMs,
    env: {
      PYTHONPATH: inherited ? `${fixturesRoot}${delimiter}${inherited}` : fixturesRoot,
      ...(row.codec === 'json' ? { TYWRAP_CODEC_FALLBACK: 'json' } : {}),
    },
  });
}

interface ArrowTableLike {
  schema?: {
    fields?: readonly { name: string; type: unknown }[];
    metadata?: Map<string, string>;
  };
  getChildAt(index: number): {
    data?: readonly { dictionary?: Iterable<unknown> }[];
    isValid(index: number): boolean;
    nullCount: number;
    type?: { isOrdered?: boolean };
  } | null;
  toArray(): unknown[];
}

function asArrowTable(value: unknown): ArrowTableLike {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('toArray' in value) ||
    typeof value.toArray !== 'function'
  ) {
    throw new TypeError('Expected an Arrow table result');
  }
  return value as ArrowTableLike;
}

function tableRows(value: ArrowTableLike): unknown[] {
  return Array.from(value.toArray(), (row: unknown) => {
    if (typeof row === 'object' && row !== null) {
      return Object.fromEntries(Object.entries(row));
    }
    return row;
  });
}

function assertResolvedValue(value: unknown, expected: CatalogueExpectation): void {
  switch (expected.kind) {
    case 'equal':
      expect(value).toEqual(expected.value);
      return;
    case 'ndarray':
      createReturnValidator(
        { kind: 'marker', marker: 'ndarray', dtype: expected.dtype },
        'menagerie.ndarray'
      )(value);
      expect(value).toEqual(expected.value);
      return;
    case 'record': {
      expect(value).toBeTypeOf('object');
      expect(value).not.toBeNull();
      expect(Array.isArray(value)).toBe(false);
      const record = value as Record<string, unknown>;
      expect(Object.keys(record)).toEqual(Object.keys(expected.value));
      for (const [key, nestedExpected] of Object.entries(expected.value)) {
        assertResolvedValue(record[key], nestedExpected);
      }
      return;
    }
    case 'length':
      expect(value).toHaveLength(expected.value);
      return;
    case 'match':
      expect(value).toMatchObject(expected.value);
      return;
    case 'set-pair': {
      expect(value).toHaveLength(2);
      const pair = value as unknown[][];
      expect(pair[0]).toEqual(expect.arrayContaining([...expected.value[0]]));
      expect(pair[1]).toEqual(expect.arrayContaining([...expected.value[1]]));
      return;
    }
    case 'table-rows': {
      const table = asArrowTable(value);
      expect(tableRows(table)).toEqual(expected.value);
      const pandasMetadata = table.schema?.metadata?.get('pandas');
      for (const fragment of expected.pandasMetadataIncludes ?? []) {
        expect(pandasMetadata).toContain(fragment);
      }
      if (expected.pandasMetadataAbsent) {
        expect(pandasMetadata).toBeUndefined();
      }
      if (expected.pandasIndexColumns) {
        expect(JSON.parse(pandasMetadata ?? '{}').index_columns).toEqual(
          expected.pandasIndexColumns
        );
      }
      for (const [index, expectedField] of (expected.fields ?? []).entries()) {
        const field = table.schema?.fields?.[index];
        const vector = table.getChildAt(index);
        expect(field?.name).toBe(expectedField.name);
        expect(String(field?.type)).toBe(expectedField.type);
        if (expectedField.nullCount !== undefined) {
          expect(vector?.nullCount).toBe(expectedField.nullCount);
        }
        if (expectedField.validity) {
          expect(expectedField.validity.map((_, row) => vector?.isValid(row))).toEqual(
            expectedField.validity
          );
        }
        if (expectedField.dictionaryValues) {
          expect(Array.from(vector?.data?.[0]?.dictionary ?? [])).toEqual(
            expectedField.dictionaryValues
          );
        }
        if (expectedField.dictionaryOrdered !== undefined) {
          expect(vector?.type?.isOrdered).toBe(expectedField.dictionaryOrdered);
        }
      }
      return;
    }
    case 'error':
      throw new Error('LOUD_FAIL row unexpectedly resolved');
  }
}

describe('menagerie runtime catalogue', () => {
  afterEach(async () => {
    await bridge?.dispose();
    bridge = undefined;
  });

  for (const row of RUNTIME_CATALOGUE) {
    it.skipIf(!rowAvailable(row))(
      `${row.id} [${row.status}] ${row.call}${row.codec ? ` via ${row.codec}` : ''}`,
      async () => {
        bridge = createBridge(row);
        const result = bridge.call(`fixtures.${row.fixture}`, row.functionName, [
          ...(row.args ?? []),
        ]);

        if (row.expected.kind === 'error') {
          await expect(result).rejects.toThrow(row.expected.pattern);
          return;
        }

        assertResolvedValue(await result, row.expected);
      },
      timeoutMs
    );
  }

  it('keeps status and executable expectation categories aligned', () => {
    for (const row of RUNTIME_CATALOGUE) {
      expect(row.expected.kind === 'error', row.id).toBe(row.status === 'LOUD_FAIL');
    }
  });
});
