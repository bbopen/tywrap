import unittest
from typing import AsyncIterator, Iterator

from tywrap_ir.ir import _extract_function


async def sample_async_generator() -> AsyncIterator[int]:
    yield 1


async def sample_async_coroutine() -> int:
    return 1


def sample_sync_generator() -> Iterator[int]:
    yield 1


class IRFunctionFlagTests(unittest.TestCase):
    def test_async_generator_is_marked_as_generator(self) -> None:
        result = _extract_function(sample_async_generator, "tests.sample_async_generator")
        assert result is not None
        assert result.is_async
        assert result.is_generator

    def test_async_coroutine_is_not_marked_as_generator(self) -> None:
        result = _extract_function(sample_async_coroutine, "tests.sample_async_coroutine")
        assert result is not None
        assert result.is_async
        assert not result.is_generator

    def test_sync_generator_flags(self) -> None:
        result = _extract_function(sample_sync_generator, "tests.sample_sync_generator")
        assert result is not None
        assert not result.is_async
        assert result.is_generator


if __name__ == "__main__":
    unittest.main()
