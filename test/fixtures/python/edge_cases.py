"""
Edge cases test fixture for IR extraction issues.
"""

from __future__ import annotations
from typing import TypeVar, Generic, Union, Optional, Literal, Final
import sys

# Python 3.10+ union syntax
if sys.version_info >= (3, 10):
    def modern_union_func(x: str | int) -> str | None:
        return str(x) if x else None
    
    def optional_modern(x: str | None = None) -> int | None:
        return len(x) if x else None

# Forward references
def self_referencing_func(node: TreeNode) -> TreeNode:
    return node

class TreeNode:
    def __init__(self, value: int) -> None:
        self.value = value
        self.children: list[TreeNode] = []  # Self-reference
    
    def add_child(self, child: TreeNode) -> None:
        self.children.append(child)

# Nested generic types
def complex_nested_type(
    data: dict[str, list[tuple[int, str]]]
) -> list[dict[str, Optional[int]]]:
    result = []
    for key, items in data.items():
        for num, text in items:
            result.append({key: num if num > 0 else None})
    return result

# Literal types
Status = Literal["active", "inactive", "pending"]

def process_status(status: Status) -> str:
    return f"Processing {status}"

# Final variables
MAX_ITEMS: Final[int] = 100

def get_max() -> int:
    return MAX_ITEMS

# TypeVar with bounds
T = TypeVar('T', bound='Comparable')

class Comparable:
    def __lt__(self, other: Comparable) -> bool:
        return False

def sort_items(items: list[T]) -> list[T]:
    return sorted(items)

# Callable with complex signature
from typing import Callable

def higher_order_func(
    callback: Callable[[int, str], Union[int, str]],
    x: int,
    y: str
) -> Union[int, str]:
    return callback(x, y)

# Overloaded functions
from typing import overload

@overload
def process_value(x: int) -> str: ...

@overload  
def process_value(x: str) -> int: ...

def process_value(x: Union[int, str]) -> Union[str, int]:
    if isinstance(x, int):
        return str(x)
    return len(x)

# Generic class with multiple constraints
K = TypeVar('K', str, int)
V = TypeVar('V')

class TypedDict(Generic[K, V]):
    def __init__(self) -> None:
        self._data: dict[K, V] = {}
    
    def get(self, key: K) -> Optional[V]:
        return self._data.get(key)
    
    def set(self, key: K, value: V) -> None:
        self._data[key] = value

# Test module constants
__all__ = [
    'TreeNode', 'complex_nested_type', 'process_status', 'get_max',
    'sort_items', 'higher_order_func', 'process_value', 'TypedDict',
    'Status', 'MAX_ITEMS'
]