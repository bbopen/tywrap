/** Single source of truth for the menagerie's fixture inventory and catalogue. */

export const TIER_ONE_MODULES = ['fixtures.typing_torture', 'fixtures.values_torture'] as const;

export const OPTIONAL_LIBRARY_MODULE = 'fixtures.library_torture';

export type CatalogueStatus = 'EXPECTED_OK' | 'KNOWN_LIE' | 'LOUD_FAIL';

export interface CatalogueRow {
  fixture: string;
  call: string;
  status: CatalogueStatus;
  currentBehavior: string;
  expectedFix?: string;
}

/**
 * Runtime catalogue. Add a row before accepting a newly observed divergence.
 * This makes every supported fixture value exact, loudly rejected, or visible.
 */
export const RUNTIME_CATALOGUE: readonly CatalogueRow[] = [
  {
    fixture: 'values_torture',
    call: 'integer_boundaries()',
    status: 'KNOWN_LIE',
    currentBehavior: 'Integers above Number.MAX_SAFE_INTEGER lose precision in JavaScript.',
    expectedFix: 'Future bigint or tagged-integer transport.',
  },
  {
    fixture: 'values_torture',
    call: 'empty_values(), set_and_frozenset()',
    status: 'KNOWN_LIE',
    currentBehavior: 'Python tuples, sets, and frozensets decode as JavaScript arrays.',
    expectedFix: 'Future tagged tuple/set transport.',
  },
  {
    fixture: 'values_torture',
    call: 'int_key_dict()',
    status: 'KNOWN_LIE',
    currentBehavior: 'Integer keys silently stringify as JSON object keys.',
    expectedFix: 'Future tagged-map transport that preserves key types.',
  },
  {
    fixture: 'values_torture',
    call: 'bytes_echo()',
    status: 'KNOWN_LIE',
    currentBehavior:
      'The bridge delivers Uint8Array while generated wrappers currently declare string.',
    expectedFix: 'Future bytes mapper alignment.',
  },
  {
    fixture: 'values_torture',
    call: 'temporal_values(), decimal_values(), uuid_and_path()',
    status: 'KNOWN_LIE',
    currentBehavior:
      'Python temporal values, Decimal, UUID, and Path decode as strings or seconds.',
    expectedFix: 'Future tagged stdlib-value transport.',
  },
  {
    fixture: 'values_torture',
    call: 'special_floats(true)',
    status: 'LOUD_FAIL',
    currentBehavior: 'NaN and infinities are rejected by the JSON codec.',
    expectedFix: 'Future non-finite number representation.',
  },
  {
    fixture: 'values_torture',
    call: 'tuple_key_dict()',
    status: 'LOUD_FAIL',
    currentBehavior: 'Tuple dict keys reject through the JSON object-key constraint.',
    expectedFix: 'Future tagged-map transport.',
  },
  {
    fixture: 'values_torture',
    call: 'enum_member()',
    status: 'LOUD_FAIL',
    currentBehavior: 'Enum instances reject rather than silently collapsing to their value.',
    expectedFix: 'Future tagged Enum transport.',
  },
  {
    fixture: 'values_torture',
    call: 'coroutine_value(), dataclass_instance(), complex_value(), generator_value()',
    status: 'LOUD_FAIL',
    currentBehavior:
      'Coroutines and unsupported Python objects reject instead of silently coercing.',
  },
  {
    fixture: 'library_torture',
    call: 'numpy_adversarial(), pandas_adversarial(), networkx_tuple_key_shape()',
    status: 'LOUD_FAIL',
    currentBehavior:
      'Nested optional-library values that are not JSON-native reject at the bridge boundary.',
  },
];
