"""Isolated wire prototypes for #337 and #339. Production never imports this file."""

from __future__ import annotations

import dataclasses
import json
import math
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


MAX_DECIMAL_DIGITS = 4096
MAX_DEPTH = 64
MAX_NODES = 100_000
MAX_PAYLOAD_BYTES = 10 * 1024 * 1024
SAFE_INTEGER_MAX = 2**53 - 1
MAX_INTEGER_MAGNITUDE = 10**MAX_DECIMAL_DIGITS
DECIMAL = re.compile(r'(?:0|[1-9][0-9]*|-[1-9][0-9]*)\Z', re.ASCII)
INTEGER_FIELDS = frozenset({'__tywrap__', 'codecVersion', 'encoding', 'value'})


class PrototypeError(ValueError):
    """A value cannot satisfy the proposed extension contract."""


@dataclass
class Budget:
    nodes: int = 0

    def visit(self, path: str, depth: int) -> None:
        self.nodes += 1
        if depth > MAX_DEPTH:
            raise PrototypeError(f'maximum depth {MAX_DEPTH} exceeded at {path}')
        if self.nodes > MAX_NODES:
            raise PrototypeError(f'maximum nodes {MAX_NODES} exceeded at {path}')


def _check_payload(value: object, max_payload_bytes: int) -> None:
    try:
        encoded = json.dumps(
            value, allow_nan=False, ensure_ascii=False, separators=(',', ':')
        )
        byte_count = len(encoded.encode('utf-8'))
    except (UnicodeEncodeError, ValueError) as exc:
        raise PrototypeError('payload is not finite UTF-8 JSON') from exc
    if byte_count > max_payload_bytes:
        raise PrototypeError(f'payload exceeds {max_payload_bytes} bytes')


def _version_two(value: object) -> bool:
    return type(value) in (int, float) and value == 2


def _child(path: str, key: str | int) -> str:
    return f'{path}[{key}]' if isinstance(key, int) else f'{path}.{key}'


def require_capability(meta: Mapping[str, object], feature: str, policy: str) -> None:
    capabilities = meta.get('valueCapabilities')
    if not isinstance(capabilities, list) or feature not in capabilities:
        raise PrototypeError(f'bridge lacks {feature} capability')
    expected_policy = {
        'exactIntegerDecimalV2': 'bigint-v2',
        'dataclassFieldsV2': 'fields-v2',
    }.get(feature)
    if policy != expected_policy:
        raise PrototypeError(f'unsupported per-call value policy {policy!r}')


def _canonical_decimal(value: object, path: str) -> int:
    if not isinstance(value, str) or not DECIMAL.fullmatch(value):
        raise PrototypeError(f'noncanonical integer decimal at {path}')
    digits = len(value) - (1 if value.startswith('-') else 0)
    if digits > MAX_DECIMAL_DIGITS:
        raise PrototypeError(f'integer exceeds {MAX_DECIMAL_DIGITS} digits at {path}')
    return int(value)


def _integer_envelope(value: int, path: str) -> dict[str, object]:
    if abs(value) >= MAX_INTEGER_MAGNITUDE:
        raise PrototypeError(f'integer exceeds {MAX_DECIMAL_DIGITS} digits at {path}')
    try:
        decimal = str(value)
    except ValueError as exc:
        raise PrototypeError(f'integer conversion failed at {path}') from exc
    _canonical_decimal(decimal, path)
    return {
        '__tywrap__': 'integer',
        'codecVersion': 2,
        'encoding': 'decimal',
        'value': decimal,
    }


def encode_exact_integers(
    value: object,
    *,
    max_payload_bytes: int = MAX_PAYLOAD_BYTES,
) -> object:
    """Encode all Python integers as exact tagged values for an opted call."""
    budget = Budget()
    active: set[int] = set()

    def visit(current: object, path: str, depth: int) -> object:
        budget.visit(path, depth)
        if current is None or type(current) in (bool, str):
            return current
        if type(current) is int:
            return _integer_envelope(current, path)
        if type(current) is float and math.isfinite(current):
            return current
        if isinstance(current, (list, tuple, dict)):
            marker = id(current)
            if marker in active:
                raise PrototypeError(f'cycle at {path}')
            active.add(marker)
            try:
                if isinstance(current, dict):
                    if any(not isinstance(key, str) for key in current):
                        raise PrototypeError(f'non-string record key at {path}')
                    if '__tywrap__' in current:
                        raise PrototypeError(f'reserved record key at {path}.__tywrap__')
                    return {
                        key: visit(item, _child(path, key), depth + 1)
                        for key, item in current.items()
                    }
                return [
                    visit(item, _child(path, index), depth + 1)
                    for index, item in enumerate(current)
                ]
            finally:
                active.remove(marker)
        raise PrototypeError(f'unsupported value at {path}: {type(current).__name__}')

    result = visit(value, 'result', 0)
    _check_payload(result, max_payload_bytes)
    return result


