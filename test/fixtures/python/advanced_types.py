"""
Advanced typing constructs test fixture for Python IR extraction.
Tests Python 3.9-3.12 typing features and complex type annotations.
"""

from __future__ import annotations
import sys
from typing import (
    Any, Dict, List, Set, Tuple, Optional, Union, Callable, Generic, TypeVar, 
    ClassVar, overload
)

try:
    from typing import Protocol, runtime_checkable, Final, Literal, Annotated
except ImportError:
    # Fallbacks for older Python versions
    class Protocol: pass  # type: ignore
    def runtime_checkable(cls): return cls  # type: ignore
    def Final(x): return x  # type: ignore
    def Literal(*args): return str  # type: ignore
    def Annotated(tp, *args): return tp  # type: ignore

try:
    from typing import TypedDict, NotRequired, Required
except ImportError:
    # Fallbacks for older Python versions
    class TypedDict: pass  # type: ignore
    def NotRequired(x): return x  # type: ignore
    def Required(x): return x  # type: ignore

try:
    from typing import TypeAlias
except ImportError:
    def TypeAlias(x): return x  # type: ignore
try:
    from typing_extensions import ParamSpec, TypeVarTuple, Unpack
except ImportError:
    # Fallbacks for systems without typing_extensions
    try:
        from typing import ParamSpec, TypeVarTuple, Unpack  # Python 3.10+
    except ImportError:
        # Create minimal fallbacks
        ParamSpec = TypeVar  # type: ignore
        class TypeVarTuple:  # type: ignore
            def __init__(self, name): pass
        def Unpack(x): return x  # type: ignore
from dataclasses import dataclass, field
from abc import abstractmethod
import asyncio
from collections.abc import Sequence, Mapping, Iterable, AsyncIterator
from pathlib import Path
from enum import Enum, IntEnum


# Type Variables and Generics
T = TypeVar('T')
U = TypeVar('U', bound='Comparable')
P = ParamSpec('P')
Ts = TypeVarTuple('Ts')
NumberType = TypeVar('NumberType', int, float)

# Type Aliases (Python 3.10+)
if sys.version_info >= (3, 10):
    Vector = List[float]
    Matrix = List[List[float]]
else:
    Vector = "List[float]"
    Matrix = "List[List[float]]"

# Modern Union syntax (Python 3.10+)
if sys.version_info >= (3, 10):
    StringOrInt = str | int
    OptionalString = str | None
else:
    StringOrInt = Union[str, int]
    OptionalString = Optional[str]

# Literals and Final
API_VERSION: Final = "v1"
Status = Literal["pending", "completed", "failed"]

# Enums
class Color(Enum):
    RED = "red"
    GREEN = "green"
    BLUE = "blue"

