"""Bounded design tests. These codecs are not part of the shipped bridge."""

from __future__ import annotations

import math
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).parent.parent / 'prototypes'))
import value_extensions as prototype  # noqa: E402

INTEGER = {'kind': 'integer'}


def test_nested_exact_integers_round_trip_beyond_int64() -> None:
    value = {
        'outer': [2**80 + 1, -(2**130 + 7)],
        'nested': {'negative': -(2**130 + 7)},
        'safe': 7,
        'flag': True,
    }
    encoded = prototype.encode_exact_integers(value)
    assert encoded['outer'][0]['value'] == str(2**80 + 1)
    assert encoded['safe']['value'] == '7'
    assert encoded['flag'] is True
    contract = {
        'kind': 'record',
        'fields': {
            'outer': {'kind': 'array', 'item': INTEGER},
            'nested': {'kind': 'record', 'fields': {'negative': INTEGER}},
            'safe': INTEGER,
            'flag': {'kind': 'boolean'},
        },
    }
    assert prototype.decode_exact_integers(encoded, contract) == value


@pytest.mark.parametrize('bad', ['-0', '+1', '01', '-01', '1.0', '1e2', ' 1', '١'])
def test_integer_decimal_rejects_noncanonical_values(bad: str) -> None:
    envelope = {
        '__tywrap__': 'integer',
        'codecVersion': 2,
        'encoding': 'decimal',
        'value': bad,
    }
    with pytest.raises(prototype.PrototypeError, match='noncanonical integer decimal'):
        prototype.decode_exact_integers(
            {'item': [envelope]},
            {
                'kind': 'record',
                'fields': {'item': {'kind': 'array', 'item': INTEGER}},
            },
        )


def test_integer_digit_and_payload_caps() -> None:
    accepted = int('9' * prototype.MAX_DECIMAL_DIGITS)
    assert prototype.decode_exact_integers(
        prototype.encode_exact_integers(accepted), INTEGER
    ) == accepted
    with pytest.raises(prototype.PrototypeError, match='4096 digits'):
        prototype.encode_exact_integers(int('9' * (prototype.MAX_DECIMAL_DIGITS + 1)))
    with pytest.raises(
        prototype.PrototypeError, match=r'4096 digits at result.big\[0\]'
    ):
        prototype.encode_exact_integers({'big': [10**5000]})
    with pytest.raises(prototype.PrototypeError, match='payload exceeds 80 bytes'):
        prototype.encode_exact_integers({'text': 'x' * 80}, max_payload_bytes=80)


def test_unicode_payload_cap_counts_compact_utf8_bytes() -> None:
    assert prototype.encode_exact_integers('é', max_payload_bytes=4) == 'é'
    with pytest.raises(prototype.PrototypeError, match='payload exceeds 3 bytes'):
        prototype.encode_exact_integers('é', max_payload_bytes=3)

    nested = {'café': ['🍵', 'é']}
    expected_bytes = len('{"café":["🍵","é"]}'.encode('utf-8'))
    assert prototype.encode_exact_integers(
        nested, max_payload_bytes=expected_bytes
    ) == nested
    with pytest.raises(prototype.PrototypeError, match='payload exceeds'):
        prototype.encode_exact_integers(
            nested, max_payload_bytes=expected_bytes - 1
        )


@pytest.mark.parametrize(
    ('version_token', 'accepted'),
    [('2', True), ('2.0', True), ('2e0', True), ('true', False), ('"2"', False), ('2.5', False), ('null', False)],
)
def test_integer_version_uses_json_numeric_value(version_token: str, accepted: bool) -> None:
    envelope = json.loads(
        '{"__tywrap__":"integer","codecVersion":'
        + version_token
        + ',"encoding":"decimal","value":"7"}'
    )
    if accepted:
        assert prototype.decode_exact_integers(envelope, INTEGER) == 7
    else:
        with pytest.raises(prototype.PrototypeError):
            prototype.decode_exact_integers(envelope, INTEGER)


def test_integer_envelope_and_capability_fail_closed() -> None:
    encoded = prototype.encode_exact_integers(2**80)
    for change in (
        {'codecVersion': 1},
        {'encoding': 'json'},
        {'unexpected': True},
    ):
        with pytest.raises(prototype.PrototypeError, match='invalid integer envelope'):
            prototype.decode_exact_integers({**encoded, **change}, INTEGER)
    with pytest.raises(prototype.PrototypeError, match='untagged integer at args'):
        prototype.decode_exact_integers(42, INTEGER)
    with pytest.raises(prototype.PrototypeError, match='reserved record key at result.__tywrap__'):
        prototype.encode_exact_integers({'__tywrap__': 'ordinary'})
    with pytest.raises(prototype.PrototypeError, match='bridge lacks'):
        prototype.require_capability({}, 'exactIntegerDecimalV2', 'bigint-v2')
    with pytest.raises(prototype.PrototypeError, match='unsupported per-call'):
        prototype.require_capability(
            {'valueCapabilities': ['exactIntegerDecimalV2']},
            'exactIntegerDecimalV2',
            'fields-v2',
        )