def decode_exact_integers(
    value: object,
    contract: Mapping[str, Any],
    *,
    max_payload_bytes: int = MAX_PAYLOAD_BYTES,
) -> object:
    """Decode an opted request with its trusted resolved value contract."""
    _check_payload(value, max_payload_bytes)
    budget = Budget()
    active: set[int] = set()

    def visit(
        current: object, spec: Mapping[str, Any], path: str, depth: int
    ) -> object:
        kind = spec.get('kind')
        if kind == 'nullable':
            if current is None:
                return visit(None, {'kind': 'null'}, path, depth)
            return visit(current, spec['value'], path, depth)
        budget.visit(path, depth)
        marker = id(current) if isinstance(current, (list, dict)) else None
        if marker is not None:
            if marker in active:
                raise PrototypeError(f'cycle at {path}')
            active.add(marker)
        try:
            if kind == 'null':
                if current is not None:
                    raise PrototypeError(f'expected null at {path}')
                return None
            if kind == 'boolean':
                if type(current) is not bool:
                    raise PrototypeError(f'expected boolean at {path}')
                return current
            if kind == 'string':
                if type(current) is not str:
                    raise PrototypeError(f'expected string at {path}')
                return current
            if kind == 'integer':
                if not isinstance(current, dict):
                    raise PrototypeError(f'untagged integer at {path}')
                if (
                    set(current) != INTEGER_FIELDS
                    or current.get('__tywrap__') != 'integer'
                    or not _version_two(current.get('codecVersion'))
                    or current.get('encoding') != 'decimal'
                ):
                    raise PrototypeError(f'invalid integer envelope at {path}')
                return _canonical_decimal(current['value'], _child(path, 'value'))
            if kind == 'safe-integer':
                if (
                    type(current) is not int
                    or current < -SAFE_INTEGER_MAX
                    or current > SAFE_INTEGER_MAX
                ):
                    raise PrototypeError(f'expected safe integer at {path}')
                return current
            if kind == 'float':
                if isinstance(current, dict):
                    if current != {
                        '__tywrap__': 'float',
                        'codecVersion': 2,
                        'encoding': 'negative-zero',
                    } or not _version_two(current.get('codecVersion')):
                        raise PrototypeError(f'invalid float envelope at {path}')
                    return -0.0
                if type(current) not in (int, float):
                    raise PrototypeError(f'expected finite float at {path}')
                try:
                    result = float(current)
                except OverflowError as exc:
                    raise PrototypeError(f'expected finite float at {path}') from exc
                if not math.isfinite(result):
                    raise PrototypeError(f'expected finite float at {path}')
                return result
            if kind == 'array':
                if not isinstance(current, list):
                    raise PrototypeError(f'expected array at {path}')
                return [
                    visit(item, spec['item'], _child(path, index), depth + 1)
                    for index, item in enumerate(current)
                ]
            if kind == 'record':
                if not isinstance(current, dict):
                    raise PrototypeError(f'expected record at {path}')
                fields = spec['fields']
                if '__tywrap__' in current:
                    raise PrototypeError(f'reserved record key at {path}.__tywrap__')
                if set(current) != set(fields):
                    raise PrototypeError(f'fields differ at {path}')
                return {
                    key: visit(current[key], field, _child(path, key), depth + 1)
                    for key, field in fields.items()
                }
            raise PrototypeError(f'unsupported contract kind {kind!r} at {path}')
        finally:
            if marker is not None:
                active.remove(marker)

    return visit(value, contract, 'args', 0)


