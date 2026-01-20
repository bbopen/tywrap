"""
SafeCodec Test Suite for Python

Comprehensive tests for the SafeCodec class that provides safe JSON
encoding/decoding with explicit edge case handling for the JS<->Python bridge.

Run with: pytest test/python/test_safe_codec.py -v
"""

from __future__ import annotations

import base64
import json
import sys
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import UUID

import pytest

# Add runtime to path for import
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'runtime'))

from safe_codec import CodecError, SafeCodec, decode, encode


# ═══════════════════════════════════════════════════════════════════════════
# FIXTURES
# ═══════════════════════════════════════════════════════════════════════════


@pytest.fixture
def codec() -> SafeCodec:
    """Default codec with standard settings."""
    return SafeCodec()


@pytest.fixture
def permissive_codec() -> SafeCodec:
    """Codec that allows NaN/Infinity."""
    return SafeCodec(allow_nan=True)


@pytest.fixture
def small_codec() -> SafeCodec:
    """Codec with small payload limit for testing size limits."""
    return SafeCodec(max_payload_bytes=100)


# ═══════════════════════════════════════════════════════════════════════════
# BASIC ENCODING/DECODING
# ═══════════════════════════════════════════════════════════════════════════


class TestBasicEncodingDecoding:
    """Test basic round-trip encoding and decoding."""

    def test_round_trip_simple_values(self, codec: SafeCodec) -> None:
        """Simple values should round-trip correctly."""
        test_cases: list[tuple[Any, Any]] = [
            (42, 42),
            (3.14, 3.14),
            ('hello', 'hello'),
            (True, True),
            (False, False),
            (None, None),
        ]
        for value, expected in test_cases:
            encoded = codec.encode(value)
            decoded = codec.decode(encoded)
            assert decoded == expected, f'Failed for {value}'

    def test_round_trip_lists(self, codec: SafeCodec) -> None:
        """Lists should round-trip correctly."""
        original = [1, 2, 3, 'four', None, True]
        encoded = codec.encode(original)
        decoded = codec.decode(encoded)
        assert decoded == original

    def test_round_trip_dicts(self, codec: SafeCodec) -> None:
        """Dictionaries should round-trip correctly."""
        original = {'a': 1, 'b': 'two', 'c': None}
        encoded = codec.encode(original)
        decoded = codec.decode(encoded)
        assert decoded == original

    def test_round_trip_nested_structures(self, codec: SafeCodec) -> None:
        """Nested structures should round-trip correctly."""
        original = {
            'level1': {
                'level2': {
                    'level3': {
                        'value': 'deep',
                        'numbers': [1, 2, 3],
                    },
                },
            },
            'list_of_dicts': [
                {'id': 1, 'name': 'first'},
                {'id': 2, 'name': 'second'},
            ],
        }
        encoded = codec.encode(original)
        decoded = codec.decode(encoded)
        assert decoded == original

    def test_encode_produces_valid_json(self, codec: SafeCodec) -> None:
        """Encoded output should be valid JSON."""
        value = {'key': 'value', 'number': 42}
        encoded = codec.encode(value)
        # Should not raise
        parsed = json.loads(encoded)
        assert parsed == value


# ═══════════════════════════════════════════════════════════════════════════
# NAN/INFINITY REJECTION
# ═══════════════════════════════════════════════════════════════════════════


