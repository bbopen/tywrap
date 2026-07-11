import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { NodeBridge } from '../../src/runtime/node.js';
import { isNodejs } from '../../src/utils/runtime.js';
import { PYTHON_AVAILABLE, PYTHON } from '../helpers/python-probe.js';
import { RUNTIME_CATALOGUE } from './manifest.js';

const scriptPath = join(process.cwd(), 'runtime', 'python_bridge.py');
const fixturesRoot = join(process.cwd(), 'test', 'menagerie');
const bridgeAvailable = isNodejs() && PYTHON_AVAILABLE && existsSync(scriptPath);
const timeoutMs = 15_000;
let bridge: NodeBridge | undefined;

function createBridge(env: Record<string, string | undefined> = {}): NodeBridge {
  const inherited = process.env.PYTHONPATH;
  return new NodeBridge({
    scriptPath,
    pythonPath: PYTHON ?? undefined,
    timeoutMs,
    env: {
      PYTHONPATH: inherited ? `${fixturesRoot}${delimiter}${inherited}` : fixturesRoot,
      ...env,
    },
  });
}

async function callValues<T>(functionName: string, args: unknown[] = []): Promise<T> {
  bridge ??= createBridge();
  return bridge.call<T>('fixtures.values_torture', functionName, args);
}

/**
 * CURRENT RUNTIME CATALOGUE
 *
 * | fixture | call | status | current delivery |
 * | --- | --- | --- | --- |
 * | values_torture | echo_int(), bools_and_ints(), finite_float_edges() | EXPECTED_OK | safe integers, booleans, -0, and subnormal float survive |
 * | values_torture | unicode_text(), lone_surrogate(), megabyte_text(), deeply_nested() | EXPECTED_OK | text and 100-level nesting survive |
 * | values_torture | bytes_echo() | KNOWN_LIE | bridge delivers Uint8Array; generated wrapper declares string |
 * | values_torture | integer_boundaries() | KNOWN_LIE | unsafe integers lose precision |
 * | values_torture | empty_values(), set_and_frozenset() | KNOWN_LIE | tuple/set/frozenset become arrays |
 * | values_torture | int_key_dict() | KNOWN_LIE | integer object keys stringify |
 * | values_torture | temporal_values(), decimal_values(), uuid_and_path() | KNOWN_LIE | values become strings or seconds |
 * | values_torture | special_floats(true) | LOUD_FAIL | non-finite numbers reject |
 * | values_torture | tuple_key_dict() | LOUD_FAIL | tuple object key rejects |
 * | values_torture | enum_member() | LOUD_FAIL | Enum instance rejects |
 * | values_torture | coroutine_value(), dataclass_instance(), complex_value(), generator_value() | LOUD_FAIL | unsupported objects reject |
 */
describe.skipIf(!bridgeAvailable)('menagerie runtime gate', () => {
  afterEach(async () => {
    await bridge?.dispose();
    bridge = undefined;
  });

  it(
    'keeps exact values exact where the JSON bridge has a faithful representation',
    async () => {
      await expect(callValues('echo_int', [2 ** 53 - 1])).resolves.toBe(2 ** 53 - 1);
      await expect(callValues('bools_and_ints')).resolves.toEqual([true, false, 0, 1]);

      const finite = await callValues<number[]>('finite_float_edges');
      expect(Object.is(finite[0], -0)).toBe(true);
      expect(finite[1]).toBe(5e-324);
      await expect(callValues('unicode_text')).resolves.toBe('emoji: 🐍; CJK: 漢字; NUL: \0');
      await expect(callValues('deeply_nested')).resolves.toEqual(
        Array.from({ length: 100 }).reduce<unknown>(value => [value], 'leaf')
      );
      await expect(callValues('bytes_echo', [new Uint8Array([0, 255, 128])])).resolves.toEqual(
        new Uint8Array([0, 255, 128])
      );
      const surrogate = await callValues<string>('lone_surrogate');
      expect(surrogate).toHaveLength(1);
      expect(surrogate.charCodeAt(0)).toBe(0xd800);
      await expect(callValues<string>('megabyte_text')).resolves.toHaveLength(1024 * 1024);
    },
    timeoutMs
  );

  it(
    'catalogues scalar representation conversions explicitly',
    async () => {
      await expect(callValues('temporal_values')).resolves.toEqual({
        datetime_naive: '2024-01-02T03:04:05',
        datetime_utc: '2024-01-02T03:04:05+00:00',
        date: '2024-01-02',
        time: '03:04:05',
        timedelta: 172803,
      });
      await expect(callValues('decimal_values')).resolves.toEqual(['0.1', '0.3']);
      await expect(callValues('uuid_and_path')).resolves.toEqual({
        uuid: '12345678-1234-5678-1234-567812345678',
        path: join('fixtures', 'example.txt'),
      });
    },
    timeoutMs
  );

  it(
    'documents known lies without treating them as exact round trips',
    async () => {
      const values = await callValues<number[]>('integer_boundaries');
      expect(values).toEqual([
        2 ** 53 - 1,
        2 ** 53,
        2 ** 53,
        2 ** 63,
        -(2 ** 63),
        2.6525285981219107e32,
      ]);

      await expect(callValues('empty_values')).resolves.toEqual([[], [], {}, []]);
      const sets = await callValues<unknown[]>('set_and_frozenset');
      expect(sets).toHaveLength(2);
      expect(sets[0]).toEqual(expect.arrayContaining([1, 2]));
      expect(sets[1]).toEqual(expect.arrayContaining(['a', 'b']));
      await expect(callValues('int_key_dict')).resolves.toEqual({ 1: 'one', 2: 'two' });
      expect(RUNTIME_CATALOGUE.filter(row => row.status === 'KNOWN_LIE')).toHaveLength(5);
    },
    timeoutMs
  );

  it(
    'fails loudly for values the transport cannot faithfully encode',
    async () => {
      await expect(callValues('special_floats', [true])).rejects.toThrow(/NaN|Infinity|serialize/i);
      await expect(callValues('tuple_key_dict')).rejects.toThrow(/keys must be str/i);
      await expect(callValues('enum_member')).rejects.toThrow(/TrafficLight|serializable/i);
      await expect(callValues('coroutine_value')).rejects.toThrow(/coroutine|serializable/i);
      await expect(callValues('dataclass_instance')).rejects.toThrow(/serializable/i);
      await expect(callValues('complex_value')).rejects.toThrow(/serializable/i);
      await expect(callValues('generator_value')).rejects.toThrow(/serializable/i);
      expect(RUNTIME_CATALOGUE.filter(row => row.status === 'LOUD_FAIL')).toHaveLength(5);
    },
    timeoutMs
  );
});
