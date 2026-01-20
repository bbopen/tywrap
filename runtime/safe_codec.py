"""
Safe JSON codec with explicit edge case handling.

Provides bidirectional validation and serialization for the JS<->Python bridge.
This module handles special Python types and enforces payload size limits to
ensure predictable behavior at the language boundary.
"""

import base64
import json
import math
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path, PurePath
from typing import Any, Optional, Union
from uuid import UUID


class CodecError(Exception):
    """Raised when encoding/decoding fails."""

    pass


def _is_nan_or_inf(value: Any) -> bool:
    """
    Check if a numeric value is NaN or Infinity.

    Args:
        value: The value to check.

    Returns:
        True if the value is NaN, positive infinity, or negative infinity.
    """
    if not isinstance(value, (int, float)):
        return False
    try:
        return math.isnan(value) or math.isinf(value)
    except (TypeError, ValueError):
        return False


def _is_numpy_scalar(obj: Any) -> bool:
    """
    Detect numpy scalar types when NumPy is installed.

    Why: numpy scalars have an `.item()` method to extract Python primitives,
    which is needed for JSON serialization.
    """
    try:
        import numpy as np
    except ImportError:
        return False
    return isinstance(obj, (np.generic, np.ndarray)) and obj.ndim == 0


def _is_pandas_scalar(obj: Any) -> bool:
    """
    Detect pandas scalar types (Timestamp, Timedelta, etc.).

    Why: pandas wraps numpy scalars with additional metadata; extracting the
    underlying value ensures clean JSON serialization.
    """
    try:
        import pandas as pd
    except ImportError:
        return False
    # Check for pandas Timestamp, Timedelta, NaT, etc.
    return isinstance(
        obj,
        (
            pd.Timestamp,
            pd.Timedelta,
            type(pd.NaT),
        ),
    )


def _has_pydantic_model_dump(obj: Any) -> bool:
    """
    Check if object is a Pydantic v2 model with model_dump method.

    Why: Pydantic models should be serialized via their built-in mechanism
    to respect field aliases and serialization modes.
    """
    model_dump = getattr(obj, 'model_dump', None)
    return callable(model_dump)


