"""Private Python call adapter for the exact-integer compiler proof."""

from __future__ import annotations

import json
import sys
from typing import Any

from value_contract_exact_integer import combine_exact, echo_exact
from value_extensions import (
    MAX_PAYLOAD_BYTES,
    PrototypeError,
    decode_exact_integers,
    encode_exact_integers,
    require_capability,
)


def main() -> None:
    trusted_contract: dict[str, Any] = json.loads(sys.argv[1])
    bridge_meta: dict[str, Any] = json.loads(sys.argv[2])
    function_name = sys.argv[3]
    functions = {'combine_exact': combine_exact, 'echo_exact': echo_exact}
    function = functions.get(function_name)
    if function is None:
        raise PrototypeError('unknown exact-integer callable')
    raw = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw) > MAX_PAYLOAD_BYTES:
        raise PrototypeError('input payload exceeds byte limit')
    request: dict[str, Any] = json.loads(raw)
    if (request.get('module'), request.get('functionName')) != (
        'value_contract_exact_integer',
        function_name,
    ):
        raise PrototypeError('unexpected exact-integer callable')
    params = request.get('params')
    if not isinstance(params, dict):
        raise PrototypeError('missing exact-integer call parameters')
    value_policy = params.get('valuePolicy')
    policy = value_policy.get('integer') if isinstance(value_policy, dict) else None
    require_capability(bridge_meta, 'exactIntegerDecimalV2', policy)
    args = params.get('args')
    fields = trusted_contract.get('fields')
    if (
        trusted_contract.get('kind') != 'record'
        or not isinstance(fields, dict)
        or not isinstance(args, list)
        or len(args) != len(fields)
    ):
        raise PrototypeError('exact-integer arguments differ from the contract')
    input_record = dict(zip(fields, args, strict=True))
    decoded = decode_exact_integers(input_record, trusted_contract)
    assert isinstance(decoded, dict)
    result = function(**decoded)
    encoded = encode_exact_integers(result)
    wire = json.dumps(
        encoded, allow_nan=False, ensure_ascii=False, separators=(',', ':')
    ).encode('utf-8')
    sys.stdout.buffer.write(wire + b'\n')


if __name__ == '__main__':
    main()