class TestNanInfinityRejection:
    """Test rejection of NaN and Infinity values."""

    def test_reject_nan_when_allow_nan_false(self, codec: SafeCodec) -> None:
        """NaN should raise CodecError when allow_nan is False."""
        with pytest.raises(CodecError) as exc_info:
            codec.encode(float('nan'))
        assert 'NaN' in str(exc_info.value)

    def test_reject_infinity_when_allow_nan_false(self, codec: SafeCodec) -> None:
        """Infinity should raise CodecError when allow_nan is False."""
        with pytest.raises(CodecError) as exc_info:
            codec.encode(float('inf'))
        assert 'NaN' in str(exc_info.value) or 'Infinity' in str(exc_info.value)

    def test_reject_negative_infinity_when_allow_nan_false(self, codec: SafeCodec) -> None:
        """Negative infinity should raise CodecError when allow_nan is False."""
        with pytest.raises(CodecError) as exc_info:
            codec.encode(float('-inf'))
        assert 'NaN' in str(exc_info.value) or 'Infinity' in str(exc_info.value)

    def test_reject_nan_in_nested_structure(self, codec: SafeCodec) -> None:
        """NaN in nested structure should raise CodecError."""
        value = {'a': {'b': {'c': float('nan')}}}
        with pytest.raises(CodecError):
            codec.encode(value)

    def test_reject_nan_in_list(self, codec: SafeCodec) -> None:
        """NaN in list should raise CodecError."""
        value = [1, 2, float('nan'), 4]
        with pytest.raises(CodecError):
            codec.encode(value)

    def test_allow_nan_when_enabled(self, permissive_codec: SafeCodec) -> None:
        """NaN should serialize when allow_nan is True."""
        value = {'value': float('nan')}
        encoded = permissive_codec.encode(value)
        # JSON with allow_nan produces 'NaN' literal
        assert 'NaN' in encoded

    def test_allow_infinity_when_enabled(self, permissive_codec: SafeCodec) -> None:
        """Infinity should serialize when allow_nan is True."""
        value = {'pos': float('inf'), 'neg': float('-inf')}
        encoded = permissive_codec.encode(value)
        assert 'Infinity' in encoded

    def test_valid_floats_pass(self, codec: SafeCodec) -> None:
        """Valid floats should not raise errors."""
        test_cases = [0.0, 1.5, -3.14159, 1e10, 1e-10, sys.float_info.max, sys.float_info.min]
        for value in test_cases:
            # Should not raise
            codec.encode(value)


# ═══════════════════════════════════════════════════════════════════════════
# NUMPY SCALAR HANDLING
# ═══════════════════════════════════════════════════════════════════════════


class TestNumpyScalarHandling:
    """Test handling of numpy scalar types."""

    @pytest.fixture(autouse=True)
    def check_numpy(self) -> None:
        """Skip tests if numpy is not available."""
        pytest.importorskip('numpy')

    def test_numpy_float64_serializes(self, codec: SafeCodec) -> None:
        """numpy.float64 scalar should serialize correctly."""
        import numpy as np

        value = np.float64(3.14159)
        encoded = codec.encode({'value': value})
        decoded = codec.decode(encoded)
        assert abs(decoded['value'] - 3.14159) < 1e-10

    def test_numpy_int32_serializes(self, codec: SafeCodec) -> None:
        """numpy.int32 scalar should serialize correctly."""
        import numpy as np

        value = np.int32(42)
        encoded = codec.encode({'value': value})
        decoded = codec.decode(encoded)
        assert decoded['value'] == 42

    def test_numpy_int64_serializes(self, codec: SafeCodec) -> None:
        """numpy.int64 scalar should serialize correctly."""
        import numpy as np

        value = np.int64(9223372036854775807)
        encoded = codec.encode({'value': value})
        decoded = codec.decode(encoded)
        assert decoded['value'] == 9223372036854775807

    def test_numpy_bool_serializes(self, codec: SafeCodec) -> None:
        """numpy.bool_ scalar should serialize correctly."""
        import numpy as np

        value = np.bool_(True)
        encoded = codec.encode({'value': value})
        decoded = codec.decode(encoded)
        assert decoded['value'] is True

    def test_numpy_nan_raises_when_allow_nan_false(self, codec: SafeCodec) -> None:
        """numpy.nan should raise CodecError when allow_nan is False."""
        import numpy as np

        with pytest.raises(CodecError) as exc_info:
            codec.encode({'value': np.float64('nan')})
        assert 'NaN' in str(exc_info.value)

    def test_numpy_inf_raises_when_allow_nan_false(self, codec: SafeCodec) -> None:
        """numpy.inf should raise CodecError when allow_nan is False."""
        import numpy as np

        with pytest.raises(CodecError) as exc_info:
            codec.encode({'value': np.float64('inf')})
        assert 'NaN' in str(exc_info.value) or 'Infinity' in str(exc_info.value)

    def test_numpy_nan_allowed_when_enabled(self, permissive_codec: SafeCodec) -> None:
        """numpy.nan should serialize when allow_nan is True."""
        import numpy as np

        value = {'value': np.float64('nan')}
        encoded = permissive_codec.encode(value)
        assert 'NaN' in encoded

    def test_numpy_0d_array_serializes(self, codec: SafeCodec) -> None:
        """0-dimensional numpy array should serialize as scalar."""
        import numpy as np

        value = np.array(42)
        assert value.ndim == 0
        encoded = codec.encode({'value': value})
        decoded = codec.decode(encoded)
        assert decoded['value'] == 42


