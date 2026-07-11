"""Regression tests for the shared subprocess/Pyodide bridge core."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest


RUNTIME_DIR = Path(__file__).parent.parent.parent / 'runtime'

sys.path.insert(0, str(RUNTIME_DIR))

from tywrap_bridge_core import PROTOCOL, ProtocolError, deserialize, dispatch_request  # noqa: E402


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
