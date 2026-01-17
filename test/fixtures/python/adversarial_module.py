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
    """
    return {1, 2, 3}


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
