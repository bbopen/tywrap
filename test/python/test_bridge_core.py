"""Regression tests for the shared subprocess/Pyodide bridge core."""

from __future__ import annotations

import json
import subprocess
import sys
import tracemalloc
from pathlib import Path

import pytest


RUNTIME_DIR = Path(__file__).parent.parent.parent / 'runtime'

sys.path.insert(0, str(RUNTIME_DIR))

import tywrap_bridge_core as bridge_core  # noqa: E402
from tywrap_bridge_core import (  # noqa: E402
    MAX_SERIALIZE_DEPTH,
    MAX_SERIALIZE_NODES,
    PROTOCOL,
    CodecError,
    ProtocolError,
    deserialize,
    dispatch_request,
    encode_value,
    serialize,
    serialize_dataframe_json,
    serialize_ndarray_json,
    serialize_series_json,
)


def test_plain_values_do_not_import_scientific_codecs() -> None:
    """Plain JSON values must not cold-import optional scientific packages."""
    script = f"""
import json
import sys

sys.path.insert(0, {str(RUNTIME_DIR)!r})
from tywrap_bridge_core import serialize

packages = ('numpy', 'pandas', 'scipy', 'torch', 'sklearn')
before = {{package for package in packages if package in sys.modules}}
for value in (1, 'plain', [1, 'two'], {{'nested': [3]}}):
    assert serialize(value, force_json_markers=True) == value
after = {{package for package in packages if package in sys.modules}}
print(json.dumps(sorted(after - before)))
"""

    completed = subprocess.run(
        [sys.executable, '-c', script],
        check=True,
        capture_output=True,
        text=True,
    )

    assert json.loads(completed.stdout) == []


def test_serializes_all_marker_families_inside_plain_containers() -> None:
    np = pytest.importorskip('numpy')
    pd = pytest.importorskip('pandas')
    sparse = pytest.importorskip('scipy.sparse')
    torch = pytest.importorskip('torch')
    linear_model = pytest.importorskip('sklearn.linear_model')

    value = {
        'matrix': np.array([[1, 2]], dtype=np.int64),
        'items': [
            pd.DataFrame({'value': [3]}),
            pd.Series([4], name='values'),
            sparse.csr_matrix([[0, 5]]),
        ],
        'models': (
            torch.tensor([6], dtype=torch.int64),
            linear_model.LinearRegression(fit_intercept=False),
        ),
    }

    result = serialize(value, force_json_markers=True)

    assert result['matrix']['__tywrap__'] == 'ndarray'
    assert [item['__tywrap__'] for item in result['items']] == [
        'dataframe',
        'series',
        'scipy.sparse',
    ]
    assert isinstance(result['models'], tuple)
    assert [item['__tywrap__'] for item in result['models']] == [
        'torch.tensor',
        'sklearn.estimator',
    ]


def test_cycle_rejection_names_the_nested_path() -> None:
    value: dict[str, object] = {'items': []}
    items = value['items']
    assert isinstance(items, list)
    items.append(value)

    with pytest.raises(RuntimeError, match=r'Circular reference detected at result\.items\[0\]'):
        serialize(value, force_json_markers=True)


def test_full_encode_accepts_depth_bound_and_rejects_next_container() -> None:
    def nested(depth: int) -> dict[str, object]:
        root: dict[str, object] = {}
        cursor = root
        for _ in range(depth):
            child: dict[str, object] = {}
            cursor['next'] = child
            cursor = child
        return root

    encoded = encode_value(
        serialize(nested(MAX_SERIALIZE_DEPTH), force_json_markers=True),
        allow_nan=False,
    )
    assert encoded.startswith('{"next":')
    path = 'result' + '.next' * (MAX_SERIALIZE_DEPTH + 1)
    with pytest.raises(RuntimeError) as exc_info:
        serialize(nested(MAX_SERIALIZE_DEPTH + 1), force_json_markers=True)
    assert str(exc_info.value) == (
        f'Scientific envelope serialization maximum depth {MAX_SERIALIZE_DEPTH} '
        f'exceeded at {path}'
    )


