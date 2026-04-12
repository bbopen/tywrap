import unittest

from tywrap_ir.optimized_ir import (
    _global_cache,
    _global_extractor,
    extract_module_ir_optimized,
)


class OptimizedIRExtractorOptionTests(unittest.TestCase):
    def setUp(self) -> None:
        _global_extractor.enable_caching = True
        _global_extractor.enable_parallel = True
        _global_extractor._cache = _global_cache
        _global_extractor.clear_cache()

    def tearDown(self) -> None:
        _global_extractor.enable_caching = True
        _global_extractor.enable_parallel = True
        _global_extractor._cache = _global_cache
        _global_extractor.clear_cache()

    def test_disabling_options_does_not_mutate_global_extractor(self) -> None:
        extract_module_ir_optimized("math", enable_caching=False, enable_parallel=False)

        self.assertTrue(_global_extractor.enable_caching)
        self.assertTrue(_global_extractor.enable_parallel)
        self.assertIs(_global_extractor._cache, _global_cache)

    def test_default_path_still_uses_shared_cache(self) -> None:
        extract_module_ir_optimized("math", enable_caching=True, enable_parallel=True)
        hits_before = _global_extractor.get_stats()["cache"]["hits"]

        extract_module_ir_optimized("math", enable_caching=True, enable_parallel=True)
        hits_after = _global_extractor.get_stats()["cache"]["hits"]

        self.assertGreaterEqual(hits_after, hits_before + 1)


if __name__ == "__main__":
    unittest.main()
