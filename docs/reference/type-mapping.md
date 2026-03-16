# Python to TypeScript Type Mapping

This page describes the TypeScript shapes tywrap generates and returns today.

## Core Annotation Mapping

### Primitives

| Python                    | TypeScript |
| ------------------------- | ---------- |
| `int`                     | `number`   |
| `float`                   | `number`   |
| `str`                     | `string`   |
| `bool`                    | `boolean`  |
| `bytes`                   | `string`   |
| `None` in value position  | `null`     |
| `None` in return position | `void`     |

### Collections

| Python                     | TypeScript        | Notes                                        |
| -------------------------- | ----------------- | -------------------------------------------- |
| `list[T]`, `List[T]`       | `Array<T>`        |                                              |
| `Sequence[T]`              | `Array<T>`        | Normalized to a list-like shape              |
| `tuple[T1, T2]`            | `[T1, T2]`        | Exact tuple shape                            |
| `Tuple[T, ...]`            | `Array<T>`        | Variable-length tuple                        |
| `tuple[()]`                | `[undefined]`     | Empty tuple representation                   |
| `set[T]`, `frozenset[T]`   | `Set<T>`          |                                              |
| `dict[K, V]`, `Dict[K, V]` | `{ [key: K]: V }` | Index keys fall back to `string` when needed |
| `Mapping[K, V]`            | `{ [key: K]: V }` | Normalized to a dict-like shape              |

### Unions and Literals

| Python                 | TypeScript      |
| ---------------------- | --------------- |
| `Union[A, B]`          | `A \| B`        |
| `A \| B`               | `A \| B`        |
| `Optional[T]`          | `T \| null`     |
| `T \| None`            | `T \| null`     |
| `Literal["a", "b"]`    | `"a" \| "b"`    |
| `Literal[1, 2]`        | `1 \| 2`        |
| `Literal[True, False]` | `true \| false` |

### Callables and Wrappers

| Python                          | TypeScript                  | Notes                                       |
| ------------------------------- | --------------------------- | ------------------------------------------- |
| `Callable[[A, B], R]`           | `(arg0: A, arg1: B) => R`   |                                             |
| `Callable[..., R]`              | `(...args: unknown[]) => R` |                                             |
| `Annotated[T, ...]`             | `T`                         | Metadata is stripped for the generated type |
| `ClassVar[T]`                   | `T`                         |                                             |
| `Final[T]`                      | `T`                         |                                             |
| `Required[T]`, `NotRequired[T]` | `T`                         |                                             |

### Special Names

| Python                    | TypeScript         |
| ------------------------- | ------------------ |
| `Any`                     | `unknown`          |
| `Never`, `NoReturn`       | `never`            |
| `LiteralString`, `AnyStr` | `string`           |
| `object`                  | `object`           |
| `Awaitable`               | `Promise<unknown>` |
| `Coroutine`               | `Promise<unknown>` |
| `TypeVar('T')`            | `unknown`          |
| `ParamSpec('P')`          | `unknown`          |
| `TypeVarTuple('Ts')`      | `unknown`          |
| `Unpack[Ts]`              | `unknown`          |

## Preset Mappings

Enable presets with `types.presets` in your config.

### `stdlib`

| Python                                                | TypeScript |
| ----------------------------------------------------- | ---------- |
| `datetime.datetime`, `datetime.date`, `datetime.time` | `string`   |
| `datetime.timedelta`                                  | `number`   |
| `decimal.Decimal`                                     | `string`   |
| `uuid.UUID`                                           | `string`   |
| `pathlib.Path` and related path types                 | `string`   |

### `pandas`

These are the decoded JavaScript shapes that tywrap exposes to TypeScript.

| Python             | TypeScript                                                  |
| ------------------ | ----------------------------------------------------------- |
| `pandas.DataFrame` | `Record<string, unknown> \| Array<Record<string, unknown>>` |
| `pandas.Series`    | `unknown[] \| Record<string, unknown>`                      |

### `pydantic`

| Python               | TypeScript                | Notes                                                                              |
| -------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `pydantic.BaseModel` | `Record<string, unknown>` | Runtime serialization uses `model_dump(by_alias=True, mode='json')` when available |

### `scipy`

```ts
type SparseMatrix =
  | {
      format: 'csr' | 'csc';
      shape: number[];
      data: unknown[];
      indices: number[];
      indptr: number[];
      dtype?: string;
    }
  | {
      format: 'coo';
      shape: number[];
      data: unknown[];
      row: number[];
      col: number[];
      dtype?: string;
    };
```

### `torch`

```ts
interface TorchTensor {
  data: unknown;
  shape: number[];
  dtype?: string;
  device?: string;
}
```

### `sklearn`

```ts
interface SklearnEstimator {
  className: string;
  module: string;
  version?: string;
  params: Record<string, unknown>;
}
```

## Limits and Fallbacks

- tywrap does not preserve Python numeric distinctions beyond `number`.
- Complex user-defined generics that are not explicitly normalized stay as
  custom TypeScript names.
- Python typing placeholders such as `TypeVar`, `ParamSpec`, `TypeVarTuple`,
  and `Unpack` are lowered to `unknown`-based shapes because generated wrappers
  do not currently emit matching TypeScript generic parameters.
- `Annotated[...]` metadata is not reflected in the generated type.
- Runtime serialization can still shape values more narrowly than the static
  annotation alone. `torch.Tensor` and `sklearn` values are examples of this.

## Example

```python
from typing import Literal, Optional, Sequence

def summarize(values: Sequence[int], mode: Literal["min", "max"]) -> Optional[int]:
    ...
```

Generates a TypeScript signature shaped like:

```ts
export async function summarize(
  values: Array<number>,
  mode: 'min' | 'max'
): Promise<number | null>;
```