def test_primitive_leaf_does_not_consume_depth_budget() -> None:
    root: dict[str, object] = {}
    cursor = root
    for _ in range(MAX_SERIALIZE_DEPTH):
        child: dict[str, object] = {}
        cursor['next'] = child
        cursor = child
    cursor['value'] = 1

    serialize(root, force_json_markers=True)


def test_wide_primitive_list_does_not_consume_node_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(bridge_core, 'MAX_SERIALIZE_NODES', 1)
    value = list(range(250_000))

    tracemalloc.start()
    try:
        result = serialize(value, force_json_markers=True)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert result == value
    assert peak < 12 * 1024 * 1024


def test_container_node_bound_names_first_excess_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert MAX_SERIALIZE_NODES == 1_000_000
    monkeypatch.setattr(bridge_core, 'MAX_SERIALIZE_NODES', 3)

    with pytest.raises(RuntimeError) as exc_info:
        serialize([[], [], []], force_json_markers=True)

    assert str(exc_info.value) == (
        'Scientific envelope serialization maximum visited nodes '
        '3 exceeded at result[2]'
    )


def test_scientific_envelopes_consume_container_node_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    np = pytest.importorskip('numpy')
    monkeypatch.setattr(bridge_core, 'MAX_SERIALIZE_NODES', 3)

    with pytest.raises(RuntimeError) as exc_info:
        serialize([np.array([1]), np.array([2]), np.array([3])], force_json_markers=True)

    assert str(exc_info.value) == (
        'Scientific envelope serialization maximum visited nodes '
        '3 exceeded at result[2]'
    )


def test_torch_nested_ndarray_envelope_consumes_node_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    torch = pytest.importorskip('torch')
    monkeypatch.setattr(bridge_core, 'MAX_SERIALIZE_NODES', 2)

    with pytest.raises(RuntimeError) as exc_info:
        serialize([torch.tensor([1])], force_json_markers=True)

    assert str(exc_info.value) == (
        'Scientific value serialization failed at result[0]: '
        'Scientific envelope serialization maximum visited nodes '
        '2 exceeded at result[0].value'
    )


def test_scientific_leaf_consumes_depth_budget() -> None:
    np = pytest.importorskip('numpy')

    def nested_with_array(depth: int) -> dict[str, object]:
        root: dict[str, object] = {}
        cursor = root
        for _ in range(depth):
            child: dict[str, object] = {}
            cursor['next'] = child
            cursor = child
        cursor['matrix'] = np.array([1], dtype=np.int64)
        return root

    serialize(nested_with_array(MAX_SERIALIZE_DEPTH - 1), force_json_markers=True)
    path = 'result' + '.next' * MAX_SERIALIZE_DEPTH + '.matrix'
    with pytest.raises(RuntimeError) as exc_info:
        serialize(nested_with_array(MAX_SERIALIZE_DEPTH), force_json_markers=True)
    assert str(exc_info.value).endswith(f'exceeded at {path}')


def test_torch_tensor_reserves_depth_for_its_nested_ndarray() -> None:
    torch = pytest.importorskip('torch')

    def nested_with_tensor(depth: int) -> dict[str, object]:
        root: dict[str, object] = {}
        cursor = root
        for _ in range(depth):
            child: dict[str, object] = {}
            cursor['next'] = child
            cursor = child
        cursor['tensor'] = torch.tensor([1], dtype=torch.int64)
        return root

    serialize(nested_with_tensor(MAX_SERIALIZE_DEPTH - 2), force_json_markers=True)
    path = 'result' + '.next' * (MAX_SERIALIZE_DEPTH - 1) + '.tensor.value'
    with pytest.raises(RuntimeError) as exc_info:
        serialize(nested_with_tensor(MAX_SERIALIZE_DEPTH - 1), force_json_markers=True)
    assert str(exc_info.value).endswith(f'exceeded at {path}')