# ═══════════════════════════════════════════════════════════════════════════
# PANDAS HANDLING
# ═══════════════════════════════════════════════════════════════════════════


class TestPandasHandling:
    """Test handling of pandas scalar types."""

    @pytest.fixture(autouse=True)
    def check_pandas(self) -> None:
        """Skip tests if pandas is not available."""
        pytest.importorskip('pandas')

    def test_pandas_nat_serializes_to_null(self, codec: SafeCodec) -> None:
        """pd.NaT should serialize to null."""
        import pandas as pd

        value = {'timestamp': pd.NaT}
        encoded = codec.encode(value)
        decoded = codec.decode(encoded)
        assert decoded['timestamp'] is None

    def test_pandas_timestamp_serializes_to_iso_string(self, codec: SafeCodec) -> None:
        """pd.Timestamp should serialize to ISO format string."""
        import pandas as pd

        ts = pd.Timestamp('2024-01-15 10:30:00')
        encoded = codec.encode({'timestamp': ts})
        decoded = codec.decode(encoded)
        assert '2024-01-15' in decoded['timestamp']
        assert '10:30:00' in decoded['timestamp']

    def test_pandas_timestamp_with_timezone(self, codec: SafeCodec) -> None:
        """pd.Timestamp with timezone should serialize correctly."""
        import pandas as pd

        ts = pd.Timestamp('2024-01-15 10:30:00', tz='UTC')
        encoded = codec.encode({'timestamp': ts})
        decoded = codec.decode(encoded)
        assert '2024-01-15' in decoded['timestamp']

    def test_pandas_timedelta_serializes_to_seconds(self, codec: SafeCodec) -> None:
        """pd.Timedelta should serialize to total seconds."""
        import pandas as pd

        td = pd.Timedelta(hours=2, minutes=30)
        encoded = codec.encode({'duration': td})
        decoded = codec.decode(encoded)
        expected_seconds = 2 * 3600 + 30 * 60
        assert decoded['duration'] == expected_seconds


# ═══════════════════════════════════════════════════════════════════════════
# DATETIME HANDLING
# ═══════════════════════════════════════════════════════════════════════════


class TestDatetimeHandling:
    """Test handling of datetime types."""

    def test_datetime_serializes_to_iso_string(self, codec: SafeCodec) -> None:
        """datetime should serialize to ISO format string."""
        dt = datetime(2024, 1, 15, 10, 30, 45)
        encoded = codec.encode({'timestamp': dt})
        decoded = codec.decode(encoded)
        assert decoded['timestamp'] == '2024-01-15T10:30:45'

    def test_datetime_with_microseconds(self, codec: SafeCodec) -> None:
        """datetime with microseconds should serialize correctly."""
        dt = datetime(2024, 1, 15, 10, 30, 45, 123456)
        encoded = codec.encode({'timestamp': dt})
        decoded = codec.decode(encoded)
        assert '2024-01-15T10:30:45.123456' == decoded['timestamp']

    def test_date_serializes_to_iso_string(self, codec: SafeCodec) -> None:
        """date should serialize to ISO format string."""
        d = date(2024, 1, 15)
        encoded = codec.encode({'date': d})
        decoded = codec.decode(encoded)
        assert decoded['date'] == '2024-01-15'

    def test_time_serializes_to_iso_string(self, codec: SafeCodec) -> None:
        """time should serialize to ISO format string."""
        t = time(10, 30, 45)
        encoded = codec.encode({'time': t})
        decoded = codec.decode(encoded)
        assert decoded['time'] == '10:30:45'

    def test_timedelta_serializes_to_seconds(self, codec: SafeCodec) -> None:
        """timedelta should serialize to total seconds."""
        td = timedelta(hours=2, minutes=30, seconds=15)
        encoded = codec.encode({'duration': td})
        decoded = codec.decode(encoded)
        expected_seconds = 2 * 3600 + 30 * 60 + 15
        assert decoded['duration'] == expected_seconds

    def test_timedelta_with_days(self, codec: SafeCodec) -> None:
        """timedelta with days should serialize correctly."""
        td = timedelta(days=2, hours=12)
        encoded = codec.encode({'duration': td})
        decoded = codec.decode(encoded)
        expected_seconds = 2 * 86400 + 12 * 3600
        assert decoded['duration'] == expected_seconds

    def test_negative_timedelta(self, codec: SafeCodec) -> None:
        """Negative timedelta should serialize to negative seconds."""
        td = timedelta(hours=-2)
        encoded = codec.encode({'duration': td})
        decoded = codec.decode(encoded)
        assert decoded['duration'] == -7200


