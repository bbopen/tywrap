import importlib
import unittest

from tywrap_ir.optimized_ir import OptimizedIRExtractor


class OptimizedIRParallelWarningTests(unittest.TestCase):
    def test_parallel_extraction_reports_component_failures_in_warnings(self) -> None:
        extractor = OptimizedIRExtractor(enable_caching=False, enable_parallel=True, max_workers=2)
        module = importlib.import_module("math")

        extractor._extract_functions_optimized = lambda *_args, **_kwargs: (_ for _ in ()).throw(  # type: ignore[method-assign]
            RuntimeError("boom")
        )
        extractor._extract_classes_optimized = lambda *_args, **_kwargs: []  # type: ignore[method-assign]
        extractor._extract_constants_optimized = lambda *_args, **_kwargs: []  # type: ignore[method-assign]
        extractor._extract_type_aliases_optimized = lambda *_args, **_kwargs: []  # type: ignore[method-assign]

        result = extractor._extract_parallel(module, "math", "0.1.0", False)

        self.assertEqual(result["module"], "math")
        self.assertIn("warnings", result)
        self.assertTrue(any("Error extracting functions from math: boom" in w for w in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