def test_depth_rejection_precedes_scientific_codec_rejection() -> None:
    np = pytest.importorskip('numpy')
    root: dict[str, object] = {}
    cursor = root
    for _ in range(MAX_SERIALIZE_DEPTH):
        child: dict[str, object] = {}
        cursor['next'] = child
        cursor = child
    cursor['matrix'] = np.array([object()], dtype=object)

    with pytest.raises(RuntimeError) as exc_info:
        serialize(root, force_json_markers=True)

    assert f'maximum depth {MAX_SERIALIZE_DEPTH} exceeded' in str(exc_info.value)
    assert 'object dtype' not in str(exc_info.value)


def test_invalid_dict_key_names_the_offending_path() -> None:
    value = {'items': [{('bad', 1): 'value'}]}

    with pytest.raises(TypeError) as exc_info:
        serialize(value, force_json_markers=True)

    assert "result.items[0][('bad', 1)]" in str(exc_info.value)
    assert 'keys must be str, int, float, bool or None, not tuple' in str(exc_info.value)


def test_nested_set_uses_the_same_default_encoding_as_a_root_set() -> None:
    value = {1, 2}
    root_json = encode_value(
        serialize(value, force_json_markers=True),
        allow_nan=False,
    )
    nested_json = encode_value(
        serialize({'outer': {'values': value}}, force_json_markers=True),
        allow_nan=False,
    )

    assert nested_json == f'{{"outer": {{"values": {root_json}}}}}'


def test_model_dump_information_error_preserves_origin_behavior() -> None:
    class BrokenModel:
        def model_dump(self, **_kwargs: object) -> object:
            raise ValueError('invalid information')

    with pytest.raises(RuntimeError, match='^model_dump failed: invalid information$'):
        serialize(BrokenModel(), force_json_markers=True)

    with pytest.raises(CodecError, match='^JSON encoding failed: invalid information$'):
        encode_value(BrokenModel(), allow_nan=False)


def test_rejected_scientific_dtype_keeps_error_and_adds_path() -> None:
    np = pytest.importorskip('numpy')

    with pytest.raises(RuntimeError) as exc_info:
        serialize(
            {'items': [{'matrix': np.array([object()], dtype=object)}]},
            force_json_markers=True,
        )

    message = str(exc_info.value)
    assert 'Scientific value serialization failed at result.items[0].matrix' in message
    assert 'object dtype=object' in message


def test_shared_aliases_are_serialized_with_value_semantics() -> None:
    np = pytest.importorskip('numpy')
    shared = [np.array([1], dtype=np.int64)]

    result = serialize({'left': shared, 'right': shared}, force_json_markers=True)

    assert result['left'] == result['right']
    assert result['left'] is not result['right']
    assert result['left'][0] is not result['right'][0]


def test_deserialize_fast_path_preserves_plain_request_tree() -> None:
    value = {'nested': [{'value': 1}, {'value': 'plain'}]}

    assert deserialize(value, has_envelope_markers=False) is value


def test_deserialize_still_decodes_bytes_envelope_when_markers_are_present() -> None:
    value = {'data': {'__tywrap_bytes__': True, 'b64': 'aGVsbG8='}}

    assert deserialize(value, has_envelope_markers=True) == {'data': b'hello'}


def test_stateful_instance_methods_are_unknown() -> None:
    with pytest.raises(ProtocolError, match='Unknown method: instantiate'):
        dispatch_request(
            {'id': 1, 'protocol': PROTOCOL, 'method': 'instantiate', 'params': {}},
            bridge='test',
            pid=None,
            force_json_markers=True,
        )


def test_ndarray_json_declares_dtype_for_empty_array() -> None:
    np = pytest.importorskip('numpy')

    empty = serialize_ndarray_json(np.array([], dtype=np.int64))

    assert empty['data'] == []
    assert empty['dtype'] == 'int64'


@pytest.mark.parametrize('dtype', ['float16', 'float32', 'float64'])
def test_ndarray_json_serializes_standard_floats_without_astype(dtype: str) -> None:
    np = pytest.importorskip('numpy')

    class NoAstypeArray(np.ndarray):
        def astype(self, *args, **kwargs):
            raise AssertionError('serialize_ndarray_json must not call astype')

    array = np.array([1.5, -2.25], dtype=dtype).view(NoAstypeArray)
    envelope = serialize_ndarray_json(array)

    assert envelope['data'] == [1.5, -2.25]
    assert envelope['dtype'] == dtype