# ═══════════════════════════════════════════════════════════════════════════
# SPECIAL TYPES
# ═══════════════════════════════════════════════════════════════════════════


class TestSpecialTypes:
    """Test handling of special Python types."""

    def test_decimal_serializes_to_string(self, codec: SafeCodec) -> None:
        """Decimal should serialize to string to preserve precision."""
        value = Decimal('123.456789012345678901234567890')
        encoded = codec.encode({'value': value})
        decoded = codec.decode(encoded)
        assert decoded['value'] == '123.456789012345678901234567890'

    def test_decimal_with_exponent(self, codec: SafeCodec) -> None:
        """Decimal with scientific notation should serialize correctly."""
        value = Decimal('1.23E+10')
        encoded = codec.encode({'value': value})
        decoded = codec.decode(encoded)
        # Decimal string representation may vary
        assert '1.23' in decoded['value'] or '12300000000' in decoded['value']

    def test_uuid_serializes_to_string(self, codec: SafeCodec) -> None:
        """UUID should serialize to string."""
        value = UUID('12345678-1234-5678-1234-567812345678')
        encoded = codec.encode({'id': value})
        decoded = codec.decode(encoded)
        assert decoded['id'] == '12345678-1234-5678-1234-567812345678'

    def test_path_serializes_to_string(self, codec: SafeCodec) -> None:
        """Path should serialize to string."""
        value = Path('/home/user/file.txt')
        encoded = codec.encode({'path': value})
        decoded = codec.decode(encoded)
        assert decoded['path'] == '/home/user/file.txt'

    def test_pure_path_serializes_to_string(self, codec: SafeCodec) -> None:
        """PurePath should serialize to string."""
        value = PurePosixPath('/home/user/file.txt')
        encoded = codec.encode({'path': value})
        decoded = codec.decode(encoded)
        assert decoded['path'] == '/home/user/file.txt'

    def test_bytes_serialize_to_base64_marker(self, codec: SafeCodec) -> None:
        """bytes should serialize to base64 with type marker."""
        value = b'Hello, World!'
        encoded = codec.encode({'data': value})
        decoded = codec.decode(encoded)
        assert decoded['data']['__type__'] == 'bytes'
        assert decoded['data']['encoding'] == 'base64'
        # Verify base64 decodes correctly
        decoded_bytes = base64.b64decode(decoded['data']['data'])
        assert decoded_bytes == b'Hello, World!'

    def test_bytearray_serializes_to_base64_marker(self, codec: SafeCodec) -> None:
        """bytearray should serialize to base64 with type marker."""
        value = bytearray([1, 2, 3, 4, 5])
        encoded = codec.encode({'data': value})
        decoded = codec.decode(encoded)
        assert decoded['data']['__type__'] == 'bytes'
        assert decoded['data']['encoding'] == 'base64'
        decoded_bytes = base64.b64decode(decoded['data']['data'])
        assert list(decoded_bytes) == [1, 2, 3, 4, 5]

    def test_empty_bytes(self, codec: SafeCodec) -> None:
        """Empty bytes should serialize correctly."""
        value = b''
        encoded = codec.encode({'data': value})
        decoded = codec.decode(encoded)
        assert decoded['data']['__type__'] == 'bytes'
        decoded_bytes = base64.b64decode(decoded['data']['data'])
        assert decoded_bytes == b''

    def test_set_serializes_to_list(self, codec: SafeCodec) -> None:
        """set should serialize to list."""
        value = {1, 2, 3}
        encoded = codec.encode({'items': value})
        decoded = codec.decode(encoded)
        assert sorted(decoded['items']) == [1, 2, 3]

    def test_frozenset_serializes_to_list(self, codec: SafeCodec) -> None:
        """frozenset should serialize to list."""
        value = frozenset(['a', 'b', 'c'])
        encoded = codec.encode({'items': value})
        decoded = codec.decode(encoded)
        assert sorted(decoded['items']) == ['a', 'b', 'c']


