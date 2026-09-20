"""Private Python call adapter for the exact-integer compiler proof."""

from __future__ import annotations

import json
import sys
from typing import Any

from value_contract_exact_integer import combine_exact
from value_extensions import (
    MAX_PAYLOAD_BYTES,
    PrototypeError,
    decode_exact_integers,
    encode_exact_integers,
    require_capability,
)


def main() -> None:
    trusted_contracts: list[dict[str, Any]] = json.loads(sys.argv[1])
    bridge_meta: dict[str, Any] = json.loads(sys.argv[2])
    raw = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw) > MAX_PAYLOAD_BYTES:
        raise PrototypeError('input payload exceeds byte limit')
    request: dict[str, Any] = json.loads(raw)
    if (request.get('module'), request.get('functionName')) != (
        'value_contract_exact_integer',
        'combine_exact',
    ):
        raise PrototypeError('unexpected exact-integer callable')
    params = request.get('params')
    if not isinstance(params, dict):
        raise PrototypeError('missing exact-integer call parameters')
    value_policy = params.get('valuePolicy')
    policy = value_policy.get('integer') if isinstance(value_policy, dict) else None
    require_capability(bridge_meta, 'exactIntegerDecimalV2', policy)
    args = params.get('args')
    if not isinstance(args, list) or len(args) != len(trusted_contracts):
        raise PrototypeError('exact-integer arguments differ from the contract')
    decoded = [
        decode_exact_integers(value, contract)
        for value, contract in zip(args, trusted_contracts, strict=True)
    ]
    result = combine_exact(*decoded)
    encoded = encode_exact_integers(result)
    wire = json.dumps(
        encoded, allow_nan=False, ensure_ascii=False, separators=(',', ':')
    ).encode('utf-8')
    sys.stdout.buffer.write(wire + b'\n')


if __name__ == '__main__':
    main()
