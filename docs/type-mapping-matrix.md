# Python → TypeScript Type Mapping Matrix

This document provides a comprehensive reference for how Python types are mapped to TypeScript types in tywrap.

## Overview

The tywrap type mapper converts Python type annotations to TypeScript types while preserving semantic meaning and type safety. The mapping prioritizes:

1. **Type Safety**: Ensuring no invalid operations are possible
2. **Semantic Equivalence**: Maintaining the meaning of the original type
3. **TypeScript Compatibility**: Using idiomatic TypeScript patterns
4. **Information Preservation**: Minimizing loss of type information

## Primitive Types

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `int` | `number` | All Python integers map to TypeScript number |
| `float` | `number` | All Python floats map to TypeScript number |
| `str` | `string` | Direct mapping |
| `bool` | `boolean` | Direct mapping |
| `bytes` | `string` | Bytes are represented as strings in JavaScript |
| `None` (value context) | `null` | Used in value positions |
| `None` (return context) | `void` | Used in return type positions |

### Context-Sensitive Mappings

The mapper uses context to determine the most appropriate TypeScript type:

```python
# Python
def func() -> None:  # Maps to: () => void
    pass

x: Optional[None]    # Maps to: null | null (simplified to null)
```

## Collection Types

### Arrays and Lists

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `list[T]` | `Array<T>` | `list[int]` → `Array<number>` |
| `List[T]` | `Array<T>` | `List[str]` → `Array<string>` |
| `Sequence[T]` | `Array<T>` | `Sequence[bool]` → `Array<boolean>` |

### Tuples

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `tuple[T1, T2, ...]` | `[T1, T2, ...]` | `tuple[int, str]` → `[number, string]` |
| `tuple[()]` | `[undefined]` | Empty tuple becomes single undefined element |
| `Tuple[T, ...]` | `Array<T>` | Variable-length tuple becomes array |

### Sets

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `set[T]` | `Set<T>` | `set[str]` → `Set<string>` |
| `frozenset[T]` | `Set<T>` | `frozenset[int]` → `Set<number>` |
| `Set[T]` | `Set<T>` | `Set[bool]` → `Set<boolean>` |

### Dictionaries and Mappings

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `dict[K, V]` | `{ [key: K]: V }` | `dict[str, int]` → `{ [key: string]: number }` |
| `Dict[K, V]` | `{ [key: K]: V }` | `Dict[str, Any]` → `{ [key: string]: unknown }` |
| `Mapping[K, V]` | `{ [key: K]: V }` | Read-only mapping concept preserved |

#### Index Signature Key Types

TypeScript only supports `string`, `number`, and `symbol` as index signature keys:

| Python Key Type | TypeScript Key Type | Reason |
|-----------------|--------------------|---------| 
| `str` | `string` | Direct mapping |
| `int` | `number` | Direct mapping |
| `bool` | `string` | Fallback (bool not valid TS index key) |
| `Any` | `string` | Fallback to string |

## Union and Optional Types

### Union Types

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `Union[T1, T2, ...]` | `T1 \| T2 \| ...` | `Union[int, str]` → `number \| string` |
| `T1 \| T2` (Python 3.10+) | `T1 \| T2` | `int \| str` → `number \| string` |

### Optional Types

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `Optional[T]` | `T \| null` | `Optional[str]` → `string \| null` |
| `T \| None` | `T \| null` | `int \| None` → `number \| null` |

### Literal Types

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `Literal["a", "b"]` | `"a" \| "b"` | String literal union |
| `Literal[1, 2, 3]` | `1 \| 2 \| 3` | Numeric literal union |
| `Literal[True, False]` | `true \| false` | Boolean literal union |

## Generic Types

### Basic Generics

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `Generic[T]` | `Generic<T>` | Type parameter preserved |
| `List[T]` | `Array<T>` | Generic collections |
| `Dict[K, V]` | `{ [key: K]: V }` | Generic mappings |

### Type Variables

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `TypeVar('T')` | `T` | Preserved as generic parameter |
| `TypeVar('T', bound=Base)` | `T` | Bounds information not directly expressible |
| `TypeVar('T', str, int)` | `T` | Constraints not directly expressible |

### Advanced Generic Types

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `ParamSpec('P')` | `P` | Preserved for function signatures |
| `TypeVarTuple('Ts')` | `Ts` | Preserved for variadic generics |
| `Unpack[Ts]` | `Unpack<Ts>` | Preserved as custom type |

## Callable Types

### Function Signatures

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `Callable[[T1, T2], R]` | `(arg0: T1, arg1: T2) => R` | Specific parameters |
| `Callable[..., R]` | `(...args: unknown[]) => R` | Variable arguments |
| `Callable` | `(...args: unknown[]) => unknown` | Unspecified signature |

### Async Functions

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `Awaitable[T]` | `Promise<T>` | Async return type |
| `Coroutine[Any, Any, T]` | `Promise<T>` | Coroutine simplified to Promise |

## Special Types

### Top and Bottom Types

| Python Type | TypeScript Type | Context |
|-------------|----------------|---------|
| `Any` | `unknown` | Safe unknown type |
| `Never` | `never` | Bottom type |
| `NoReturn` | `never` | Functions that never return |
| `object` | `object` | Base object type |

### String Types

| Python Type | TypeScript Type | Example |
|-------------|----------------|---------|
| `LiteralString` | `string` | Any literal string |
| `AnyStr` | `string` | Simplified to string |

### Forward References and Self Types

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `'ClassName'` | `ClassName` | Forward reference preserved |
| `Self` | `Self` | Preserved as custom type |