# ═══════════════════════════════════════════════════════════════════════════
# PYDANTIC HANDLING
# ═══════════════════════════════════════════════════════════════════════════


class TestPydanticHandling:
    """Test handling of Pydantic models."""

    @pytest.fixture(autouse=True)
    def check_pydantic(self) -> None:
        """Skip tests if pydantic is not available."""
        pytest.importorskip('pydantic')

    def test_pydantic_model_uses_model_dump(self, codec: SafeCodec) -> None:
        """Pydantic model should use model_dump for serialization."""
        from pydantic import BaseModel

        class User(BaseModel):
            id: int
            name: str
            email: str

        user = User(id=1, name='Test User', email='test@example.com')
        encoded = codec.encode({'user': user})
        decoded = codec.decode(encoded)
        assert decoded['user'] == {'id': 1, 'name': 'Test User', 'email': 'test@example.com'}

    def test_pydantic_model_with_alias(self, codec: SafeCodec) -> None:
        """Pydantic model should respect field aliases."""
        from pydantic import BaseModel, Field

        class Config(BaseModel):
            api_key: str = Field(alias='apiKey')

        config = Config(apiKey='secret123')
        encoded = codec.encode({'config': config})
        decoded = codec.decode(encoded)
        # by_alias=True should use the alias
        assert 'apiKey' in decoded['config']
        assert decoded['config']['apiKey'] == 'secret123'

    def test_pydantic_nested_model(self, codec: SafeCodec) -> None:
        """Nested Pydantic models should serialize correctly."""
        from pydantic import BaseModel

        class Address(BaseModel):
            street: str
            city: str

        class Person(BaseModel):
            name: str
            address: Address

        person = Person(name='John', address=Address(street='123 Main St', city='NYC'))
        encoded = codec.encode({'person': person})
        decoded = codec.decode(encoded)
        assert decoded['person']['name'] == 'John'
        assert decoded['person']['address']['street'] == '123 Main St'


# ═══════════════════════════════════════════════════════════════════════════
# SIZE LIMITS
# ═══════════════════════════════════════════════════════════════════════════


