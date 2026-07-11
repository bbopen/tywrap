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
