"""Regression tests for the shared subprocess/Pyodide bridge core."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest


RUNTIME_DIR = Path(__file__).parent.parent.parent / 'runtime'

sys.path.insert(0, str(RUNTIME_DIR))

from tywrap_bridge_core import (  # noqa: E402
    PROTOCOL,
    ProtocolError,
    deserialize,
    dispatch_request,
    serialize_ndarray_json,
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
    assert serialize(value, force_json_markers=True) is value
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