class TestSizeLimits:
    """Test payload size limit enforcement."""

    def test_large_payload_raises_codec_error(self, small_codec: SafeCodec) -> None:
        """Payload exceeding max_payload_bytes should raise CodecError."""
        large_data = {'data': 'x' * 200}
        with pytest.raises(CodecError) as exc_info:
            small_codec.encode(large_data)
        assert 'exceeds' in str(exc_info.value)

    def test_small_payload_passes(self, small_codec: SafeCodec) -> None:
        """Payload under limit should not raise."""
        small_data = {'a': 1}
        # Should not raise
        small_codec.encode(small_data)

    def test_decode_respects_size_limit(self, small_codec: SafeCodec) -> None:
        """Decode should also respect max_payload_bytes."""
        large_payload = json.dumps({'data': 'x' * 200})
        with pytest.raises(CodecError) as exc_info:
            small_codec.decode(large_payload)
        assert 'exceeds' in str(exc_info.value)

    def test_default_limit_is_10mb(self, codec: SafeCodec) -> None:
        """Default limit should be 10MB."""
        assert codec.max_payload_bytes == 10 * 1024 * 1024

    def test_custom_limit_is_respected(self) -> None:
        """Custom limit should be used."""
        custom_codec = SafeCodec(max_payload_bytes=500)
        assert custom_codec.max_payload_bytes == 500

    def test_size_calculated_in_bytes_not_characters(self) -> None:
        """Size should be calculated in UTF-8 bytes, not characters."""
        # Unicode characters may be multiple bytes
        codec = SafeCodec(max_payload_bytes=50)
        # Multi-byte unicode: each emoji is 4 bytes in UTF-8
        emoji_data = {'emoji': '\U0001F600' * 5}  # 5 emoji = 20 bytes just for emoji
        # The full JSON will be larger, check if it's properly measured
        encoded = json.dumps(emoji_data)
        actual_bytes = len(encoded.encode('utf-8'))
        if actual_bytes > 50:
            with pytest.raises(CodecError):
                codec.encode(emoji_data)


# ═══════════════════════════════════════════════════════════════════════════
# ERROR MESSAGES
# ═══════════════════════════════════════════════════════════════════════════


class TestErrorMessages:
    """Test that error messages are clear and actionable."""

    def test_nan_error_message_is_clear(self, codec: SafeCodec) -> None:
        """NaN error should mention NaN explicitly."""
        with pytest.raises(CodecError) as exc_info:
            codec.encode(float('nan'))
        error_msg = str(exc_info.value)
        assert 'NaN' in error_msg
        assert 'serialize' in error_msg.lower() or 'allowed' in error_msg.lower()

    def test_size_error_includes_limit(self, small_codec: SafeCodec) -> None:
        """Size error should mention the limit."""
        with pytest.raises(CodecError) as exc_info:
            small_codec.encode({'data': 'x' * 200})
        error_msg = str(exc_info.value)
        assert '100' in error_msg or 'bytes' in error_msg.lower()

    def test_invalid_json_decode_error(self, codec: SafeCodec) -> None:
        """Invalid JSON should produce clear error."""
        with pytest.raises(CodecError) as exc_info:
            codec.decode('not valid json')
        error_msg = str(exc_info.value)
        assert 'decoding' in error_msg.lower() or 'JSON' in error_msg

    def test_non_serializable_type_error(self, codec: SafeCodec) -> None:
        """Non-serializable type should produce clear error."""

        class CustomObject:
            pass

        with pytest.raises(CodecError) as exc_info:
            codec.encode({'obj': CustomObject()})
        error_msg = str(exc_info.value)
        assert 'CustomObject' in error_msg or 'not JSON serializable' in error_msg


# ═══════════════════════════════════════════════════════════════════════════
# CONVENIENCE FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════


class TestConvenienceFunctions:
    """Test module-level convenience functions."""

    def test_encode_function_basic(self) -> None:
        """encode() function should work with default settings."""
        result = encode({'key': 'value'})
        assert json.loads(result) == {'key': 'value'}

    def test_encode_function_allows_nan_parameter(self) -> None:
        """encode() function should support allow_nan parameter."""
        result = encode({'value': float('nan')}, allow_nan=True)
        assert 'NaN' in result

    def test_encode_function_rejects_nan_by_default(self) -> None:
        """encode() function should reject NaN by default."""
        with pytest.raises(CodecError):
            encode(float('nan'))

    def test_decode_function_basic(self) -> None:
        """decode() function should work with default settings."""
        result = decode('{"key": "value"}')
        assert result == {'key': 'value'}

    def test_decode_function_invalid_json(self) -> None:
        """decode() function should raise on invalid JSON."""
        with pytest.raises(CodecError):
            decode('invalid')


