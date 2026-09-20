"""Importable exact-integer fixture for the bounded v3 compiler proof."""

import math


def combine_exact(value: int, nested: list[int], flag: bool, ratio: float) -> int:
    """Combine scalar and nested integers after the bridge decodes them."""
    total = value + sum(nested)
    return total if flag and math.copysign(1.0, ratio) > 0 else -total
