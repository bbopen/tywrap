"""Regression tests for class-member classification in the IR extractor.

Covers the categories the legacy ``inspect.getmembers(predicate=...)`` filter
dropped or mislabeled: @classmethod, @staticmethod, @property, and
functools.cached_property, plus @typing.overload capture.
"""

import functools
import sys
import typing
import unittest

from tywrap_ir.ir import _extract_class


class Widget:
    """A widget."""

    cls_attr: int = 5

    def instance_method(self, x: int) -> str:
        """Instance docstring."""
        return str(x)

    @classmethod
    def from_count(cls, n: int) -> "Widget":
        """Class-method docstring."""
        return cls()

    @staticmethod
    def helper(z: int) -> int:
        """Static-method docstring."""
        return z

    @property
    def name(self) -> str:
        """The name."""
        return "w"

    @name.setter
    def name(self, value: str) -> None:
        pass

    @property
    def readonly(self) -> float:
        return 1.0

    @functools.cached_property
    def expensive(self) -> typing.List[int]:
        """Cached value."""
        return [1, 2, 3]

    @typing.overload
    def parse(self, x: int) -> int: ...

    @typing.overload
    def parse(self, x: str) -> str: ...

    def parse(self, x):
        return x


class ClassMemberClassificationTests(unittest.TestCase):
    def setUp(self) -> None:
        cls_ir = _extract_class(Widget, "sample_mod", include_private=False)
        assert cls_ir is not None
        self.cls_ir = cls_ir
        self.methods = {m.name: m for m in cls_ir.methods}
        self.accessors = {a.name: a for a in cls_ir.accessors}

    def test_method_kinds(self) -> None:
        self.assertEqual(self.methods["instance_method"].method_kind, "instance")
        self.assertEqual(self.methods["from_count"].method_kind, "class")
        self.assertEqual(self.methods["helper"].method_kind, "static")

    def test_classmethod_keeps_cls_param(self) -> None:
        params = [p.name for p in self.methods["from_count"].parameters]
        self.assertEqual(params[0], "cls")

    def test_staticmethod_has_no_implicit_first_param(self) -> None:
        params = [p.name for p in self.methods["helper"].parameters]
        self.assertEqual(params[0], "z")

    def test_instance_method_keeps_self(self) -> None:
        params = [p.name for p in self.methods["instance_method"].parameters]
        self.assertEqual(params[0], "self")

    def test_property_captured_as_accessor(self) -> None:
        self.assertIn("name", self.accessors)
        acc = self.accessors["name"]
        self.assertEqual(acc.returns, "str")
        self.assertFalse(acc.is_cached)
        self.assertFalse(acc.read_only)  # has a setter
        self.assertEqual(acc.docstring, "The name.")

    def test_readonly_property_is_read_only(self) -> None:
        self.assertIn("readonly", self.accessors)
        acc = self.accessors["readonly"]
        self.assertTrue(acc.read_only)
        self.assertEqual(acc.returns, "float")

    def test_cached_property_captured_and_read_only(self) -> None:
        self.assertIn("expensive", self.accessors)
        acc = self.accessors["expensive"]
        self.assertTrue(acc.is_cached)
        self.assertTrue(acc.read_only)
        self.assertEqual(acc.docstring, "Cached value.")
        self.assertIsNotNone(acc.returns)

    def test_cached_property_does_not_leak_into_methods(self) -> None:
        # A cached_property is classified as kind='method' by
        # classify_class_attrs; it must be routed to accessors, not methods.
        self.assertNotIn("expensive", self.methods)
        self.assertNotIn("name", self.methods)
        self.assertNotIn("readonly", self.methods)

    @unittest.skipIf(
        sys.version_info < (3, 11),
        "typing.get_overloads requires Python 3.11+",
    )
    def test_overloads_captured(self) -> None:
        parse = self.methods["parse"]
        self.assertEqual(len(parse.overloads), 2)
        returns = {ov.returns for ov in parse.overloads}
        self.assertEqual(returns, {"int", "str"})

    def test_existing_capture_not_regressed(self) -> None:
        # __init__ and ordinary methods are still present.
        self.assertIn("instance_method", self.methods)
        self.assertEqual(self.cls_ir.docstring, "A widget.")


if __name__ == "__main__":
    unittest.main()
