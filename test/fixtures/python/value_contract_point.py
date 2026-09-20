"""Importable Point fixture for the dataclass value proof."""

from dataclasses import dataclass


@dataclass
class Point:
    x: int
    y: int = 2


def make_point() -> Point:
    """Return a Point with its defaulted field present."""
    return Point(1)