class Priority(IntEnum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3


# Protocols
@runtime_checkable
class Comparable(Protocol):
    def __lt__(self, other: Any) -> bool: ...
    def __le__(self, other: Any) -> bool: ...

class Drawable(Protocol):
    def draw(self) -> None: ...
    @property
    def area(self) -> float: ...

class AsyncReadable(Protocol):
    async def read(self, size: int = -1) -> bytes: ...


# TypedDict with Required/NotRequired
class PersonDict(TypedDict):
    name: str
    age: int
    email: NotRequired[str]
    phone: NotRequired[str]

class ConfigDict(TypedDict, total=False):
    host: Required[str]
    port: Required[int]
    debug: bool
    timeout: float


# Complex Generics
class Container(Generic[T]):
    def __init__(self, value: T) -> None:
        self.value = value
    
    def get(self) -> T:
        return self.value
    
    def set(self, value: T) -> None:
        self.value = value

class BiContainer(Generic[T, U]):
    def __init__(self, first: T, second: U) -> None:
        self.first = first
        self.second = second
    
    def get_first(self) -> T:
        return self.first
    
    def get_second(self) -> U:
        return self.second

# Variadic Generics (Python 3.11+)
if sys.version_info >= (3, 11):
    class Array(Generic[Unpack[Ts]]):
        def __init__(self, *args: Unpack[Ts]) -> None:
            self.items = args


# Dataclasses
@dataclass
class Point:
    x: float
    y: float
    z: float = 0.0
    
    def distance_to(self, other: Point) -> float:
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

@dataclass
class Person:
    name: str
    age: int
    email: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def is_adult(self) -> bool:
        return self.age >= 18

@dataclass(frozen=True)
class ImmutableConfig:
    api_key: str
    endpoint: str
    timeout: float = 30.0


# Complex function signatures
def process_data(
    data: List[Dict[str, Any]],
    transform: Callable[[Dict[str, Any]], T],
    filter_func: Optional[Callable[[T], bool]] = None
) -> List[T]:
    """Process data with transformation and optional filtering."""
    transformed = [transform(item) for item in data]
    if filter_func:
        return [item for item in transformed if filter_func(item)]
    return transformed

async def async_fetch_data(
    urls: Sequence[str],
    timeout: float = 10.0,
    headers: Optional[Mapping[str, str]] = None
) -> AsyncIterator[bytes]:
    """Asynchronously fetch data from URLs."""
    for url in urls:
        # Simulate async operation
        await asyncio.sleep(0.1)
        yield b"mock_data"

def complex_callback(
    func: Callable[P, T],
    *args: P.args,
    **kwargs: P.kwargs
) -> T:
    """Execute callback with preserved signature."""
    return func(*args, **kwargs)

# Overloaded functions
@overload
def get_value(key: str) -> str: ...

@overload
def get_value(key: int) -> int: ...

def get_value(key: Union[str, int]) -> Union[str, int]:
    if isinstance(key, str):
        return f"string_{key}"
    return key * 2

# Annotated types
UserId = Annotated[int, "Unique identifier for users"]
EmailAddress = Annotated[str, "Valid email address format"]

def create_user(
    user_id: UserId,
    email: EmailAddress,
    metadata: Annotated[Dict[str, Any], "Additional user metadata"]
) -> Person:
    """Create a new user with validated types."""
    return Person(name=email.split('@')[0], age=0, email=email)


# Classes with complex inheritance
class Shape(Protocol):
    @abstractmethod
    def area(self) -> float: ...
    
    @abstractmethod
    def perimeter(self) -> float: ...

class Circle:
    def __init__(self, radius: float) -> None:
        self.radius = radius
    
    def area(self) -> float:
        return 3.14159 * self.radius ** 2
    
    def perimeter(self) -> float:
        return 2 * 3.14159 * self.radius

class Rectangle:
    def __init__(self, width: float, height: float) -> None:
        self.width = width
        self.height = height
    
    def area(self) -> float:
        return self.width * self.height
    
    def perimeter(self) -> float:
        return 2 * (self.width + self.height)


# Generic classes with bounds
class SortedContainer(Generic[T]):
    def __init__(self, items: Iterable[T]) -> None:
        self._items: List[T] = sorted(items) if hasattr(items, '__iter__') else []
    
    def add(self, item: T) -> None:
        # Insert in sorted order
        self._items.append(item)
        self._items.sort()
    
    def get_all(self) -> List[T]:
        return self._items.copy()


# Nested generic types
NestedDict = Dict[str, Dict[str, List[Tuple[int, str]]]]
ComplexCallback = Callable[[List[T]], Dict[str, Optional[T]]]

def process_nested_data(data: NestedDict) -> Dict[str, int]:
    """Process deeply nested dictionary structure."""
    result = {}
    for key, value in data.items():
        total_items = sum(len(inner_list) for inner_list in value.values())
        result[key] = total_items
    return result


# Forward references and self-referencing types
class TreeNode:
    def __init__(self, value: int, children: Optional[List[TreeNode]] = None) -> None:
        self.value = value
        self.children = children or []
    
    def add_child(self, child: TreeNode) -> None:
        self.children.append(child)
    
    def find(self, value: int) -> Optional[TreeNode]:
        if self.value == value:
            return self
        for child in self.children:
            result = child.find(value)
            if result:
                return result
        return None


# Class variables and instance variables
class DatabaseConfig:
    DEFAULT_TIMEOUT: ClassVar[float] = 30.0
    CONNECTION_POOL_SIZE: ClassVar[int] = 10
    
    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port
        self.timeout: float = self.DEFAULT_TIMEOUT
        self.active_connections: List[str] = []
    
    @classmethod
    def from_env(cls) -> DatabaseConfig:
        import os
        return cls(
            host=os.getenv('DB_HOST', 'localhost'),
            port=int(os.getenv('DB_PORT', '5432'))
        )
    
    @staticmethod
    def validate_connection_string(conn_str: str) -> bool:
        return '://' in conn_str and '@' in conn_str


# Exception handling with typing
class ValidationError(Exception):
    def __init__(self, message: str, field: str) -> None:
        super().__init__(message)
        self.field = field

def validate_person_data(data: Dict[str, Any]) -> Person:
    """Validate and create Person from dictionary data."""
    if 'name' not in data:
        raise ValidationError("Name is required", "name")
    if 'age' not in data:
        raise ValidationError("Age is required", "age")
    
    try:
        age = int(data['age'])
    except (ValueError, TypeError):
        raise ValidationError("Age must be a valid integer", "age")
    
    return Person(
        name=str(data['name']),
        age=age,
        email=data.get('email')
    )


# Context managers with typing
from contextlib import asynccontextmanager, contextmanager
from types import TracebackType

class FileManager:
    def __init__(self, filename: str, mode: str = 'r') -> None:
        self.filename = filename
        self.mode = mode
        self.file: Optional[Any] = None
    
    def __enter__(self) -> Any:
        self.file = open(self.filename, self.mode)
        return self.file
    
    def __exit__(
        self, 
        exc_type: Optional[type], 
        exc_val: Optional[Exception], 
        exc_tb: Optional[TracebackType]
    ) -> None:
        if self.file:
            self.file.close()

@contextmanager
def temp_config(config: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
    """Temporary configuration context manager."""
    original_config = config.copy()
    try:
        yield config
    finally:
        config.clear()
        config.update(original_config)

@asynccontextmanager
async def async_database_connection(url: str) -> AsyncIterator[Any]:
    """Async database connection context manager."""
    connection = None
    try:
        # Simulate async connection
        await asyncio.sleep(0.1)
        connection = f"connected_to_{url}"
        yield connection
    finally:
        if connection:
            await asyncio.sleep(0.1)  # Simulate cleanup


# Properties and descriptors
class PropertyDemo:
    def __init__(self, value: int) -> None:
        self._value = value
    
    @property
    def value(self) -> int:
        return self._value
    
    @value.setter
    def value(self, new_value: int) -> None:
        if new_value < 0:
            raise ValueError("Value must be non-negative")
        self._value = new_value
    
    @property
    def doubled(self) -> int:
        return self._value * 2
    
    @property
    def as_string(self) -> str:
        return str(self._value)


# Metaclasses
class SingletonMeta(type):
    _instances: Dict[type, Any] = {}
    
    def __call__(cls, *args: Any, **kwargs: Any) -> Any:
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class Singleton(metaclass=SingletonMeta):
    def __init__(self, name: str) -> None:
        self.name = name
    
    def get_name(self) -> str:
        return self.name


# Module-level constants and functions
DEFAULT_CONFIG: Final[Dict[str, Any]] = {
    'timeout': 30.0,
    'retries': 3,
    'debug': False
}

def module_function(
    param1: str,
    param2: Optional[int] = None,
    *args: str,
    **kwargs: Any
) -> Dict[str, Any]:
    """Module-level function with various parameter types."""
    result = {'param1': param1}
    if param2 is not None:
        result['param2'] = param2
    if args:
        result['args'] = list(args)
    if kwargs:
        result['kwargs'] = kwargs
    return result

# Export key classes and functions for testing
__all__ = [
    'Container', 'BiContainer', 'Point', 'Person', 'ImmutableConfig',
    'PersonDict', 'ConfigDict', 'Comparable', 'Drawable', 'AsyncReadable',
    'Color', 'Priority', 'TreeNode', 'DatabaseConfig', 'ValidationError',
    'FileManager', 'PropertyDemo', 'Singleton', 'process_data', 
    'async_fetch_data', 'get_value', 'create_user', 'validate_person_data',
    'module_function', 'DEFAULT_CONFIG'
]