def test_ndarray_json_keeps_existing_nonfinite_float_behavior() -> None:
    np = pytest.importorskip('numpy')

    envelope = serialize_ndarray_json(np.array([np.nan, np.inf], dtype=np.float64))

    assert np.isnan(envelope['data'][0])
    assert envelope['data'][1] == np.inf
    assert envelope['dtype'] == 'float64'


def test_ndarray_json_accepts_safe_integer_boundaries() -> None:
    np = pytest.importorskip('numpy')

    signed = serialize_ndarray_json(
        np.array([-(2**53 - 1), 2**53 - 1], dtype=np.int64)
    )
    unsigned = serialize_ndarray_json(np.array([2**53 - 1], dtype=np.uint64))

    assert signed['data'] == [-(2**53 - 1), 2**53 - 1]
    assert signed['dtype'] == 'int64'
    assert unsigned['data'] == [2**53 - 1]
    assert unsigned['dtype'] == 'uint64'


@pytest.mark.parametrize(
    ('dtype', 'value'),
    [('int64', -(2**53)), ('int64', 2**53), ('uint64', 2**53)],
)
def test_ndarray_json_rejects_unsafe_integers(dtype: str, value: int) -> None:
    np = pytest.importorskip('numpy')

    with pytest.raises(
        RuntimeError,
        match=rf"dtype={dtype}.*use Arrow encoding or cast/encode explicitly.*astype\('float64'\).*str",
    ):
        serialize_ndarray_json(np.array([value], dtype=dtype))


def test_ndarray_json_rejects_longdouble_wider_than_float64() -> None:
    np = pytest.importorskip('numpy')
    if np.dtype(np.longdouble).itemsize <= np.dtype(np.float64).itemsize:
        pytest.skip('longdouble is not wider than float64 on this platform')

    with pytest.raises(RuntimeError) as exc_info:
        serialize_ndarray_json(np.array([1.25, -2.5], dtype=np.longdouble))

    message = str(exc_info.value)
    assert f'dtype={np.dtype(np.longdouble)}' in message
    assert 'wider than 64 bits' in message
    assert ".astype('float64')" in message
    assert 'Arrow' in message


@pytest.mark.parametrize(
    ('array', 'error_pattern'),
    [
        (
            lambda np: np.array(['2024-01-01'], dtype='datetime64[D]'),
            r"dtype=datetime64\[D\].*astype\('datetime64\[ms\]'\)\.astype\(str\).*declared unit",
        ),
        (
            lambda np: np.array([1], dtype='timedelta64[ms]'),
            r"dtype=timedelta64\[ms\].*astype\('timedelta64\[ms\]'\)\.astype\(str\).*declared unit",
        ),
        (
            lambda np: np.array([1], dtype='>i4'),
            r"big-endian dtype=>i4.*a\.byteswap\(\)\.view\(a\.dtype\.newbyteorder\('='\)\)",
        ),
        (
            lambda np: np.array([(1, 2.5)], dtype=[('left', 'i4'), ('right', 'f4')]),
            r'structured dtype=.*encode each named field explicitly',
        ),
        (
            lambda np: np.array([object()], dtype=object),
            r'object dtype=object.*encode elements explicitly',
        ),
        (lambda np: np.array([b'x'], dtype='S1'), r'byte-string dtype=.*plain JSON list'),
        (lambda np: np.array(['x'], dtype='U1'), r'unicode dtype=.*\.tolist\(\)'),
        (lambda np: np.array([1 + 2j]), r'complex dtype=complex128.*\.real and \.imag'),
        (lambda np: np.array([b'ab'], dtype='V2'), r"void dtype=.*view\('uint8'\)"),
    ],
)
def test_ndarray_json_rejects_lossy_dtypes(array, error_pattern: str) -> None:
    np = pytest.importorskip('numpy')

    with pytest.raises(RuntimeError, match=error_pattern):
        serialize_ndarray_json(array(np))


