/** Single source of truth for the menagerie's fixture inventory and catalogue. */

export const TIER_ONE_MODULES = ['fixtures.typing_torture', 'fixtures.values_torture'] as const;

export const OPTIONAL_LIBRARY_MODULE = 'fixtures.library_torture';

export type CatalogueStatus = 'EXPECTED_OK' | 'KNOWN_LIE' | 'LOUD_FAIL';
export type CodecPath = 'arrow' | 'json';
export type OptionalLibrary =
  | 'numpy'
  | 'pandas'
  | 'pyarrow'
  | 'scipy'
  | 'torch'
  | 'sklearn'
  | 'networkx';

export type CatalogueExpectation =
  | { kind: 'equal'; value: unknown }
  | { kind: 'ndarray'; value: unknown; dtype: string }
  | { kind: 'error'; pattern: RegExp }
  | { kind: 'length'; value: number }
  | { kind: 'match'; value: object }
  | { kind: 'set-pair'; value: readonly [readonly unknown[], readonly unknown[]] }
  | {
      kind: 'table-rows';
      value: readonly object[];
      pandasMetadataIncludes?: readonly string[];
    };

export interface CatalogueRow {
  id: string;
  fixture: 'values_torture' | 'library_torture';
  call: string;
  functionName: string;
  args?: readonly unknown[];
  status: CatalogueStatus;
  currentBehavior: string;
  expected: CatalogueExpectation;
  codec?: CodecPath;
  requires?: readonly OptionalLibrary[];
  featureProbe?: string;
  expectedFix?: string;
}

