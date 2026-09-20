"""Overloads with positional-only and keyword-only parameters."""

from typing import overload as _overload


@_overload
def choose(value: str, /, bias: int = 0, *, loud: bool = False) -> str: ...


@_overload
def choose(value: int, /, bias: int = 0, *, loud: bool = False) -> int: ...


def choose(value: str | int, /, bias: int = 0, *, loud: bool = False) -> str | int:
    if isinstance(value, str):
        result = value + "!" * bias
        return result.upper() if loud else result
    return value + bias
