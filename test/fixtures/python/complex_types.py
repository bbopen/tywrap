"""Module with complex type annotations for testing nested type parsing."""

from typing import (
    List,
    Dict,
    Tuple,
    Optional,
    Union,
    Callable,
    TypeVar,
    Generic,
    Set,
    FrozenSet,
)


T = TypeVar("T")
K = TypeVar("K")
V = TypeVar("V")


def nested_dict() -> Dict[str, List[Tuple[int, str, float]]]:
    """Return a deeply nested dict structure."""
    return {"data": [(1, "one", 1.0), (2, "two", 2.0)]}


def union_type(value: Union[int, str, None]) -> str:
    """Handle union type parameter."""
    if value is None:
        return "none"
    return str(value)


def callback_param(
    func: Callable[[int, str], bool], data: List[Tuple[int, str]]
) -> List[bool]:
    """Apply callback to list of tuples."""
    return [func(x, y) for x, y in data]


def optional_dict(
    key: str,
) -> Optional[Dict[str, Optional[List[int]]]]:
    """Return optional nested structure."""
    return {key: [1, 2, 3]}


def frozenset_param(items: FrozenSet[Tuple[str, int]]) -> Set[str]:
    """Extract strings from frozenset of tuples."""
    return {item[0] for item in items}


class Container(Generic[T]):
    """Generic container class."""

    def __init__(self, value: T) -> None:
        self._value: T = value

    def get(self) -> T:
        """Get the contained value."""
        return self._value

    def set(self, value: T) -> None:
        """Set the contained value."""
        self._value = value

    def map(self, func: Callable[[T], T]) -> "Container[T]":
        """Apply function to value."""
        return Container(func(self._value))


class KeyValueStore(Generic[K, V]):
    """Generic key-value store."""

    def __init__(self) -> None:
        self._data: Dict[K, V] = {}

    def put(self, key: K, value: V) -> None:
        """Store a value."""
        self._data[key] = value

    def get(self, key: K) -> Optional[V]:
        """Retrieve a value."""
        return self._data.get(key)

    def keys(self) -> List[K]:
        """Get all keys."""
        return list(self._data.keys())

    def values(self) -> List[V]:
        """Get all values."""
        return list(self._data.values())

    def items(self) -> List[Tuple[K, V]]:
        """Get all key-value pairs."""
        return list(self._data.items())