# ═══════════════════════════════════════════════════════════════════════════
# EDGE CASES
# ═══════════════════════════════════════════════════════════════════════════


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_empty_dict(self, codec: SafeCodec) -> None:
        """Empty dict should serialize correctly."""
        encoded = codec.encode({})
        decoded = codec.decode(encoded)
        assert decoded == {}

    def test_empty_list(self, codec: SafeCodec) -> None:
        """Empty list should serialize correctly."""
        encoded = codec.encode([])
        decoded = codec.decode(encoded)
        assert decoded == []

    def test_empty_string(self, codec: SafeCodec) -> None:
        """Empty string should serialize correctly."""
        encoded = codec.encode('')
        decoded = codec.decode(encoded)
        assert decoded == ''

    def test_deeply_nested_structure(self, codec: SafeCodec) -> None:
        """Deeply nested structures should not cause stack overflow."""
        # Create moderately deep structure
        deep: dict[str, Any] = {'value': 'leaf'}
        for _ in range(100):
            deep = {'nested': deep}
        # Should not raise
        encoded = codec.encode(deep)
        decoded = codec.decode(encoded)
        assert decoded is not None

    def test_unicode_strings(self, codec: SafeCodec) -> None:
        """Unicode strings should serialize correctly."""
        data = {
            'emoji': '\U0001F600\U0001F389',
            'chinese': '\u4E2D\u6587',
            'arabic': '\u0627\u0644\u0639\u0631\u0628\u064A\u0629',
        }
        encoded = codec.encode(data)
        decoded = codec.decode(encoded)
        assert decoded == data

    def test_escape_sequences_in_strings(self, codec: SafeCodec) -> None:
        """Strings with escape sequences should serialize correctly."""
        data = {'text': 'line1\nline2\ttab\r\nwindows'}
        encoded = codec.encode(data)
        decoded = codec.decode(encoded)
        assert decoded['text'] == 'line1\nline2\ttab\r\nwindows'

    def test_very_large_numbers(self, codec: SafeCodec) -> None:
        """Very large numbers should serialize correctly."""
        data = {
            'big_int': 2**53 - 1,  # Max safe integer in JS
            'big_float': 1.7976931348623157e308,
        }
        encoded = codec.encode(data)
        decoded = codec.decode(encoded)
        assert decoded['big_int'] == 2**53 - 1
        # Float comparison with tolerance
        assert abs(decoded['big_float'] - 1.7976931348623157e308) < 1e300

    def test_very_small_numbers(self, codec: SafeCodec) -> None:
        """Very small numbers should serialize correctly."""
        data = {'tiny': 5e-324}  # Smallest positive float
        encoded = codec.encode(data)
        decoded = codec.decode(encoded)
        assert decoded['tiny'] > 0

    def test_zero_values(self, codec: SafeCodec) -> None:
        """Zero values should serialize correctly."""
        data = {'int_zero': 0, 'float_zero': 0.0, 'neg_zero': -0.0}
        encoded = codec.encode(data)
        decoded = codec.decode(encoded)
        assert decoded['int_zero'] == 0
        assert decoded['float_zero'] == 0.0

    def test_complex_number_raises_error(self, codec: SafeCodec) -> None:
        """Complex numbers should raise error (not JSON serializable)."""
        with pytest.raises(CodecError):
            codec.encode({'value': 1 + 2j})

    def test_none_values_in_structures(self, codec: SafeCodec) -> None:
        """None values in various positions should serialize correctly."""
        data = {
            'top_level': None,
            'in_list': [1, None, 3],
            'in_dict': {'a': None, 'b': 2},
        }
        encoded = codec.encode(data)
        decoded = codec.decode(encoded)
        assert decoded['top_level'] is None
        assert decoded['in_list'] == [1, None, 3]
        assert decoded['in_dict']['a'] is None

    def test_boolean_values(self, codec: SafeCodec) -> None:
        """Boolean values should serialize correctly."""
        data = {'true_val': True, 'false_val': False}
        encoded = codec.encode(data)
        decoded = codec.decode(encoded)
        assert decoded['true_val'] is True
        assert decoded['false_val'] is False

    def test_mixed_type_list(self, codec: SafeCodec) -> None:
        """Lists with mixed types should serialize correctly."""
        data = [1, 'two', 3.0, True, None, {'nested': 'dict'}, ['nested', 'list']]
        encoded = codec.encode(data)
        decoded = codec.decode(encoded)
        assert decoded == data
