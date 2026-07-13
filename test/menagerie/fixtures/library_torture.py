"""Optional-dependency fixtures. Imports are intentionally lazy for Tier 2 gating."""

from __future__ import annotations


def pydantic_model_dump() -> object:
    from pydantic import BaseModel

    class Record(BaseModel):
        name: str
        count: int

    return Record(name="menagerie", count=2)


def numpy_adversarial() -> object:
    import numpy as np

    return {
        "array": np.array([2**53 + 1, 2**63 - 1], dtype=np.int64),
        "scalar": np.int64(2**53 + 1),
        "nan_column": np.array([1.0, np.nan]),
    }


def pandas_adversarial() -> object:
    import pandas as pd

    return {
        "frame": pd.DataFrame(
            {
                "when": pd.Series([pd.Timestamp("2024-01-01", tz="UTC")]),
                "category": pd.Categorical(["a"]),
            }
        ),
        "multi": pd.DataFrame(
            {"value": [1]}, index=pd.MultiIndex.from_tuples([("left", 1)], names=["side", "n"])
        ),
        "empty": pd.DataFrame(),
    }


def networkx_tuple_key_shape() -> object:
    import networkx as nx

    graph = nx.Graph()
    graph.add_edge(("left", 1), ("right", 2), weight=3)
    return nx.to_dict_of_dicts(graph)


def numpy_zero_dimensional() -> object:
    import numpy as np

    return np.array(7)


def numpy_float16() -> object:
    import numpy as np

    return np.array([1.5, -2.25], dtype=np.float16)


def numpy_bool() -> object:
    import numpy as np

    return np.array([True, False], dtype=np.bool_)


def numpy_int8() -> object:
    import numpy as np

    return np.array([-128, 127], dtype=np.int8)


def numpy_int16() -> object:
    import numpy as np

    return np.array([-32768, 32767], dtype=np.int16)


def numpy_int32() -> object:
    import numpy as np

    return np.array([-2147483648, 2147483647], dtype=np.int32)


def numpy_int64() -> object:
    import numpy as np

    return np.array([-9223372036854775808, 9223372036854775807], dtype=np.int64)


def numpy_datetime64() -> object:
    import numpy as np

    return np.array(["2024-01-02T03:04:05.123456789"], dtype="datetime64[ns]")


def numpy_big_endian() -> object:
    import numpy as np

    return np.array([1, 2], dtype=">i4")


def numpy_structured() -> object:
    import numpy as np

    return np.array([(1, 2.5)], dtype=[("left", "i4"), ("right", "f4")])


def numpy_object() -> object:
    import numpy as np

    return np.array([{"key": "value"}], dtype=object)


def numpy_empty() -> object:
    import numpy as np

    return np.array([], dtype=np.float64)


def numpy_unsafe_int64() -> object:
    import numpy as np

    return np.array([2**53 + 1], dtype=np.int64)


def pandas_nullable_int64() -> object:
    import pandas as pd

    return pd.DataFrame({"value": pd.Series([1, pd.NA], dtype="Int64")})


def pandas_categorical() -> object:
    import pandas as pd

    return pd.DataFrame({"value": pd.Categorical(["a", "b", "a"])})


def pandas_pyarrow_string() -> object:
    import pandas as pd

    return pd.DataFrame({"value": pd.Series(["a", None], dtype="string[pyarrow]")})


def pandas_timezone_aware() -> object:
    import pandas as pd

    return pd.DataFrame({"when": [pd.Timestamp("2024-01-02T03:04:05", tz="UTC")]})


def pandas_multiindex() -> object:
    import pandas as pd

    index = pd.MultiIndex.from_tuples([("left", 1)], names=["side", "number"])
    return pd.DataFrame({"value": [3]}, index=index)


def pandas_duplicate_labels() -> object:
    import pandas as pd

    return pd.DataFrame([[1, 2]], columns=["value", "value"])


def pandas_empty_frame() -> object:
    import pandas as pd

    return pd.DataFrame()


def scipy_csr() -> object:
    from scipy import sparse

    return sparse.csr_matrix([[1, 0], [0, 2]])


def scipy_csc() -> object:
    from scipy import sparse

    return sparse.csc_matrix([[1, 0], [0, 2]])


def scipy_coo() -> object:
    from scipy import sparse

    return sparse.coo_matrix([[1, 0], [0, 2]])


def scipy_dia() -> object:
    from scipy import sparse

    return sparse.dia_matrix([[1, 0], [0, 2]])


def scipy_bsr() -> object:
    from scipy import sparse

    return sparse.bsr_matrix([[1, 0], [0, 2]])


def scipy_lil() -> object:
    from scipy import sparse

    return sparse.lil_matrix([[1, 0], [0, 2]])


def scipy_dok() -> object:
    from scipy import sparse

    return sparse.dok_matrix([[1, 0], [0, 2]])


def scipy_complex() -> object:
    from scipy import sparse

    return sparse.csr_matrix([[1 + 2j, 0], [0, 3 + 4j]])


def scipy_duplicate_coo() -> object:
    from scipy import sparse

    return sparse.coo_matrix(([1, 2], ([0, 0], [1, 1])), shape=(2, 2))


def scipy_explicit_zeros() -> object:
    from scipy import sparse

    return sparse.coo_matrix(([0, 2], ([0, 1], [0, 1])), shape=(2, 2))


def torch_float32() -> object:
    import torch

    return torch.tensor([1.5, -2.25], dtype=torch.float32)


def torch_float16() -> object:
    import torch

    return torch.tensor([1.5, -2.25], dtype=torch.float16)


def torch_bool() -> object:
    import torch

    return torch.tensor([True, False], dtype=torch.bool)


def torch_int64() -> object:
    import torch

    return torch.tensor([1, -2], dtype=torch.int64)


def torch_scalar() -> object:
    import torch

    return torch.tensor(7)


def torch_bfloat16() -> object:
    import torch

    return torch.tensor([1.5], dtype=torch.bfloat16)


def torch_sparse() -> object:
    import torch

    return torch.sparse_coo_tensor(torch.tensor([[0], [1]]), torch.tensor([3.0]), (2, 2))


def torch_quantized() -> object:
    import torch

    return torch.quantize_per_tensor(torch.tensor([1.0, 2.0]), 0.1, 0, torch.qint8)


def torch_complex() -> object:
    import torch

    return torch.tensor([1 + 2j, 3 + 4j])


def sklearn_simple_estimator() -> object:
    from sklearn.linear_model import LinearRegression

    return LinearRegression(fit_intercept=False, positive=True)


def sklearn_pipeline() -> object:
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    return Pipeline([("scale", StandardScaler()), ("model", LogisticRegression())])


def sklearn_tfidf_vectorizer() -> object:
    from sklearn.feature_extraction.text import TfidfVectorizer

    return TfidfVectorizer()
