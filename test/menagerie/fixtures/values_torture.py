"""Plain-value fixtures that exercise the Node bridge's serialization edge cases."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, localcontext as _localcontext
from enum import Enum
from pathlib import Path
from uuid import UUID


class TrafficLight(Enum):
    """Signal colors."""

    RED = "red"
    GREEN = "green"


@dataclass
class Point:
    x: int
    y: int


def echo_int(value: int) -> int:
    return value


def integer_boundaries() -> list[int]:
    return [2**53 - 1, 2**53, 2**53 + 1, 2**63, -(2**63), math.factorial(30)]


def integer_safe_max() -> int:
    return 2**53 - 1


def integer_first_unsafe() -> int:
    return 2**53


def integer_first_rounded() -> int:
    return 2**53 + 1


def integer_int64_max() -> int:
    return 2**63 - 1


def integer_int64_min() -> int:
    return -(2**63)


def integer_factorial_30() -> int:
    return math.factorial(30)


def bools_and_ints() -> list[bool | int]:
    return [True, False, 0, 1]


def finite_float_edges() -> list[float]:
    return [-0.0, 5e-324]


def special_floats(include: bool = False) -> list[float]:
    return [math.inf, -math.inf, math.nan] if include else []


def unicode_text() -> str:
    return "emoji: 🐍; CJK: 漢字; NUL: \x00"


def lone_surrogate() -> str:
    return b"\xed\xa0\x80".decode("utf-8", errors="surrogatepass")


def megabyte_text() -> str:
    return "m" * (1024 * 1024)


def empty_values() -> tuple[tuple[()], list[object], dict[str, object], set[object]]:
    return (), [], {}, set()


def deeply_nested() -> list[object]:
    value: object = "leaf"
    for _ in range(100):
        value = [value]
    return value  # type: ignore[return-value]


def temporal_values() -> dict[str, object]:
    return {
        "datetime_naive": datetime(2024, 1, 2, 3, 4, 5),
        "datetime_utc": datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
        "date": date(2024, 1, 2),
        "time": time(3, 4, 5),
        "timedelta": timedelta(days=2, seconds=3),
    }


def decimal_values() -> list[Decimal]:
    with _localcontext() as context:
        context.prec = 3
        rounded = Decimal("0.1") + Decimal("0.2")
    return [Decimal("0.1"), rounded]


def uuid_and_path() -> dict[str, object]:
    return {
        "uuid": UUID("12345678-1234-5678-1234-567812345678"),
        "path": Path("fixtures/example.txt"),
    }


def enum_member() -> TrafficLight:
    return TrafficLight.GREEN


def dataclass_instance() -> Point:
    return Point(1, 2)


def complex_value() -> complex:
    return complex(1, 2)


async def coroutine_value() -> str:
    return "coroutine-result"


def generator_value() -> object:
    return (number for number in (1, 2, 3))


def int_key_dict() -> dict[int, str]:
    return {1: "one", 2: "two"}


def tuple_key_dict() -> dict[tuple[int, int], str]:
    return {(1, 2): "pair"}


def set_and_frozenset() -> tuple[set[int], frozenset[str]]:
    return {1, 2}, frozenset({"a", "b"})


def bytes_echo(value: bytes) -> bytes:
    return value
