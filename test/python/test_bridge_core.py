"""Regression tests for the shared subprocess/Pyodide bridge core."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


RUNTIME_DIR = Path(__file__).parent.parent.parent / 'runtime'


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
