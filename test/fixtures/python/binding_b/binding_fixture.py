"""Second Python environment for explicit client binding tests."""

from __future__ import annotations

from typing import TypeVar, overload


T = TypeVar("T")


def environment() -> str:
    return "B"


def create_client() -> str:
    return "B-client"


def dispose() -> str:
    return "B-dispose"


def identity(value: T) -> T:
    return value


@overload
def select(value: int) -> int: ...


@overload
def select(value: str) -> str: ...


def select(value: int | str) -> int | str:
    return value


def scale(value: int, factor: int = 1) -> int:
    return value * factor


def kw_only(*, label: str) -> str:
    return f"B:{label}"


def echo_bytes(value: bytes) -> bytes:
    return value


def invalid_return() -> int:
    return "wrong"  # type: ignore[return-value]


def fail() -> str:
    raise RuntimeError("B-failure")


class Client:
    @classmethod
    def label(cls, value: str) -> str:
        return f"B:{value}"