class SafeCodec:
    """
    Safe JSON codec with explicit edge case handling.

    This codec provides:
    - Rejection of NaN/Infinity by default (configurable)
    - Payload size limits to prevent memory exhaustion
    - Automatic handling of common Python types (datetime, Decimal, UUID, etc.)
    - Support for numpy/pandas scalars
    - Pydantic model serialization

    Args:
        allow_nan: If False (default), reject NaN/Infinity values.
        max_payload_bytes: Maximum payload size in bytes (default 10MB).

    Example:
        >>> codec = SafeCodec()
        >>> codec.encode({"key": "value"})
        '{"key": "value"}'
        >>> codec.decode('{"key": "value"}')
        {'key': 'value'}
    """

    def __init__(
        self,
        allow_nan: bool = False,
        max_payload_bytes: int = 10 * 1024 * 1024,
    ) -> None:
        """
        Initialize the codec with configuration.

        Args:
            allow_nan: If False (default), reject NaN/Infinity values.
            max_payload_bytes: Maximum payload size in bytes (default 10MB).
        """
        self.allow_nan = allow_nan
        self.max_payload_bytes = max_payload_bytes

    def encode(self, value: Any) -> str:
        """
        Encode a Python value to a JSON string.

        Args:
            value: The Python value to encode.

        Returns:
            A JSON string representation of the value.

        Raises:
            CodecError: If encoding fails due to:
                - NaN/Infinity values when allow_nan is False
                - Payload exceeds max_payload_bytes
                - Value contains non-serializable types
        """
        try:
            result = json.dumps(
                value,
                default=self._default_encoder,
                allow_nan=self.allow_nan,
            )
        except ValueError as exc:
            # json.dumps raises ValueError for NaN/Infinity when allow_nan=False
            error_msg = str(exc).lower()
            if 'nan' in error_msg or 'infinity' in error_msg or 'inf' in error_msg:
                raise CodecError(
                    'Cannot serialize NaN - NaN/Infinity not allowed in JSON'
                ) from exc
            raise CodecError(f'JSON encoding failed: {exc}') from exc
        except TypeError as exc:
            raise CodecError(f'JSON encoding failed: {exc}') from exc

        # Check payload size
        payload_bytes = len(result.encode('utf-8'))
        if payload_bytes > self.max_payload_bytes:
            raise CodecError(f'Payload exceeds {self.max_payload_bytes} bytes')

        return result

    def decode(self, payload: str) -> Any:
        """
        Decode a JSON string to a Python value.

        Args:
            payload: The JSON string to decode.

        Returns:
            The decoded Python value.

        Raises:
            CodecError: If decoding fails due to:
                - Payload exceeds max_payload_bytes
                - Invalid JSON syntax
        """
        # Check payload size first
        payload_bytes = len(payload.encode('utf-8'))
        if payload_bytes > self.max_payload_bytes:
            raise CodecError(f'Payload exceeds {self.max_payload_bytes} bytes')

        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise CodecError(f'JSON decoding failed: {exc}') from exc

    def _default_encoder(self, obj: Any) -> Any:
        """
        Handle special Python types during JSON encoding.

        This method is called by json.dumps for objects that are not natively
        JSON serializable.

        Args:
            obj: The object to encode.

        Returns:
            A JSON-serializable representation of the object.

        Raises:
            TypeError: If the object cannot be serialized.
            CodecError: If the object contains NaN/Infinity when not allowed.
        """
        # Handle numpy/pandas scalars first (they need .item() extraction)
        if _is_numpy_scalar(obj):
            extracted = obj.item()
            # Check for NaN/Infinity in extracted value
            if not self.allow_nan and _is_nan_or_inf(extracted):
                raise CodecError(
                    'Cannot serialize NaN - NaN/Infinity not allowed in JSON'
                )
            return extracted

        if _is_pandas_scalar(obj):
            try:
                import pandas as pd
            except ImportError:
                pass
            else:
                # Handle NaT (Not a Time)
                if obj is pd.NaT or (hasattr(pd, 'isna') and pd.isna(obj)):
                    return None
                # Pandas Timestamp -> ISO string
                if isinstance(obj, pd.Timestamp):
                    return obj.isoformat()
                # Pandas Timedelta -> total seconds
                if isinstance(obj, pd.Timedelta):
                    return obj.total_seconds()

        # datetime types
        if isinstance(obj, datetime):
            return obj.isoformat()

        if isinstance(obj, date):
            return obj.isoformat()

        if isinstance(obj, time):
            return obj.isoformat()

        # timedelta -> total seconds (consistent with python_bridge.py)
        if isinstance(obj, timedelta):
            return obj.total_seconds()

        # Decimal -> string (preserves precision)
        if isinstance(obj, Decimal):
            return str(obj)

        # UUID -> string
        if isinstance(obj, UUID):
            return str(obj)

        # Path -> string
        if isinstance(obj, (Path, PurePath)):
            return str(obj)

        # bytes/bytearray -> base64 with type marker
        if isinstance(obj, (bytes, bytearray)):
            return {
                '__type__': 'bytes',
                'encoding': 'base64',
                'data': base64.b64encode(obj).decode('ascii'),
            }

        # Pydantic models
        if _has_pydantic_model_dump(obj):
            try:
                return obj.model_dump(by_alias=True, mode='json')
            except TypeError:
                # Older Pydantic versions may not support mode='json'
                return obj.model_dump(by_alias=True)

        # Sets -> lists (common conversion)
        if isinstance(obj, (set, frozenset)):
            return list(obj)

        # Complex numbers (rejected by default as they contain floats)
        if isinstance(obj, complex):
            raise TypeError(
                f'Object of type {type(obj).__name__} is not JSON serializable'
            )

        # Fallback: raise TypeError with clear message
        raise TypeError(
            f'Object of type {type(obj).__name__} is not JSON serializable'
        )


# Module-level convenience instance with default settings
_default_codec: Optional[SafeCodec] = None


def get_default_codec() -> SafeCodec:
    """
    Get or create the default SafeCodec instance.

    Returns:
        The default SafeCodec instance with standard settings.
    """
    global _default_codec
    if _default_codec is None:
        _default_codec = SafeCodec()
    return _default_codec


def encode(value: Any, *, allow_nan: bool = False) -> str:
    """
    Convenience function to encode a value using default settings.

    Args:
        value: The Python value to encode.
        allow_nan: If True, allow NaN/Infinity values.

    Returns:
        A JSON string representation of the value.

    Raises:
        CodecError: If encoding fails.
    """
    if allow_nan:
        codec = SafeCodec(allow_nan=True)
        return codec.encode(value)
    return get_default_codec().encode(value)


def decode(payload: str) -> Any:
    """
    Convenience function to decode a JSON string using default settings.

    Args:
        payload: The JSON string to decode.

    Returns:
        The decoded Python value.

    Raises:
        CodecError: If decoding fails.
    """
    return get_default_codec().decode(payload)