## Preset Mappings (Opt-in)

Enable presets via `types.presets` in your config to opt into additional mappings.

### stdlib preset

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `datetime.datetime` | `string` | ISO 8601 string |
| `datetime.date` | `string` | ISO 8601 string |
| `datetime.time` | `string` | ISO 8601 string |
| `datetime.timedelta` | `number` | Total seconds |
| `decimal.Decimal` | `string` | String to preserve precision |
| `uuid.UUID` | `string` | UUID string |
| `pathlib.Path` | `string` | Filesystem path |

### pandas preset

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `pandas.DataFrame` | `Record<string, unknown> \| Record<string, unknown>[]` | Arrow or JSON fallback |
| `pandas.Series` | `unknown[] \| Record<string, unknown>` | List or object fallback |

### scipy preset

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `scipy.sparse.csr_matrix` | `{ format: "csr", shape: number[], data: unknown[], indices: number[], indptr: number[] }` | JSON sparse envelope |
| `scipy.sparse.csc_matrix` | `{ format: "csc", shape: number[], data: unknown[], indices: number[], indptr: number[] }` | JSON sparse envelope |
| `scipy.sparse.coo_matrix` | `{ format: "coo", shape: number[], data: unknown[], row: number[], col: number[] }` | JSON sparse envelope |
| `scipy.sparse.spmatrix` | union of csr/csc/coo shapes | Base sparse type |

### torch preset

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `torch.Tensor` | Nested ndarray envelope with tensor metadata | See structure below |

Torch tensors are wrapped in a special envelope containing an ndarray:
```typescript
{
  __tywrap__: 'torch.tensor',
  encoding: 'ndarray',
  value: {
    __tywrap__: 'ndarray',
    encoding: 'json' | 'arrow',
    value: number[] | Uint8Array,
    shape: number[],
    dtype: string
  },
  device: string  // e.g., 'cpu'
}
```

### pydantic preset

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `pydantic.BaseModel` | Serialized dict | Via `model_dump(by_alias=True, mode='json')` |
| Fields with aliases | Uses alias name | `by_alias=True` default |

Pydantic v2 models are serialized using `model_dump()` with `by_alias=True` and `mode='json'`
to ensure JSON-safe output. Nested models are recursively serialized.

### sklearn preset

| Python Type | TypeScript Type | Notes |
|-------------|----------------|-------|
| `sklearn.base.BaseEstimator` | `{ className: string, module: string, version?: string, params: Record<string, unknown> }` | Estimator metadata |

## Complex Nested Types

### Real-World Examples

#### JSON Type
```python
# Python
JSON = Union[None, bool, int, float, str, List['JSON'], Dict[str, 'JSON']]

# TypeScript
type JSON = null | boolean | number | string | Array<JSON> | { [key: string]: JSON }
```

#### Tree Structure
```python
# Python  
class TreeNode:
    value: int
    children: List['TreeNode']

# TypeScript
interface TreeNode {
    value: number;
    children: Array<TreeNode>;
}
```

#### Generic Repository Pattern
```python
# Python
T = TypeVar('T')
class Repository(Generic[T]):
    def find_by_id(self, id: int) -> Optional[T]: ...
    def save(self, entity: T) -> T: ...

# TypeScript  
interface Repository<T> {
    findById(id: number): T | null;
    save(entity: T): T;
}
```

## Annotated Types

The `Annotated` type from Python's `typing` module is handled specially:

| Python Type | TypeScript Type | Behavior |
|-------------|----------------|----------|
| `Annotated[T, ...]` | `T` | Metadata stripped, base type preserved |
| `Annotated[str, Field(...)]` | `string` | Pydantic Field info ignored |
| `Annotated[int, "doc"]` | `number` | Documentation metadata ignored |

## Type Mapping Limitations

### Lossy Conversions

Some Python type information cannot be perfectly preserved in TypeScript:

1. **Numeric Precision**: `int` vs `float` both become `number`
2. **Type Variable Bounds**: `TypeVar('T', bound=BaseClass)` loses bound info
3. **Callable Details**: Complex `ParamSpec` usage may be simplified
4. **Protocol Details**: Structural type details may be lost

### Unsupported Types

Types that map to custom types but may need manual implementation:

- `Protocol` with complex structural requirements
- Advanced `Generic` with complex variance rules
- `Final` type qualifier (no TypeScript equivalent)
- `ClassVar` (becomes regular property)

## Best Practices

### For Python Developers

1. **Use Explicit Types**: Avoid relying on inference where possible
2. **Prefer Simple Unions**: Complex union hierarchies can be confusing
3. **Document Constraints**: Use docstrings for type constraints not expressible in TypeScript

### For TypeScript Consumers

1. **Trust the Types**: Generated types are designed to be sound
2. **Handle Nulls**: Python `Optional` becomes `T | null`, not `T | undefined`
3. **Understand Number Mapping**: All Python numbers become TypeScript `number`

## Validation and Testing

The type mapping is validated through:

1. **Unit Tests**: Direct mapping verification
2. **Property-Based Tests**: Invariant checking with random inputs  
3. **Integration Tests**: End-to-end type preservation
4. **Edge Case Tests**: Recursive types, forward references, complex nesting

## Future Enhancements

Planned improvements to the type mapping system:

1. **Better Generic Bounds**: Preserve more type variable constraint information
2. **Protocol Mapping**: Better structural type support
3. **Performance Types**: Map performance-related annotations
4. **Custom Type Plugins**: Allow user-defined mapping rules

---

*Last updated: January 2026.*
