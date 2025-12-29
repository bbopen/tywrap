"""Module B with circular import to module A."""

from . import circular_a


def func_b() -> str:
    """Function in module B."""
    return "B"


def call_a() -> str:
    """Call function from module A."""
    return circular_a.func_a()


class ClassB:
    """Class in module B."""

    def get_a_instance(self) -> "circular_a.ClassA":
        """Get an instance of ClassA."""
        return circular_a.ClassA()
