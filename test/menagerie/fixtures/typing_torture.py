"""Typing constructs that make mapper regressions obvious in generated snapshots."""

from __future__ import annotations

from typing import (
    Annotated,
    Callable,
    Generic,
    Generator,
    Iterator,
    Literal,
    NewType,
    Optional,
    ParamSpec,
    Protocol,
    TypeVar,
    TypedDict as _TypedDict,
    overload as _overload,
)

T = TypeVar("T")
P = ParamSpec("P")
UserId = NewType("UserId", int)


class Movie(_TypedDict):
    title: str
    year: int


class RatedMovie(Movie, total=False):
    rating: float


class SupportsClose(Protocol):
    def close(self) -> None: ...


class Box(Generic[T]):
    def __init__(self, value: T):
        self.value = value


def literal_echo(value: Literal["red", "blue", 7]) -> Literal["red", "blue", 7]:
    return value


def typed_dict_echo(value: Movie) -> Movie:
    return value


def rated_movie() -> RatedMovie:
    return {"title": "Arrival", "year": 2016}


def protocol_identity(value: SupportsClose) -> SupportsClose:
    return value


def generic_identity(value: T) -> T:
    return value


def paramspec_apply(callback: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    return callback(*args, **kwargs)


@_overload
def overloaded(value: int) -> int: ...


@_overload
def overloaded(value: str) -> str: ...


def overloaded(value: int | str) -> int | str:
    return value


async def async_text() -> str:
    return "awaited"


def iterator_values() -> Iterator[int]:
    yield from (1, 2, 3)


def generator_values() -> Generator[int, None, None]:
    yield from (4, 5, 6)


def user_id_echo(value: UserId) -> UserId:
    return value


def annotated_echo(value: Annotated[int, "user-facing identifier"]) -> Annotated[int, "user-facing identifier"]:
    return value


def optional_union(value: Optional[str | int]) -> str | int | None:
    return value


def nested_containers(value: list[dict[str, list[tuple[int, str]]]]) -> list[dict[str, list[tuple[int, str]]]]:
    return value


def variadic_tuple(value: tuple[int, ...]) -> tuple[int, ...]:
    return value


def int_key_dict(value: dict[int, str]) -> dict[int, str]:
    return value


def tuple_key_dict(value: dict[tuple[int, int], str]) -> dict[tuple[int, int], str]:
    return value


def set_values(value: set[int]) -> set[int]:
    return value


def frozen_values(value: frozenset[str]) -> frozenset[str]:
    return value


def bytes_echo(value: bytes) -> bytes:
    return value


def none_return() -> None:
    return None