def test_dataframe_json_allows_values_only_and_normalizes_nulls() -> None:
    pd = pytest.importorskip('pandas')

    frame = pd.DataFrame(
        {
            'integer': pd.Series([1, pd.NA], dtype='Int64'),
            'boolean': pd.Series([True, pd.NA], dtype='boolean'),
            'text': pd.Series(['a', pd.NA], dtype='string[pyarrow]'),
            'missing_time': [pd.NaT, pd.NaT],
            'none': pd.Series([None, None], dtype=object),
        }
    )

    envelope = serialize_dataframe_json(frame)

    assert envelope['data'] == [
        {'integer': 1, 'boolean': True, 'text': 'a', 'missing_time': None, 'none': None},
        {
            'integer': None,
            'boolean': None,
            'text': None,
            'missing_time': None,
            'none': None,
        },
    ]


def test_series_json_allows_values_only_and_normalizes_nulls() -> None:
    pd = pytest.importorskip('pandas')

    envelope = serialize_series_json(pd.Series([1, pd.NA], dtype='Int64', name='value'))

    assert envelope['data'] == [1, None]
    assert envelope['name'] == 'value'


@pytest.mark.parametrize(
    ('frame', 'expected'),
    [
        pytest.param(lambda pd: pd.DataFrame(), [], id='empty-frame'),
        pytest.param(
            lambda pd: pd.DataFrame(index=pd.RangeIndex(2)), [{}, {}], id='empty-columns'
        ),
        pytest.param(
            lambda pd: pd.DataFrame({'value': [None, pd.NA]}),
            [{'value': None}, {'value': None}],
            id='all-null-column',
        ),
    ],
)
def test_dataframe_json_allows_empty_shapes_and_all_null_column(frame, expected) -> None:
    pd = pytest.importorskip('pandas')

    envelope = serialize_dataframe_json(frame(pd))

    assert envelope['data'] == expected


@pytest.mark.parametrize('producer', ['dataframe', 'series'])
def test_pandas_json_rejects_nondefault_index(producer: str) -> None:
    pd = pytest.importorskip('pandas')
    value = (
        pd.DataFrame({'value': [1]}, index=pd.RangeIndex(1, 2))
        if producer == 'dataframe'
        else pd.Series([1], index=pd.RangeIndex(1, 2))
    )

    with pytest.raises(RuntimeError, match=r'RangeIndex starting at 0.*reset_index\(drop=True\)'):
        (serialize_dataframe_json if producer == 'dataframe' else serialize_series_json)(value)


@pytest.mark.parametrize('producer', ['dataframe', 'series'])
def test_pandas_json_rejects_multiindex(producer: str) -> None:
    pd = pytest.importorskip('pandas')
    index = pd.MultiIndex.from_tuples([('left', 1)], names=['side', 'number'])
    value = (
        pd.DataFrame({'value': [1]}, index=index)
        if producer == 'dataframe'
        else pd.Series([1], index=index)
    )

    with pytest.raises(RuntimeError, match=r'MultiIndex.*reset_index\(\)'):
        (serialize_dataframe_json if producer == 'dataframe' else serialize_series_json)(value)


def test_dataframe_json_rejects_duplicate_column_labels() -> None:
    pd = pytest.importorskip('pandas')

    with pytest.raises(
        RuntimeError, match=r'unique after JSON object-key coercion.*astype\(str\)'
    ):
        serialize_dataframe_json(pd.DataFrame([[1, 2]], columns=['value', 'value']))


@pytest.mark.parametrize(
    'columns',
    [
        pytest.param([1, '1'], id='integer'),
        pytest.param([True, 'true'], id='true'),
        pytest.param([False, 'false'], id='false'),
        pytest.param([None, 'null'], id='null'),
    ],
)
def test_dataframe_json_rejects_column_labels_that_collide_as_json_keys(columns) -> None:
    pd = pytest.importorskip('pandas')

    with pytest.raises(
        RuntimeError, match=r'unique after JSON object-key coercion.*astype\(str\)'
    ):
        serialize_dataframe_json(
            pd.DataFrame([[1, 2]], columns=pd.Index(columns, dtype=object))
        )


