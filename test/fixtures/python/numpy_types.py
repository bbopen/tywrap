"""
NumPy type annotations test fixture.
Tests array types, dtypes, and numpy-specific patterns.
"""

from __future__ import annotations
import numpy as np
from typing import Union, Optional, Tuple, List, Any, Protocol, TypeVar
from numpy.typing import NDArray, ArrayLike, DTypeLike


# Type variables for numpy
DType = TypeVar('DType', bound=np.generic)
ShapeType = Tuple[int, ...]

# Common array types
Float32Array = NDArray[np.float32]
Float64Array = NDArray[np.float64]
IntArray = NDArray[np.int_]
BoolArray = NDArray[np.bool_]
AnyArray = NDArray[Any]

# Shape-specific arrays (conceptual - numpy doesn't enforce shape at type level)
Vector = NDArray[np.float64]  # 1D array
Matrix = NDArray[np.float64]  # 2D array
Tensor3D = NDArray[np.float64]  # 3D array


class ArrayProtocol(Protocol):
    """Protocol for array-like objects."""
    shape: Tuple[int, ...]
    dtype: np.dtype[Any]
    
    def __array__(self) -> NDArray[Any]: ...


def create_array(
    data: ArrayLike,
    dtype: Optional[DTypeLike] = None,
    copy: bool = True
) -> NDArray[Any]:
    """Create numpy array from array-like data."""
    return np.array(data, dtype=dtype, copy=copy)


def array_operations(
    a: Float64Array,
    b: Float64Array
) -> Tuple[Float64Array, Float64Array, Float64Array]:
    """Basic array operations."""
    return a + b, a * b, np.dot(a, b)


def statistical_functions(
    arr: NDArray[np.number[Any]]
) -> Tuple[float, float, float, float]:
    """Statistical operations on numeric arrays."""
    return (
        float(np.mean(arr)),
        float(np.std(arr)),
        float(np.min(arr)),
        float(np.max(arr))
    )


def linear_algebra_ops(
    matrix_a: NDArray[np.floating[Any]],
    matrix_b: NDArray[np.floating[Any]],
    vector: NDArray[np.floating[Any]]
) -> Tuple[NDArray[np.floating[Any]], NDArray[np.floating[Any]], float]:
    """Linear algebra operations."""
    matrix_mult = np.matmul(matrix_a, matrix_b)
    matrix_vector = np.dot(matrix_a, vector)
    determinant = float(np.linalg.det(matrix_a))
    return matrix_mult, matrix_vector, determinant


def array_slicing_operations(
    arr: NDArray[np.number[Any]]
) -> Tuple[NDArray[np.number[Any]], NDArray[np.number[Any]], NDArray[np.bool_]]:
    """Array slicing and indexing operations."""
    slice_result = arr[1:-1]
    fancy_index = arr[[0, 2, 4]]
    boolean_mask = arr > 0
    return slice_result, fancy_index, boolean_mask


def dtype_conversions(
    int_array: NDArray[np.integer[Any]],
    float_array: NDArray[np.floating[Any]]
) -> Tuple[NDArray[np.floating[Any]], NDArray[np.integer[Any]]]:
    """Data type conversion operations."""
    int_to_float = int_array.astype(np.float64)
    float_to_int = float_array.astype(np.int32)
    return int_to_float, float_to_int


def broadcasting_operations(
    scalar: Union[int, float],
    vector: Vector,
    matrix: Matrix
) -> Tuple[Vector, Matrix, Matrix]:
    """Broadcasting operations with different shapes."""
    scalar_vector = vector + scalar
    scalar_matrix = matrix + scalar
    vector_matrix = matrix + vector.reshape(-1, 1)
    return scalar_vector, scalar_matrix, vector_matrix


class NumPyContainer:
    """Container class with numpy arrays."""
    
    def __init__(
        self,
        data: ArrayLike,
        weights: Optional[ArrayLike] = None
    ) -> None:
        self.data: NDArray[Any] = np.asarray(data)
        self.weights: Optional[NDArray[Any]] = np.asarray(weights) if weights is not None else None
        self.shape: Tuple[int, ...] = self.data.shape
        self.size: int = self.data.size
    
    def get_weighted_sum(self) -> Union[float, NDArray[Any]]:
        """Calculate weighted sum of data."""
        if self.weights is not None:
            return np.sum(self.data * self.weights)
        return np.sum(self.data)
    
    def reshape(self, new_shape: ShapeType) -> NumPyContainer:
        """Reshape the container data."""
        reshaped_data = self.data.reshape(new_shape)
        reshaped_weights = self.weights.reshape(new_shape) if self.weights is not None else None
        return NumPyContainer(reshaped_data, reshaped_weights)
    
    def apply_function(self, func: np.ufunc) -> NumPyContainer:
        """Apply universal function to data."""
        transformed_data = func(self.data)
        return NumPyContainer(transformed_data, self.weights)


def random_operations(
    size: Union[int, ShapeType],
    low: float = 0.0,
    high: float = 1.0,
    seed: Optional[int] = None
) -> Tuple[NDArray[np.float64], NDArray[np.int_], NDArray[np.float64]]:
    """Random number generation operations."""
    if seed is not None:
        np.random.seed(seed)
    
    uniform = np.random.uniform(low, high, size)
    integers = np.random.randint(0, 100, size)
    normal = np.random.normal(0, 1, size)
    
    return uniform, integers, normal


def advanced_indexing(
    arr: NDArray[Any]
) -> Tuple[NDArray[Any], NDArray[Any], List[NDArray[Any]]]:
    """Advanced indexing techniques."""
    # Boolean indexing
    positive_values = arr[arr > 0]
    
    # Fancy indexing
    indices = np.array([0, 2, 4])
    fancy_indexed = arr[indices] if len(arr) > 4 else arr[:len(indices)]
    
    # Multi-dimensional indexing
    if arr.ndim > 1:
        slices = [arr[i, :] for i in range(min(3, arr.shape[0]))]
    else:
        slices = [arr[:3], arr[3:6], arr[6:9]]
    
    return positive_values, fancy_indexed, slices


# Constants and module-level arrays
IDENTITY_3X3: NDArray[np.float64] = np.eye(3)
ZEROS_VECTOR: NDArray[np.float64] = np.zeros(10)
ONES_MATRIX: NDArray[np.float64] = np.ones((5, 5))

# Export for testing
__all__ = [
    'Float32Array', 'Float64Array', 'IntArray', 'BoolArray', 'AnyArray',
    'Vector', 'Matrix', 'Tensor3D', 'ArrayProtocol', 'NumPyContainer',
    'create_array', 'array_operations', 'statistical_functions',
    'linear_algebra_ops', 'array_slicing_operations', 'dtype_conversions',
    'broadcasting_operations', 'random_operations', 'advanced_indexing',
    'IDENTITY_3X3', 'ZEROS_VECTOR', 'ONES_MATRIX'
]