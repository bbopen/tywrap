"""Adversarial helpers for Tywrap runtime testing.

Why: provide deterministic ways to trigger timeouts, serialization errors,
and invalid payloads so the bridge can be hardened against real-world failures.
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any


def echo(value: Any) -> Any:
    """Return the value unchanged.

    Why: establish a baseline call that should succeed after adversarial cases.
    """
    return value


def sleep_and_return(value: Any, delay_s: float) -> Any:
    """Sleep before returning the value.

    Why: trigger timeouts and verify late responses are safely ignored.
    """
    time.sleep(float(delay_s))
    return value


def return_large_payload(size: int) -> str:
    """Return a large string payload.

    Why: exercise payload size limits enforced by TYWRAP_CODEC_MAX_BYTES.
    """
    return "x" * int(size)


def return_unserializable() -> Any:
    """Return a non-JSON-serializable value.

    Why: ensure serialization failures surface as explicit errors.
    Note: sets are now serialized as lists, so we return a function which
    cannot be JSON serialized.
    """
    return lambda x: x


def return_circular_reference() -> list:
    """Return a self-referential list.

    Why: ensure circular references are rejected cleanly by the bridge.
    """
    items = []
    items.append(items)
    return items


def return_nan_payload() -> list[float]:
    """Return NaN/Infinity values.

    Why: exercise invalid JSON payloads that must be handled explicitly.
    """
    return [float("nan"), float("inf"), -float("inf")]


def print_to_stdout(value: Any) -> Any:
    """Print to stdout before returning the value.

    Why: stdout noise should surface as a protocol error on the JS side.
    """
    print(value)
    return value


def write_to_stderr(value: Any) -> Any:
    """Write to stderr before returning the value.

    Why: stderr noise should not break protocol parsing.
    """
    sys.stderr.write(f"{value}\n")
    sys.stderr.flush()
    return value


def write_stderr_then_sleep(message: str, delay_s: float) -> str:
    """Write to stderr and sleep before returning.

    Why: ensure timeout errors surface recent stderr without breaking the bridge.
    """
    sys.stderr.write(f"{message}\n")
    sys.stderr.flush()
    time.sleep(float(delay_s))
    return message


def raise_error(message: str) -> None:
    """Raise a ValueError with a custom message.

    Why: verify Python exceptions are surfaced with type and message.
    """
    raise ValueError(message)


def crash_process(exit_code: int = 1) -> None:
    """Exit the process immediately.

    Why: simulate hard crashes so the bridge can surface process exits cleanly.
    """
    os._exit(int(exit_code))


def return_bad_codec_version() -> dict[str, Any]:
    """Return an envelope with an unsupported codec version.

    Why: ensure the JS decoder rejects incompatible envelopes.
    """
    return {
        "__tywrap__": "dataframe",
        "codecVersion": 999,
        "encoding": "json",
        "data": [],
    }


def return_bad_encoding() -> dict[str, Any]:
    """Return an envelope with an unsupported encoding.

    Why: validate decoder errors when encodings are unknown.
    """
    return {
        "__tywrap__": "dataframe",
        "codecVersion": 1,
        "encoding": "xml",
        "data": [],
    }


def return_missing_b64() -> dict[str, Any]:
    """Return an Arrow envelope without a b64 payload.

    Why: ensure missing required fields are rejected.
    """
    return {
        "__tywrap__": "dataframe",
        "codecVersion": 1,
        "encoding": "arrow",
    }


def return_missing_data() -> dict[str, Any]:
    """Return a JSON envelope without data.

    Why: ensure missing required fields are rejected.
    """
    return {
        "__tywrap__": "ndarray",
        "codecVersion": 1,
        "encoding": "json",
    }


def return_invalid_sparse_format() -> dict[str, Any]:
    """Return a sparse envelope with an unsupported format.

    Why: validate SciPy sparse envelope guards.
    """
    return {
        "__tywrap__": "scipy.sparse",
        "codecVersion": 1,
        "encoding": "json",
        "format": "dok",
        "shape": [1, 1],
        "data": [],
    }


def return_invalid_sparse_shape() -> dict[str, Any]:
    """Return a sparse envelope with an invalid shape.

    Why: ensure shape validation rejects malformed payloads.
    """
    return {
        "__tywrap__": "scipy.sparse",
        "codecVersion": 1,
        "encoding": "json",
        "format": "csr",
        "shape": [1],
        "data": [],
        "indices": [],
        "indptr": [],
    }


def return_invalid_torch_value() -> dict[str, Any]:
    """Return a torch envelope with an invalid nested value.

    Why: ensure nested ndarray requirements are enforced.
    """
    return {
        "__tywrap__": "torch.tensor",
        "codecVersion": 1,
        "encoding": "ndarray",
        "value": {"not": "ndarray"},
    }


def return_invalid_sklearn_payload() -> dict[str, Any]:
    """Return a sklearn envelope with invalid types.

    Why: validate estimator payload checks (className/module/params).
    """
    return {
        "__tywrap__": "sklearn.estimator",
        "codecVersion": 1,
        "encoding": "json",
        "className": 123,
        "module": "sklearn.linear_model",
        "params": [],
    }