function valuesRow(
  row: Omit<CatalogueRow, 'fixture' | 'functionName'> & { functionName?: string }
): CatalogueRow {
  return {
    fixture: 'values_torture',
    functionName: row.functionName ?? row.call.replace(/\(.*/, ''),
    ...row,
  };
}

function libraryRow(
  row: Omit<CatalogueRow, 'fixture' | 'functionName'> & { functionName?: string }
): CatalogueRow {
  return {
    fixture: 'library_torture',
    functionName: row.functionName ?? row.call.replace(/\(.*/, ''),
    ...row,
  };
}

const error = (pattern: RegExp): CatalogueExpectation => ({ kind: 'error', pattern });
const equal = (value: unknown): CatalogueExpectation => ({ kind: 'equal', value });

/**
 * Runtime catalogue. Every row is one Python call under one codec configuration.
 * A row must describe today's behavior, including loss and explicit rejection.
 */
export const RUNTIME_CATALOGUE: readonly CatalogueRow[] = [
  valuesRow({
    id: 'bools-and-ints',
    call: 'bools_and_ints()',
    status: 'EXPECTED_OK',
    currentBehavior: 'Booleans remain distinct from integer zero and one.',
    expected: equal([true, false, 0, 1]),
  }),
  valuesRow({
    id: 'finite-float-edges',
    call: 'finite_float_edges()',
    status: 'EXPECTED_OK',
    currentBehavior: 'Negative zero and the smallest positive subnormal survive.',
    expected: equal([-0, 5e-324]),
  }),
  valuesRow({
    id: 'unicode-text',
    call: 'unicode_text()',
    status: 'EXPECTED_OK',
    currentBehavior: 'Unicode, emoji, and embedded NUL survive.',
    expected: equal('emoji: 🐍; CJK: 漢字; NUL: \0'),
  }),
  valuesRow({
    id: 'lone-surrogate',
    call: 'lone_surrogate()',
    status: 'EXPECTED_OK',
    currentBehavior: 'A lone UTF-16 surrogate survives with its code unit intact.',
    expected: equal('\ud800'),
  }),
  valuesRow({
    id: 'megabyte-text',
    call: 'megabyte_text()',
    status: 'EXPECTED_OK',
    currentBehavior: 'A one-megabyte string is delivered in full.',
    expected: { kind: 'length', value: 1024 * 1024 },
  }),
  valuesRow({
    id: 'deeply-nested',
    call: 'deeply_nested()',
    status: 'LOUD_FAIL',
    currentBehavior: 'Values deeper than the decoder limit reject with their exact path.',
    expected: error(/maximum depth 64 exceeded at result(?:\[0\]){65}/i),
  }),
  valuesRow({
    id: 'integer-safe-max',
    call: 'integer_safe_max()',
    status: 'EXPECTED_OK',
    currentBehavior: 'The largest safe JavaScript integer survives exactly.',
    expected: equal(2 ** 53 - 1),
  }),
  valuesRow({
    id: 'integer-first-unsafe',
    call: 'integer_first_unsafe()',
    status: 'KNOWN_LIE',
    currentBehavior: 'The first unsafe integer is delivered as an untagged JavaScript number.',
    expected: equal(2 ** 53),
    expectedFix: 'Future bigint or tagged-integer transport.',
  }),
  valuesRow({
    id: 'integer-first-rounded',
    call: 'integer_first_rounded()',
    status: 'KNOWN_LIE',
    currentBehavior: '2^53 + 1 rounds down to 2^53 in JavaScript.',
    expected: equal(2 ** 53),
    expectedFix: 'Future bigint or tagged-integer transport.',
  }),
  valuesRow({
    id: 'integer-int64-max',
    call: 'integer_int64_max()',
    status: 'KNOWN_LIE',
    currentBehavior: 'The signed int64 maximum rounds in JavaScript.',
    expected: equal(2 ** 63),
    expectedFix: 'Future bigint or tagged-integer transport.',
  }),
  valuesRow({
    id: 'integer-int64-min',
    call: 'integer_int64_min()',
    status: 'KNOWN_LIE',
    currentBehavior: 'The signed int64 minimum is delivered as an unsafe JavaScript number.',
    expected: equal(-(2 ** 63)),
    expectedFix: 'Future bigint or tagged-integer transport.',
  }),
  valuesRow({
    id: 'integer-factorial-30',
    call: 'integer_factorial_30()',
    status: 'KNOWN_LIE',
    currentBehavior: 'factorial(30) is delivered as a rounded JavaScript number.',
    expected: equal(2.6525285981219107e32),
    expectedFix: 'Future bigint or tagged-integer transport.',
  }),
  valuesRow({
    id: 'empty-values',
    call: 'empty_values()',
    status: 'KNOWN_LIE',
    currentBehavior: 'The empty Python tuple and set both arrive as arrays.',
    expected: equal([[], [], {}, []]),
    expectedFix: 'Future exact empty-tuple and set transport.',
  }),
  valuesRow({
    id: 'set-and-frozenset',
    call: 'set_and_frozenset()',
    status: 'EXPECTED_OK',
    currentBehavior: 'Python sets and frozensets are declared and delivered as JavaScript arrays.',
    expected: {
      kind: 'set-pair',
      value: [
        [1, 2],
        ['a', 'b'],
      ],
    },
  }),
  valuesRow({
    id: 'int-key-dict',
    call: 'int_key_dict()',
    status: 'KNOWN_LIE',
    currentBehavior: 'Integer keys silently stringify as JSON object keys.',
    expected: equal({ 1: 'one', 2: 'two' }),
    expectedFix: 'Future tagged-map transport that preserves key types.',
  }),
  valuesRow({
    id: 'bytes-echo',
    call: 'bytes_echo()',
    functionName: 'bytes_echo',
    args: [new Uint8Array([0, 255, 128])],
    status: 'EXPECTED_OK',
    currentBehavior: 'Python bytes are declared and delivered as Uint8Array.',
    expected: equal(new Uint8Array([0, 255, 128])),
  }),
  valuesRow({
    id: 'temporal-values',
    call: 'temporal_values()',
    status: 'KNOWN_LIE',
    currentBehavior: 'Temporal values decode as strings or seconds rather than tagged values.',
    expected: equal({
      datetime_naive: '2024-01-02T03:04:05',
      datetime_utc: '2024-01-02T03:04:05+00:00',
      date: '2024-01-02',
      time: '03:04:05',
      timedelta: 172803,
    }),
    expectedFix: 'Future tagged stdlib-value transport.',
  }),
  valuesRow({
    id: 'decimal-values',
    call: 'decimal_values()',
    status: 'KNOWN_LIE',
    currentBehavior: 'Decimal values decode as strings.',
    expected: equal(['0.1', '0.3']),
    expectedFix: 'Future tagged Decimal transport.',
  }),
  valuesRow({
    id: 'uuid-and-path',
    call: 'uuid_and_path()',
    status: 'KNOWN_LIE',
    currentBehavior: 'UUID and Path values decode as strings.',
    expected: equal({
      uuid: '12345678-1234-5678-1234-567812345678',
      path: 'fixtures/example.txt',
    }),
    expectedFix: 'Future tagged UUID and Path transport.',
  }),
  ...[
    ['special-floats', 'special_floats(true)', 'special_floats', [true], /NaN|Infinity|serialize/i],
    ['tuple-key-dict', 'tuple_key_dict()', 'tuple_key_dict', [], /keys must be str/i],
    ['enum-member', 'enum_member()', 'enum_member', [], /TrafficLight|serializable/i],
    ['coroutine-value', 'coroutine_value()', 'coroutine_value', [], /coroutine|serializable/i],
    ['dataclass-instance', 'dataclass_instance()', 'dataclass_instance', [], /serializable/i],
    ['complex-value', 'complex_value()', 'complex_value', [], /serializable/i],
    ['generator-value', 'generator_value()', 'generator_value', [], /serializable/i],
  ].map(([id, call, functionName, args, pattern]) =>
    valuesRow({
      id: id as string,
      call: call as string,
      functionName: functionName as string,
      args: args as unknown[],
      status: 'LOUD_FAIL',
      currentBehavior: 'The unsupported value rejects at the bridge boundary.',
      expected: error(pattern as RegExp),
    })
  ),

  // NumPy: Arrow is the default subprocess path; JSON rows pin fallback-only differences.
  libraryRow({
    id: 'numpy-0d-arrow',
    call: 'numpy_zero_dimensional()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'The producer flattens 0-D arrays, so Arrow delivers the scalar.',
    expected: equal(7),
  }),
  libraryRow({
    id: 'numpy-0d-json',
    call: 'numpy_zero_dimensional()',
    codec: 'json',
    requires: ['numpy'],
    status: 'EXPECTED_OK',
    currentBehavior: 'JSON fallback delivers the scalar value.',
    expected: equal(7),
  }),
  libraryRow({
    id: 'numpy-float16-arrow',
    call: 'numpy_float16()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'KNOWN_LIE',
    currentBehavior: 'Arrow JS exposes float16 storage bits as numbers.',
    expected: equal([15872, 49280]),
  }),
  libraryRow({
    id: 'numpy-float16-json',
    call: 'numpy_float16()',
    codec: 'json',
    requires: ['numpy'],
    status: 'EXPECTED_OK',
    currentBehavior: 'JSON fallback preserves the values and declares their float16 dtype.',
    expected: { kind: 'ndarray', value: [1.5, -2.25], dtype: 'float16' },
  }),
  libraryRow({
    id: 'numpy-bool',
    call: 'numpy_bool()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves boolean values.',
    expected: equal([true, false]),
  }),
  libraryRow({
    id: 'numpy-int8',
    call: 'numpy_int8()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves int8 values.',
    expected: equal([-128, 127]),
  }),
  libraryRow({
    id: 'numpy-int16',
    call: 'numpy_int16()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves int16 values.',
    expected: equal([-32768, 32767]),
  }),
  libraryRow({
    id: 'numpy-int32',
    call: 'numpy_int32()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves int32 values.',
    expected: equal([-2147483648, 2147483647]),
  }),
  libraryRow({
    id: 'numpy-int64',
    call: 'numpy_int64()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves int64 values as JavaScript bigint values.',
    expected: equal([-9223372036854775808n, 9223372036854775807n]),
  }),
  libraryRow({
    id: 'numpy-datetime64-arrow',
    call: 'numpy_datetime64()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves the epoch and ndarray dtype metadata.',
    expected: equal([1704164645123456789n]),
  }),
  libraryRow({
    id: 'numpy-datetime64-json',
    call: 'numpy_datetime64()',
    codec: 'json',
    requires: ['numpy'],
    status: 'LOUD_FAIL',
    currentBehavior: 'JSON fallback rejects datetime64 without an explicit caller conversion.',
    expected: error(
      /datetime64.*Arrow.*astype\('datetime64\[ms\]'\)\.astype\(str\).*declared unit/i
    ),
  }),
  libraryRow({
    id: 'numpy-big-endian',
    call: 'numpy_big_endian()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'LOUD_FAIL',
    currentBehavior: 'Arrow rejects the byte-swapped dtype.',
    expected: error(/Arrow encoding failed for ndarray/i),
  }),
  libraryRow({
    id: 'numpy-structured',
    call: 'numpy_structured()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'LOUD_FAIL',
    currentBehavior: 'Arrow rejects the structured dtype.',
    expected: error(/Arrow encoding failed for ndarray/i),
  }),
  libraryRow({
    id: 'numpy-structured-json',
    call: 'numpy_structured()',
    codec: 'json',
    requires: ['numpy'],
    status: 'LOUD_FAIL',
    currentBehavior: 'JSON fallback rejects structured arrays instead of erasing field names.',
    expected: error(/structured dtype=.*named field explicitly.*plain JSON object/i),
  }),
  libraryRow({
    id: 'numpy-object-json',
    call: 'numpy_object()',
    codec: 'json',
    requires: ['numpy'],
    status: 'LOUD_FAIL',
    currentBehavior:
      'JSON fallback rejects object arrays instead of accepting arbitrary tolist output.',
    expected: error(/object dtype=.*concrete numeric dtype.*elements explicitly as plain JSON/i),
  }),
  libraryRow({
    id: 'numpy-empty',
    call: 'numpy_empty()',
    codec: 'arrow',
    requires: ['numpy', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves an empty one-dimensional array.',
    expected: equal([]),
  }),
  libraryRow({
    id: 'numpy-unsafe-int64-json',
    call: 'numpy_unsafe_int64()',
    codec: 'json',
    requires: ['numpy'],
    status: 'LOUD_FAIL',
    currentBehavior: 'JSON fallback rejects integers outside the JavaScript safe range.',
    expected: error(/use Arrow encoding or cast\/encode explicitly.*astype\('float64'\).*str/i),
  }),

  // pandas: both paths are present whenever dtype/index fidelity differs.
  libraryRow({
    id: 'pandas-nullable-int64-arrow',
    call: 'pandas_nullable_int64()',
    codec: 'arrow',
    requires: ['pandas', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves nullable integer values.',
    expected: {
      kind: 'table-rows',
      value: [{ value: 1n }, { value: null }],
      pandasMetadataIncludes: ['"numpy_type": "Int64"'],
    },
  }),
  libraryRow({
    id: 'pandas-nullable-int64-json',
    call: 'pandas_nullable_int64()',
    codec: 'json',
    requires: ['pandas'],
    status: 'KNOWN_LIE',
    currentBehavior: 'JSON preserves values but drops the nullable integer dtype.',
    expected: equal([{ value: 1 }, { value: null }]),
  }),
  libraryRow({
    id: 'pandas-categorical-arrow',
    call: 'pandas_categorical()',
    codec: 'arrow',
    requires: ['pandas', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves categorical values and dictionary encoding.',
    expected: {
      kind: 'table-rows',
      value: [{ value: 'a' }, { value: 'b' }, { value: 'a' }],
      pandasMetadataIncludes: ['"pandas_type": "categorical"'],
    },
  }),
  libraryRow({
    id: 'pandas-categorical-json',
    call: 'pandas_categorical()',
    codec: 'json',
    requires: ['pandas'],
    status: 'KNOWN_LIE',
    currentBehavior: 'JSON preserves values but drops categorical dtype information.',
    expected: equal([{ value: 'a' }, { value: 'b' }, { value: 'a' }]),
  }),
  libraryRow({
    id: 'pandas-pyarrow-string-arrow',
    call: 'pandas_pyarrow_string()',
    codec: 'arrow',
    requires: ['pandas', 'pyarrow'],
    featureProbe: 'import pandas as pd; pd.Series(["a"], dtype="string[pyarrow]"); print("1")',
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves string values and nulls.',
    expected: {
      kind: 'table-rows',
      value: [{ value: 'a' }, { value: null }],
      pandasMetadataIncludes: ['"numpy_type": "string"'],
    },
  }),
  libraryRow({
    id: 'pandas-pyarrow-string-json',
    call: 'pandas_pyarrow_string()',
    codec: 'json',
    requires: ['pandas', 'pyarrow'],
    featureProbe: 'import pandas as pd; pd.Series(["a"], dtype="string[pyarrow]"); print("1")',
    status: 'KNOWN_LIE',
    currentBehavior: 'JSON preserves values but drops the Arrow-backed string dtype.',
    expected: equal([{ value: 'a' }, { value: null }]),
  }),
  libraryRow({
    id: 'pandas-timezone-arrow',
    call: 'pandas_timezone_aware()',
    codec: 'arrow',
    requires: ['pandas', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow preserves the timestamp epoch and timezone schema.',
    expected: {
      kind: 'table-rows',
      value: [{ when: 1704164645000 }],
      pandasMetadataIncludes: ['"timezone": "UTC"'],
    },
  }),
  libraryRow({
    id: 'pandas-timezone-json',
    call: 'pandas_timezone_aware()',
    codec: 'json',
    requires: ['pandas'],
    status: 'KNOWN_LIE',
    currentBehavior: 'JSON delivers an ISO string but loses timestamp dtype and timezone schema.',
    expected: equal([{ when: '2024-01-02T03:04:05+00:00' }]),
  }),
  libraryRow({
    id: 'pandas-multiindex-arrow',
    call: 'pandas_multiindex()',
    codec: 'arrow',
    requires: ['pandas', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow materializes all MultiIndex levels alongside the data.',
    expected: {
      kind: 'table-rows',
      value: [{ value: 3n, side: 'left', number: 1n }],
      pandasMetadataIncludes: ['"index_columns": ["side", "number"]'],
    },
  }),
  libraryRow({
    id: 'pandas-multiindex-json',
    call: 'pandas_multiindex()',
    codec: 'json',
    requires: ['pandas'],
    status: 'KNOWN_LIE',
    currentBehavior: 'Records-oriented JSON drops the MultiIndex.',
    expected: equal([{ value: 3 }]),
  }),
  libraryRow({
    id: 'pandas-duplicate-labels-arrow',
    call: 'pandas_duplicate_labels()',
    codec: 'arrow',
    requires: ['pandas', 'pyarrow'],
    status: 'LOUD_FAIL',
    currentBehavior: 'Arrow rejects duplicate DataFrame column labels.',
    expected: error(/Arrow encoding failed for pandas\.DataFrame/i),
  }),
  libraryRow({
    id: 'pandas-duplicate-labels-json',
    call: 'pandas_duplicate_labels()',
    codec: 'json',
    requires: ['pandas'],
    status: 'KNOWN_LIE',
    currentBehavior: 'Records-oriented JSON silently retains only the last duplicate label.',
    expected: equal([{ value: 2 }]),
  }),
  libraryRow({
    id: 'pandas-empty-frame',
    call: 'pandas_empty_frame()',
    codec: 'arrow',
    requires: ['pandas', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Arrow delivers an empty table.',
    expected: {
      kind: 'table-rows',
      value: [],
      pandasMetadataIncludes: ['"columns": []'],
    },
  }),
  libraryRow({
    id: 'pandas-empty-frame-json',
    call: 'pandas_empty_frame()',
    codec: 'json',
    requires: ['pandas'],
    status: 'KNOWN_LIE',
    currentBehavior: 'Records-oriented JSON loses the empty DataFrame schema.',
    expected: equal([]),
  }),

  // SciPy sparse markers are JSON-only on both bridge paths.
  libraryRow({
    id: 'scipy-csr',
    call: 'scipy_csr()',
    requires: ['scipy'],
    status: 'EXPECTED_OK',
    currentBehavior: 'CSR structure and stored values are preserved.',
    expected: {
      kind: 'match',
      value: { format: 'csr', shape: [2, 2], data: [1, 2], indices: [0, 1], indptr: [0, 1, 2] },
    },
  }),
  libraryRow({
    id: 'scipy-csc',
    call: 'scipy_csc()',
    requires: ['scipy'],
    status: 'EXPECTED_OK',
    currentBehavior: 'CSC structure and stored values are preserved.',
    expected: {
      kind: 'match',
      value: { format: 'csc', shape: [2, 2], data: [1, 2], indices: [0, 1], indptr: [0, 1, 2] },
    },
  }),
  libraryRow({
    id: 'scipy-coo',
    call: 'scipy_coo()',
    requires: ['scipy'],
    status: 'EXPECTED_OK',
    currentBehavior: 'COO coordinates and stored values are preserved.',
    expected: {
      kind: 'match',
      value: { format: 'coo', shape: [2, 2], data: [1, 2], row: [0, 1], col: [0, 1] },
    },
  }),
  ...(['dia', 'bsr', 'lil', 'dok'] as const).map(format =>
    libraryRow({
      id: `scipy-${format}`,
      call: `scipy_${format}()`,
      requires: ['scipy'],
      status: 'LOUD_FAIL',
      currentBehavior: `${format.toUpperCase()} is rejected outside the supported CSR/CSC/COO set.`,
      expected: error(new RegExp(`Unsupported scipy sparse format: ${format}`, 'i')),
    })
  ),
  libraryRow({
    id: 'scipy-complex',
    call: 'scipy_complex()',
    requires: ['scipy'],
    status: 'LOUD_FAIL',
    currentBehavior: 'Complex sparse values are rejected explicitly.',
    expected: error(/Complex scipy sparse matrices are not supported/i),
  }),
  libraryRow({
    id: 'scipy-duplicate-coo',
    call: 'scipy_duplicate_coo()',
    requires: ['scipy'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Duplicate COO coordinates remain distinct stored entries.',
    expected: {
      kind: 'match',
      value: { format: 'coo', shape: [2, 2], data: [1, 2], row: [0, 0], col: [1, 1] },
    },
  }),
  libraryRow({
    id: 'scipy-explicit-zeros',
    call: 'scipy_explicit_zeros()',
    requires: ['scipy'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Explicit zero entries remain stored.',
    expected: {
      kind: 'match',
      value: { format: 'coo', shape: [2, 2], data: [0, 2], row: [0, 1], col: [0, 1] },
    },
  }),

  // Torch dense tensors use the nested ndarray Arrow path.
  libraryRow({
    id: 'torch-float32',
    call: 'torch_float32()',
    requires: ['torch', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'A dense float32 CPU tensor round-trips.',
    expected: {
      kind: 'match',
      value: { data: [1.5, -2.25], shape: [2], dtype: 'torch.float32', device: 'cpu' },
    },
  }),
  libraryRow({
    id: 'torch-float16-arrow',
    call: 'torch_float16()',
    codec: 'arrow',
    requires: ['torch', 'pyarrow'],
    status: 'KNOWN_LIE',
    currentBehavior: 'Arrow JS exposes float16 tensor storage bits as numbers.',
    expected: {
      kind: 'match',
      value: { data: [15872, 49280], shape: [2], dtype: 'torch.float16', device: 'cpu' },
    },
    expectedFix: 'Future Arrow float16 decoding that preserves numeric values.',
  }),
  libraryRow({
    id: 'torch-float16-json',
    call: 'torch_float16()',
    codec: 'json',
    requires: ['torch'],
    status: 'EXPECTED_OK',
    currentBehavior: 'JSON fallback preserves float16 tensor values.',
    expected: {
      kind: 'match',
      value: { data: [1.5, -2.25], shape: [2], dtype: 'torch.float16', device: 'cpu' },
    },
  }),
  libraryRow({
    id: 'torch-bool',
    call: 'torch_bool()',
    requires: ['torch', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'A dense bool CPU tensor round-trips.',
    expected: {
      kind: 'match',
      value: { data: [true, false], shape: [2], dtype: 'torch.bool', device: 'cpu' },
    },
  }),
  libraryRow({
    id: 'torch-int64',
    call: 'torch_int64()',
    requires: ['torch', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Safe dense int64 CPU tensor values round-trip as numbers.',
    expected: {
      kind: 'match',
      value: { data: [1, -2], shape: [2], dtype: 'torch.int64', device: 'cpu' },
    },
  }),
  libraryRow({
    id: 'torch-scalar',
    call: 'torch_scalar()',
    requires: ['torch', 'pyarrow'],
    status: 'EXPECTED_OK',
    currentBehavior: 'The nested 0-D ndarray flattens for Arrow, so the scalar tensor round-trips.',
    expected: {
      kind: 'match',
      value: { data: 7, shape: [], dtype: 'torch.int64', device: 'cpu' },
    },
  }),
  libraryRow({
    id: 'torch-bfloat16',
    call: 'torch_bfloat16()',
    requires: ['torch', 'pyarrow'],
    status: 'LOUD_FAIL',
    currentBehavior: 'NumPy conversion rejects bfloat16.',
    expected: error(/Failed to convert torch\.Tensor to numpy/i),
  }),
  libraryRow({
    id: 'torch-sparse',
    call: 'torch_sparse()',
    requires: ['torch'],
    status: 'LOUD_FAIL',
    currentBehavior: 'Sparse tensor layouts are rejected explicitly.',
    expected: error(/sparse tensors are not supported/i),
  }),
  libraryRow({
    id: 'torch-quantized',
    call: 'torch_quantized()',
    requires: ['torch'],
    featureProbe: 'import torch; print("1" if hasattr(torch, "quantize_per_tensor") else "0")',
    status: 'LOUD_FAIL',
    currentBehavior: 'Quantized tensors are rejected explicitly.',
    expected: error(/quantized tensors are not supported/i),
  }),
  libraryRow({
    id: 'torch-complex',
    call: 'torch_complex()',
    requires: ['torch'],
    status: 'LOUD_FAIL',
    currentBehavior: 'Complex tensors are rejected explicitly.',
    expected: error(/complex tensors are not supported/i),
  }),

  libraryRow({
    id: 'sklearn-simple-estimator',
    call: 'sklearn_simple_estimator()',
    requires: ['sklearn'],
    status: 'EXPECTED_OK',
    currentBehavior: 'Plain estimator parameters serialize as metadata.',
    expected: {
      kind: 'match',
      value: { className: 'LinearRegression', params: { fit_intercept: false, positive: true } },
    },
  }),
  libraryRow({
    id: 'sklearn-pipeline',
    call: 'sklearn_pipeline()',
    requires: ['sklearn'],
    status: 'LOUD_FAIL',
    currentBehavior: 'Pipeline steps contain nested estimators and reject.',
    expected: error(/param 'steps' is not JSON-serializable/i),
  }),
  libraryRow({
    id: 'sklearn-tfidf-vectorizer',
    call: 'sklearn_tfidf_vectorizer()',
    requires: ['sklearn'],
    status: 'LOUD_FAIL',
    currentBehavior: 'The dtype type-object parameter rejects.',
    expected: error(/param 'dtype' is not JSON-serializable/i),
  }),
  libraryRow({
    id: 'networkx-tuple-key-shape',
    call: 'networkx_tuple_key_shape()',
    requires: ['networkx'],
    status: 'LOUD_FAIL',
    currentBehavior: 'Tuple-key graph dictionaries reject at the JSON object-key boundary.',
    expected: error(/keys must be str|JSON encoding failed/i),
  }),
];