def test_float_contract_recovers_integer_json_tokens_without_weakening_integer() -> None:
    assert prototype.decode_exact_integers(1, {'kind': 'float'}) == 1.0
    assert type(prototype.decode_exact_integers(1, {'kind': 'float'})) is float
    assert prototype.decode_exact_integers(1.5, {'kind': 'float'}) == 1.5
    zero = prototype.decode_exact_integers(
        {'__tywrap__': 'float', 'codecVersion': 2, 'encoding': 'negative-zero'},
        {'kind': 'float'},
    )
    assert math.copysign(1, zero) == -1
    with pytest.raises(prototype.PrototypeError, match='untagged integer'):
        prototype.decode_exact_integers(1, INTEGER)
    with pytest.raises(
        prototype.PrototypeError,
        match=r'untagged integer at args\.mixed\[0\]\.quantity',
    ):
        prototype.decode_exact_integers(
            {'mixed': [{'quantity': 1, 'ratio': 2, 'flag': True}]},
            {
                'kind': 'record',
                'fields': {
                    'mixed': {
                        'kind': 'array',
                        'item': {
                            'kind': 'record',
                            'fields': {
                                'quantity': INTEGER,
                                'ratio': {'kind': 'float'},
                                'flag': {'kind': 'boolean'},
                            },
                        },
                    },
                },
            },
        )
    with pytest.raises(prototype.PrototypeError, match='expected finite float'):
        prototype.decode_exact_integers(True, {'kind': 'float'})
    with pytest.raises(prototype.PrototypeError, match='invalid float envelope'):
        prototype.decode_exact_integers(
            {'__tywrap__': 'float', 'codecVersion': 1, 'encoding': 'negative-zero'},
            {'kind': 'float'},
        )


def test_integer_cycles_and_depth_reject_with_path() -> None:
    cycle: list[object] = []
    cycle.append(cycle)
    with pytest.raises(prototype.PrototypeError, match=r'cycle at result\[0\]'):
        prototype.encode_exact_integers(cycle)
    nested: object = 1
    for _ in range(prototype.MAX_DEPTH + 1):
        nested = [nested]
    with pytest.raises(prototype.PrototypeError, match='maximum depth'):
        prototype.encode_exact_integers(nested)


def test_dataclass_point_fields_and_identity() -> None:
    encoded = prototype.encode_dataclass(prototype.Point(1, 2), prototype.Point)
    assert encoded == {
        '__tywrap__': 'dataclass',
        'codecVersion': 2,
        'encoding': 'fields',
        'type': 'value_extensions.Point',
        'fields': {'x': 1, 'y': 2},
    }

    @dataclass
    class Record:
        name: str
        optional: int | None = None
        output: int = field(init=False, default=3)

    record = prototype.encode_dataclass(Record('a'), Record)
    assert record['fields'] == {'name': 'a', 'optional': None, 'output': 3}


def test_dataclass_nested_values_and_failures() -> None:
    @dataclass
    class Container:
        points: list[prototype.Point]

    encoded = prototype.encode_dataclass(Container([prototype.Point(1, 2)]), Container)
    assert encoded['fields']['points'][0]['fields'] == {'x': 1, 'y': 2}

    with pytest.raises(prototype.PrototypeError, match='declared dataclass type'):
        prototype.encode_dataclass(prototype.Point(1, 2), Container)

    @dataclass
    class Unsupported:
        value: object

    with pytest.raises(prototype.PrototypeError, match='unsupported value at result.value'):
        prototype.encode_dataclass(Unsupported(object()), Unsupported)

    @dataclass
    class Cyclic:
        value: object = None

    cyclic = Cyclic()
    cyclic.value = cyclic
    with pytest.raises(prototype.PrototypeError, match='cycle at result.value'):
        prototype.encode_dataclass(cyclic, Cyclic)

    with pytest.raises(prototype.PrototypeError, match='payload exceeds 60 bytes'):
        prototype.encode_dataclass(
            prototype.Point(1, 2), prototype.Point, max_payload_bytes=60
        )
