"""Module A with circular import to module B."""

from . import circular_b


def func_a() -> str:
    """Function in module A."""
    return "A"


def call_b() -> str:
    """Call function from module B."""
    return circular_b.func_b()


class ClassA:
    """Class in module A."""

    def get_b_instance(self) -> "circular_b.ClassB":
        """Get an instance of ClassB."""
        return circular_b.ClassB()
