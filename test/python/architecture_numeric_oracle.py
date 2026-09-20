"""Produce independent binary16 and safe-integer expectations for conformance tests."""

from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path


CONTRACT_REVISION = 2
SAFE_INTEGER_MAX = (1 << 53) - 1


def binary16_word(word: int) -> tuple[str, bool]:
    """Read one raw binary16 word with Python's standard IEEE 754 decoder."""
    value = struct.unpack('>e', word.to_bytes(2, 'big'))[0]
    if math.isnan(value):
        return 'NaN', False
    if math.isinf(value):
        return ('-Infinity' if value < 0 else '+Infinity'), False
    negative_zero = value == 0.0 and math.copysign(1.0, value) < 0
    return repr(value), negative_zero


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('usage: architecture_numeric_oracle.py FIXTURE_JSON')

    fixture = json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
    if fixture['schemaVersion'] != 1 or fixture['contractRevision'] != CONTRACT_REVISION:
        raise ValueError('architecture fixture version does not match the oracle')

    integers = []
    for case in fixture['safeIntegers']:
        value = int(case['decimal'])
        integers.append(
            {'decimal': case['decimal'], 'accepted': -SAFE_INTEGER_MAX <= value <= SAFE_INTEGER_MAX}
        )

    json.dump(
        {
            'contractRevision': CONTRACT_REVISION,
            'method': 'python-stdlib-struct-unpack-binary16',
            'words': [binary16_word(word) for word in range(1 << 16)],
            'integers': integers,
        },
        sys.stdout,
        separators=(',', ':'),
        allow_nan=False,
    )


if __name__ == '__main__':
    main()