def encode_dataclass(
    value: object,
    expected_type: type,
    *,
    max_payload_bytes: int = MAX_PAYLOAD_BYTES,
) -> dict[str, object]:
    """Encode only an annotated dataclass result as a version 2 envelope."""
    if type(value) is not expected_type or not dataclasses.is_dataclass(value):
        raise PrototypeError('result is not the declared dataclass type')
    budget = Budget()
    active: set[int] = set()

    def visit(current: object, path: str, depth: int) -> object:
        budget.visit(path, depth)
        if current is None or type(current) in (bool, str):
            return current
        if type(current) is int:
            if current < -SAFE_INTEGER_MAX or current > SAFE_INTEGER_MAX:
                raise PrototypeError(f'unsafe integer at {path}')
            return current
        if type(current) is float and math.isfinite(current):
            return current
        if dataclasses.is_dataclass(current) and not isinstance(current, type):
            marker = id(current)
            if marker in active:
                raise PrototypeError(f'cycle at {path}')
            active.add(marker)
            try:
                cls = type(current)
                fields = {
                    field.name: visit(
                        getattr(current, field.name),
                        _child(path, field.name),
                        depth + 1,
                    )
                    for field in dataclasses.fields(current)
                }
                return {
                    '__tywrap__': 'dataclass',
                    'codecVersion': 2,
                    'encoding': 'fields',
                    'type': f'{cls.__module__}.{cls.__qualname__}',
                    'fields': fields,
                }
            finally:
                active.remove(marker)
        if isinstance(current, (list, tuple, dict)):
            marker = id(current)
            if marker in active:
                raise PrototypeError(f'cycle at {path}')
            active.add(marker)
            try:
                if isinstance(current, dict):
                    if any(not isinstance(key, str) for key in current):
                        raise PrototypeError(f'non-string record key at {path}')
                    if '__tywrap__' in current:
                        raise PrototypeError(f'reserved record key at {path}.__tywrap__')
                    return {
                        key: visit(item, _child(path, key), depth + 1)
                        for key, item in current.items()
                    }
                return [
                    visit(item, _child(path, index), depth + 1)
                    for index, item in enumerate(current)
                ]
            finally:
                active.remove(marker)
        raise PrototypeError(f'unsupported value at {path}: {type(current).__name__}')

    result = visit(value, 'result', 0)
    assert isinstance(result, dict)
    _check_payload(result, max_payload_bytes)
    return result


@dataclass
class Point:
    x: int
    y: int


INTEGER_TEST_CONTRACT: dict[str, Any] = {
    'kind': 'record',
    'fields': {
        'positive': {'kind': 'array', 'item': {'kind': 'integer'}},
        'negative': {
            'kind': 'record',
            'fields': {'value': {'kind': 'integer'}},
        },
        'safe': {'kind': 'integer'},
        'flag': {'kind': 'boolean'},
        'whole': {'kind': 'float'},
        'fraction': {'kind': 'float'},
        'negativeZero': {'kind': 'float'},
        'mixed': {
            'kind': 'array',
            'item': {
                'kind': 'record',
                'fields': {
                    'quantity': {'kind': 'integer'},
                    'ratio': {'kind': 'float'},
                    'flag': {'kind': 'boolean'},
                },
            },
        },
    },
}


def _main() -> None:
    raw = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw) > MAX_PAYLOAD_BYTES:
        raise PrototypeError('input payload exceeds byte limit')
    payload: Any = json.loads(raw)
    action = sys.argv[1]
    if action == 'roundtrip-integer':
        require_capability(
            payload['meta'], 'exactIntegerDecimalV2', payload['policy']
        )
        result = encode_exact_integers(
            decode_exact_integers(payload['value'], INTEGER_TEST_CONTRACT)
        )
    elif action == 'encode-integer':
        result = encode_exact_integers(payload)
    elif action == 'roundtrip-single-integer':
        require_capability(
            payload['meta'], 'exactIntegerDecimalV2', payload['policy']
        )
        result = encode_exact_integers(
            decode_exact_integers(payload['value'], {'kind': 'integer'})
        )
    elif action == 'encode-point':
        result = encode_dataclass(Point(**payload), Point)
    else:
        raise PrototypeError(f'unknown action {action!r}')
    print(json.dumps(result, allow_nan=False, separators=(',', ':')))


if __name__ == '__main__':
    _main()
