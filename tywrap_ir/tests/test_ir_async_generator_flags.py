import unittest

from tywrap_ir.ir import _extract_function


async def sample_async_generator():
    yield 1


async def sample_async_coroutine():
    return 1


def sample_sync_generator():
    yield 1


class IRFunctionFlagTests(unittest.TestCase):
    def test_async_generator_is_marked_as_generator(self) -> None:
        result = _extract_function(sample_async_generator, "tests.sample_async_generator")
        self.assertIsNotNone(result)
        if result is None:
            self.fail("Expected IRFunction for async generator")
        self.assertTrue(result.is_async)
        self.assertTrue(result.is_generator)

    def test_async_coroutine_is_not_marked_as_generator(self) -> None:
        result = _extract_function(sample_async_coroutine, "tests.sample_async_coroutine")
        self.assertIsNotNone(result)
        if result is None:
            self.fail("Expected IRFunction for async coroutine")
        self.assertTrue(result.is_async)
        self.assertFalse(result.is_generator)

    def test_sync_generator_flags(self) -> None:
        result = _extract_function(sample_sync_generator, "tests.sample_sync_generator")
        self.assertIsNotNone(result)
        if result is None:
            self.fail("Expected IRFunction for sync generator")
        self.assertFalse(result.is_async)
        self.assertTrue(result.is_generator)


if __name__ == "__main__":
    unittest.main()
