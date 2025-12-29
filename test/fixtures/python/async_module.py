"""Module with async functions and generators for testing."""

from typing import AsyncIterator, Iterator, List, Optional
import asyncio


async def fetch_data(url: str) -> str:
    """Async function to fetch data."""
    await asyncio.sleep(0.1)
    return f"data from {url}"


async def process_items(items: List[str]) -> List[str]:
    """Process items asynchronously."""
    results = []
    for item in items:
        await asyncio.sleep(0.01)
        results.append(item.upper())
    return results


async def async_generator(count: int) -> AsyncIterator[int]:
    """Async generator yielding numbers."""
    for i in range(count):
        await asyncio.sleep(0.01)
        yield i


def sync_generator(count: int) -> Iterator[int]:
    """Sync generator yielding numbers."""
    for i in range(count):
        yield i


def range_generator(start: int, stop: int, step: int = 1) -> Iterator[int]:
    """Generator mimicking range."""
    current = start
    while current < stop:
        yield current
        current += step


async def async_context_manager():
    """Async context manager function."""

    class AsyncContextManager:
        async def __aenter__(self):
            await asyncio.sleep(0.01)
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            await asyncio.sleep(0.01)

    return AsyncContextManager()


class AsyncProcessor:
    """Class with async methods."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._cache: Optional[str] = None

    async def initialize(self) -> None:
        """Initialize the processor."""
        await asyncio.sleep(0.1)
        self._cache = "initialized"

    async def process(self, data: str) -> str:
        """Process data asynchronously."""
        await asyncio.sleep(0.01)
        return f"{self.name}: {data}"

    async def batch_process(self, items: List[str]) -> List[str]:
        """Process multiple items."""
        tasks = [self.process(item) for item in items]
        return await asyncio.gather(*tasks)

    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        self._cache = None
