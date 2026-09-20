"""Bounded design tests. These codecs are not part of the shipped bridge."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).parent.parent / 'prototypes'))
import value_extensions as prototype  # noqa: E402


def test_nested_exact_integers_round_trip_beyond_int64() -> None:
    value = {
        'outer': [2**80 + 1, {'negative': -(2**130 + 7)}],
        'safe': 7,
        'flag': True,
    }
    encoded = prototype.encode_exact_integers(value)
    assert encoded['outer'][0]['value'] == str(2**80 + 1)
    assert encoded['safe']['value'] == '7'
    assert encoded['flag'] is True
    assert prototype.decode_exact_integers(encoded) == value


@pytest.mark.parametrize('bad', ['-0', '+1', '01', '-01', '1.0', '1e2', ' 1', '١'])
def test_integer_decimal_rejects_noncanonical_values(bad: str) -> None:
    envelope = {
        '__tywrap__': 'integer',
        'codecVersion': 2,
        'encoding': 'decimal',
        'value': bad,
    }
    with pytest.raises(prototype.PrototypeError, match='noncanonical integer decimal'):
        prototype.decode_exact_integers({'item': [envelope]})


def test_integer_digit_and_payload_caps() -> None:
    accepted = int('9' * prototype.MAX_DECIMAL_DIGITS)
    assert prototype.decode_exact_integers(
        prototype.encode_exact_integers(accepted)
    ) == accepted
    with pytest.raises(prototype.PrototypeError, match='4096 digits'):
        prototype.encode_exact_integers(int('9' * (prototype.MAX_DECIMAL_DIGITS + 1)))
    with pytest.raises(prototype.PrototypeError, match='payload exceeds 80 bytes'):
        prototype.encode_exact_integers({'text': 'x' * 80}, max_payload_bytes=80)


def test_integer_envelope_and_capability_fail_closed() -> None:
    encoded = prototype.encode_exact_integers(2**80)
    for change in (
        {'codecVersion': 1},
        {'encoding': 'json'},
        {'unexpected': True},
    ):
        with pytest.raises(prototype.PrototypeError, match='invalid integer envelope'):
            prototype.decode_exact_integers({**encoded, **change})
    with pytest.raises(prototype.PrototypeError, match='untagged integer at args'):
        prototype.decode_exact_integers(42)
    with pytest.raises(prototype.PrototypeError, match='bridge lacks'):
        prototype.require_capability({}, 'exactIntegerDecimalV2', 'bigint-v2')
    with pytest.raises(prototype.PrototypeError, match='unsupported per-call'):
        prototype.require_capability(
            {'valueCapabilities': ['exactIntegerDecimalV2']},
            'exactIntegerDecimalV2',
            'fields-v2',
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
