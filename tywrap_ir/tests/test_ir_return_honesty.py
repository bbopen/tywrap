import decimal
import sys
import types
import unittest
from pathlib import Path

from tywrap_ir.ir import extract_module_ir


class IRReturnHonestyTests(unittest.TestCase):
    def test_preserves_external_return_path_and_warns(self) -> None:
        module_name = "tywrap_ir_test_external_return"
        module = types.ModuleType(module_name)

        def external() -> decimal.Decimal:
            return decimal.Decimal("1")

        external.__module__ = module_name
        module.external = external
        sys.modules[module_name] = module
        try:
            ir = extract_module_ir(module_name)
        finally:
            del sys.modules[module_name]

        function = next(item for item in ir["functions"] if item["name"] == "external")
        self.assertEqual(function["returns"], "decimal.Decimal")
        self.assertTrue(
            any("resolves outside analyzed module: decimal.Decimal" in warning for warning in ir["warnings"])
        )

    def test_extracts_local_newtype_as_alias_to_its_base(self) -> None:
        fixture_root = Path(__file__).resolve().parents[2] / "test" / "menagerie"
        sys.path.insert(0, str(fixture_root))
        try:
            ir = extract_module_ir("fixtures.typing_torture")
        finally:
            sys.path.pop(0)
            sys.modules.pop("fixtures.typing_torture", None)
            sys.modules.pop("fixtures", None)

        alias = next(item for item in ir["type_aliases"] if item["name"] == "UserId")
        self.assertEqual(alias["definition"], "int")


if __name__ == "__main__":
    unittest.main()
