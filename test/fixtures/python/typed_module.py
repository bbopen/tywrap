"""Fully typed module for testing type annotation extraction."""

from typing import List, Dict, Optional, Tuple


def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


def greet(name: str, suffix: str = "!") -> str:
    """Greet someone by name."""
    return f"Hello, {name}{suffix}"


def process_list(items: List[int]) -> int:
    """Sum all items in a list."""
    return sum(items)


def get_user(user_id: int) -> Optional[Dict[str, str]]:
    """Get user by ID, returns None if not found."""
    users = {1: {"name": "Alice", "email": "alice@example.com"}}
    return users.get(user_id)


def parse_coords(data: str) -> Tuple[float, float]:
    """Parse coordinate string into tuple."""
    x, y = data.split(",")
    return float(x), float(y)


class Calculator:
    """A simple calculator with type hints."""

    def __init__(self, initial_value: int = 0) -> None:
        self.value: int = initial_value

    def add(self, n: int) -> int:
        """Add to current value."""
        self.value += n
        return self.value

    def subtract(self, n: int) -> int:
        """Subtract from current value."""
        self.value -= n
        return self.value

    def reset(self) -> None:
        """Reset value to zero."""
        self.value = 0

    def get_value(self) -> int:
        """Get current value."""
        return self.value