@pytest.mark.parametrize('producer', ['dataframe', 'series'])
def test_pandas_json_rejects_categorical_dtype(producer: str) -> None:
    pd = pytest.importorskip('pandas')
    series = pd.Series(pd.Categorical(['a'], categories=['a', 'b'], ordered=True))
    value = pd.DataFrame({'value': series}) if producer == 'dataframe' else series

    with pytest.raises(RuntimeError, match=r'categorical dtype.*Arrow.*astype\(str\)'):
        (serialize_dataframe_json if producer == 'dataframe' else serialize_series_json)(value)


@pytest.mark.parametrize(
    ('producer', 'series'),
    [
        pytest.param(
            'dataframe',
            lambda pd: pd.Series([pd.Timestamp('2024-01-01', tz='UTC')]),
            id='dataframe-extension-timestamp',
        ),
        pytest.param(
            'series',
            lambda pd: pd.Series([object()], dtype=object),
            id='series-object-cell',
        ),
    ],
)
def test_pandas_json_rejects_nonplain_cells(producer: str, series) -> None:
    pd = pytest.importorskip('pandas')
    value_series = series(pd)
    value = pd.DataFrame({'value': value_series}) if producer == 'dataframe' else value_series

    with pytest.raises(RuntimeError, match=r'value of type (Timestamp|object).*Arrow.*astype\(str\)'):
        (serialize_dataframe_json if producer == 'dataframe' else serialize_series_json)(value)


@pytest.mark.parametrize('producer', ['dataframe', 'series'])
def test_pandas_json_rejects_unsafe_integers(producer: str) -> None:
    pd = pytest.importorskip('pandas')
    series = pd.Series([2**53], dtype=object)
    value = pd.DataFrame({'value': series}) if producer == 'dataframe' else series

    with pytest.raises(
        RuntimeError,
        match=r'outside the JavaScript safe integer range.*Arrow.*astype\(\'float64\'\).*str',
    ):
        (serialize_dataframe_json if producer == 'dataframe' else serialize_series_json)(value)


@pytest.mark.parametrize('producer', ['dataframe', 'series'])
@pytest.mark.parametrize('value', [float('nan'), float('inf'), float('-inf')])
def test_pandas_json_rejects_nonfinite_floats(producer: str, value: float) -> None:
    pd = pytest.importorskip('pandas')
    series = pd.Series([value], dtype='float64')
    pandas_value = pd.DataFrame({'value': series}) if producer == 'dataframe' else series

    with pytest.raises(
        RuntimeError,
        match=r'non-finite.*NaN or Infinity.*fillna\(\.\.\.\).*Arrow encoding',
    ):
        (serialize_dataframe_json if producer == 'dataframe' else serialize_series_json)(
            pandas_value
        )


def test_dataframe_json_normalizes_json_safe_numpy_scalars_in_object_columns() -> None:
    np = pytest.importorskip('numpy')
    pd = pytest.importorskip('pandas')
    frame = pd.DataFrame(
        {
            'integer': pd.Series([np.int64(7)], dtype=object),
            'boolean': pd.Series([np.bool_(True)], dtype=object),
            'text': pd.Series([np.str_('value')], dtype=object),
            'float': pd.Series([np.float64(1.25)], dtype=object),
        }
    )

    assert serialize_dataframe_json(frame)['data'] == [
        {'integer': 7, 'boolean': True, 'text': 'value', 'float': 1.25}
    ]


def test_dataframe_json_rejects_unsafe_numpy_integer_in_object_column() -> None:
    np = pytest.importorskip('numpy')
    pd = pytest.importorskip('pandas')

    with pytest.raises(RuntimeError, match='outside the JavaScript safe integer range'):
        serialize_dataframe_json(
            pd.DataFrame({'value': pd.Series([np.int64(2**53)], dtype=object)})
        )
