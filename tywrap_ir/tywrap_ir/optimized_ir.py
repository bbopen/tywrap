"""
Optimized IR Extraction for tywrap
High-performance Python module introspection with caching and parallel processing
"""

from __future__ import annotations

import sys
import time
import threading
import concurrent.futures
from functools import lru_cache, wraps
from typing import Dict, List, Any, Optional, Set, Callable
import weakref
import gc
from dataclasses import dataclass, asdict

# Reuse existing IR classes from ir.py
from .ir import (
    IRParam, IRFunction, IRClass, IRConstant, IRTypeAlias, IRModule,
    _stringify_annotation, _param_kind_to_str, _extract_function, _extract_class,
    _extract_constants, _extract_type_aliases, _collect_metadata
)


class PerformanceTimer:
    """High-precision performance timer for profiling"""
    
    def __init__(self, name: str = ""):
        self.name = name
        self.start_time = 0.0
        self.end_time = 0.0
        
    def __enter__(self):
        self.start_time = time.perf_counter()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = time.perf_counter()
        duration = self.duration
        print(f"⚡ {self.name}: {duration:.2f}ms", file=sys.stderr)
    
    @property
    def duration(self) -> float:
        """Duration in milliseconds"""
        return (self.end_time - self.start_time) * 1000


@dataclass
class ExtractionStats:
    """Statistics about IR extraction performance"""
    total_time: float
    functions_extracted: int
    classes_extracted: int
    constants_extracted: int
    type_aliases_extracted: int
    cache_hits: int
    cache_misses: int
    memory_peak: int  # bytes


class IRCache:
    """Intelligent caching for IR extraction results"""
    
    def __init__(self, max_size: int = 1000):
        self.max_size = max_size
        self._cache: Dict[str, Any] = {}
        self._access_times: Dict[str, float] = {}
        self._lock = threading.RLock()
        self.hits = 0
        self.misses = 0
    
    def _make_key(self, *args) -> str:
        """Create cache key from arguments"""
        return "|".join(str(arg) for arg in args)
    
    def get(self, key: str) -> Optional[Any]:
        """Get item from cache"""
        with self._lock:
            if key in self._cache:
                self._access_times[key] = time.time()
                self.hits += 1
                return self._cache[key]
            
            self.misses += 1
            return None
    
    def set(self, key: str, value: Any) -> None:
        """Set item in cache with LRU eviction"""
        with self._lock:
            # Evict oldest items if at capacity
            if len(self._cache) >= self.max_size and key not in self._cache:
                oldest_key = min(self._access_times.keys(), key=lambda k: self._access_times[k])
                del self._cache[oldest_key]
                del self._access_times[oldest_key]
            
            self._cache[key] = value
            self._access_times[key] = time.time()
    
    def cached_function(self, func: Callable) -> Callable:
        """Decorator for caching function results"""
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Create cache key from function name and arguments
            key_parts = [func.__name__] + list(args) + [f"{k}={v}" for k, v in sorted(kwargs.items())]
            key = self._make_key(*key_parts)
            
            result = self.get(key)
            if result is not None:
                return result
            
            result = func(*args, **kwargs)
            self.set(key, result)
            return result
        
        return wrapper
    
    def clear(self) -> None:
        """Clear all cache entries"""
        with self._lock:
            self._cache.clear()
            self._access_times.clear()
            self.hits = 0
            self.misses = 0
    
    def stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        with self._lock:
            total_requests = self.hits + self.misses
            hit_rate = self.hits / max(1, total_requests)
            
            return {
                "size": len(self._cache),
                "max_size": self.max_size,
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": hit_rate,
            }


# Global cache instance
_global_cache = IRCache()


class OptimizedIRExtractor:
    """High-performance IR extraction with optimization techniques"""
    
    def __init__(self, 
                 enable_caching: bool = True,
                 enable_parallel: bool = True,
                 max_workers: int = 4):
        self.enable_caching = enable_caching
        self.enable_parallel = enable_parallel
        self.max_workers = max_workers
        self._cache = _global_cache if enable_caching else None
        self._stats = ExtractionStats(0, 0, 0, 0, 0, 0, 0, 0)
    
    def extract_module_ir_optimized(self,
                                   module_name: str,
                                   *,
                                   ir_version: str = "0.1.0",
                                   include_private: bool = False) -> Dict[str, Any]:
        """
        Extract IR with performance optimizations
        """
        with PerformanceTimer(f"IR extraction for {module_name}"):
            return self._extract_with_optimizations(module_name, ir_version, include_private)
    
    def _extract_with_optimizations(self, 
                                   module_name: str,
                                   ir_version: str,
                                   include_private: bool) -> Dict[str, Any]:
        """Internal optimized extraction"""
        
        # Try cache first
        if self._cache:
            cache_key = self._cache._make_key(module_name, ir_version, include_private)
            cached_result = self._cache.get(cache_key)
            if cached_result is not None:
                print(f"🎯 Cache HIT for {module_name}", file=sys.stderr)
                return cached_result
        
        # Import module with error handling
        try:
            import importlib
            module = importlib.import_module(module_name)
        except ImportError as e:
            raise ImportError(f"Failed to import module {module_name}: {e}")
        
        # Extract components in parallel if enabled
        if self.enable_parallel and self.max_workers > 1:
            result = self._extract_parallel(module, module_name, ir_version, include_private)
        else:
            result = self._extract_sequential(module, module_name, ir_version, include_private)
        
        # Cache result
        if self._cache:
            self._cache.set(cache_key, result)
        
        return result
    
    def _extract_parallel(self,
                         module: Any,
                         module_name: str,
                         ir_version: str,
                         include_private: bool) -> Dict[str, Any]:
        """Extract IR components in parallel"""
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit all extraction tasks
            futures = {
                'functions': executor.submit(self._extract_functions_optimized, module, module_name, include_private),
                'classes': executor.submit(self._extract_classes_optimized, module, module_name, include_private),
                'constants': executor.submit(self._extract_constants_optimized, module, module_name, include_private),
                'type_aliases': executor.submit(self._extract_type_aliases_optimized, module, module_name, include_private),
                'metadata': executor.submit(_collect_metadata, module_name, ir_version),
            }
            
            # Collect results
            results = {}
            for key, future in futures.items():
                try:
                    results[key] = future.result(timeout=30)  # 30 second timeout
                except concurrent.futures.TimeoutError:
                    print(f"⚠️  Timeout extracting {key} from {module_name}", file=sys.stderr)
                    results[key] = [] if key != 'metadata' else {}
                except Exception as e:
                    print(f"❌ Error extracting {key} from {module_name}: {e}", file=sys.stderr)
                    results[key] = [] if key != 'metadata' else {}
        
        # Build IR module
        ir_module = IRModule(
            ir_version=ir_version,
            module=module_name,
            functions=results.get('functions', []),
            classes=results.get('classes', []),
            constants=results.get('constants', []),
            type_aliases=results.get('type_aliases', []),
            metadata=results.get('metadata', {}),
            warnings=[]  # TODO: Collect warnings from parallel execution
        )
        
        # Update statistics
        self._stats.functions_extracted += len(ir_module.functions)
        self._stats.classes_extracted += len(ir_module.classes)
        self._stats.constants_extracted += len(ir_module.constants)
        self._stats.type_aliases_extracted += len(ir_module.type_aliases)
        
        return asdict(ir_module)
    
    def _extract_sequential(self,
                           module: Any,
                           module_name: str,
                           ir_version: str,
                           include_private: bool) -> Dict[str, Any]:
        """Extract IR components sequentially (fallback)"""
        
        with PerformanceTimer("Sequential extraction"):
            functions = self._extract_functions_optimized(module, module_name, include_private)
            classes = self._extract_classes_optimized(module, module_name, include_private)
            constants = self._extract_constants_optimized(module, module_name, include_private)
            type_aliases = self._extract_type_aliases_optimized(module, module_name, include_private)
            metadata = _collect_metadata(module_name, ir_version)
        
        ir_module = IRModule(
            ir_version=ir_version,
            module=module_name,
            functions=functions,
            classes=classes,
            constants=constants,
            type_aliases=type_aliases,
            metadata=metadata,
            warnings=[]
        )
        
        return asdict(ir_module)
    
    @lru_cache(maxsize=128)
    def _get_module_members(self, module_name: str) -> List[str]:
        """Cached module member listing"""
        import importlib
        module = importlib.import_module(module_name)
        return dir(module)
    
    def _extract_functions_optimized(self,
                                   module: Any,
                                   module_name: str,
                                   include_private: bool) -> List[IRFunction]:
        """Optimized function extraction"""
        import inspect
        
        functions: List[IRFunction] = []
        members = self._get_module_members(module_name)
        
        # Pre-filter members to reduce attribute access
        function_names = []
        for name in members:
            if not include_private and name.startswith("_"):
                continue
            
            try:
                value = getattr(module, name, None)
                if inspect.isfunction(value) or inspect.isbuiltin(value):
                    function_names.append(name)
            except (AttributeError, ImportError):
                continue
        
        # Extract functions with caching
        for name in function_names:
            try:
                value = getattr(module, name)
                if self._cache:
                    cached_func = self._cache.cached_function(_extract_function)
                    func_ir = cached_func(value, f"{module_name}.{name}")
                else:
                    func_ir = _extract_function(value, f"{module_name}.{name}")
                
                if func_ir is not None:
                    functions.append(func_ir)
            except Exception as e:
                print(f"⚠️  Error extracting function {name}: {e}", file=sys.stderr)
                continue
        
        return functions
    
    def _extract_classes_optimized(self,
                                  module: Any,
                                  module_name: str,
                                  include_private: bool) -> List[IRClass]:
        """Optimized class extraction"""
        import inspect
        
        classes: List[IRClass] = []
        members = self._get_module_members(module_name)
        
        # Pre-filter for classes defined in this module
        class_names = []
        for name in members:
            if not include_private and name.startswith("_"):
                continue
            
            try:
                value = getattr(module, name, None)
                if (inspect.isclass(value) and 
                    getattr(value, "__module__", None) == module.__name__):
                    class_names.append(name)
            except (AttributeError, ImportError):
                continue
        
        # Extract classes with caching
        for name in class_names:
            try:
                value = getattr(module, name)
                if self._cache:
                    cached_class = self._cache.cached_function(_extract_class)
                    class_ir = cached_class(value, module_name, include_private)
                else:
                    class_ir = _extract_class(value, module_name, include_private)
                
                if class_ir is not None:
                    classes.append(class_ir)
            except Exception as e:
                print(f"⚠️  Error extracting class {name}: {e}", file=sys.stderr)
                continue
        
        return classes
    
    def _extract_constants_optimized(self,
                                    module: Any,
                                    module_name: str,
                                    include_private: bool) -> List[IRConstant]:
        """Optimized constant extraction with caching"""
        if self._cache:
            cached_constants = self._cache.cached_function(_extract_constants)
            return cached_constants(module, module_name, include_private)
        else:
            return _extract_constants(module, module_name, include_private)
    
    def _extract_type_aliases_optimized(self,
                                       module: Any,
                                       module_name: str,
                                       include_private: bool) -> List[IRTypeAlias]:
        """Optimized type alias extraction with caching"""
        if self._cache:
            cached_aliases = self._cache.cached_function(_extract_type_aliases)
            return cached_aliases(module, module_name, include_private)
        else:
            return _extract_type_aliases(module, module_name, include_private)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get extraction statistics"""
        stats_dict = asdict(self._stats)
        if self._cache:
            stats_dict["cache"] = self._cache.stats()
        return stats_dict
    
    def clear_cache(self) -> None:
        """Clear extraction cache"""
        if self._cache:
            self._cache.clear()


# Global optimized extractor instance
_global_extractor = OptimizedIRExtractor()


def extract_module_ir_optimized(module_name: str,
                                *,
                                ir_version: str = "0.1.0",
                                include_private: bool = False,
                                enable_caching: bool = True,
                                enable_parallel: bool = True) -> Dict[str, Any]:
    """
    Optimized IR extraction with caching and parallel processing
    
    Args:
        module_name: Name of the module to extract
        ir_version: IR format version
        include_private: Include private members
        enable_caching: Enable result caching
        enable_parallel: Enable parallel extraction
    
    Returns:
        Dictionary containing the IR module data
    """
    
    # Configure extractor if needed
    if not enable_caching and _global_extractor.enable_caching:
        _global_extractor._cache = None
        _global_extractor.enable_caching = False
    
    if not enable_parallel and _global_extractor.enable_parallel:
        _global_extractor.enable_parallel = False
    
    return _global_extractor.extract_module_ir_optimized(
        module_name,
        ir_version=ir_version,
        include_private=include_private
    )


def benchmark_ir_extraction(module_names: List[str],
                           iterations: int = 3,
                           enable_optimizations: bool = True) -> Dict[str, Any]:
    """
    Benchmark IR extraction performance
    
    Args:
        module_names: List of module names to benchmark
        iterations: Number of iterations per module
        enable_optimizations: Whether to enable optimizations
    
    Returns:
        Benchmark results
    """
    
    results = {
        "modules": {},
        "summary": {
            "total_modules": len(module_names),
            "iterations": iterations,
            "optimizations_enabled": enable_optimizations,
        }
    }
    
    extractor = OptimizedIRExtractor(
        enable_caching=enable_optimizations,
        enable_parallel=enable_optimizations
    )
    
    for module_name in module_names:
        module_times = []
        module_results = []
        
        for i in range(iterations):
            if i == 0 or not enable_optimizations:
                # Clear cache for first iteration or when optimizations disabled
                extractor.clear_cache()
                gc.collect()  # Force garbage collection
            
            start_time = time.perf_counter()
            try:
                result = extractor.extract_module_ir_optimized(module_name)
                module_results.append(result)
                end_time = time.perf_counter()
                duration = (end_time - start_time) * 1000  # milliseconds
                module_times.append(duration)
                
                print(f"📊 {module_name} iteration {i+1}: {duration:.2f}ms", file=sys.stderr)
                
            except Exception as e:
                print(f"❌ Error benchmarking {module_name}: {e}", file=sys.stderr)
                continue
        
        if module_times:
            results["modules"][module_name] = {
                "times": module_times,
                "min_time": min(module_times),
                "max_time": max(module_times),
                "avg_time": sum(module_times) / len(module_times),
                "speedup": module_times[0] / min(module_times) if len(module_times) > 1 else 1.0,
                "functions_count": len(module_results[-1]["functions"]) if module_results else 0,
                "classes_count": len(module_results[-1]["classes"]) if module_results else 0,
            }
    
    # Overall statistics
    all_times = [time for module_data in results["modules"].values() for time in module_data["times"]]
    if all_times:
        results["summary"].update({
            "total_extractions": len(all_times),
            "min_time": min(all_times),
            "max_time": max(all_times),
            "avg_time": sum(all_times) / len(all_times),
            "total_time": sum(all_times),
        })
    
    # Cache statistics
    cache_stats = extractor.get_stats()
    results["cache_stats"] = cache_stats
    
    return results


if __name__ == "__main__":
    import json
    
    # Example usage and benchmarking
    test_modules = ["math", "json", "os", "sys", "time"]
    
    print("🚀 Benchmarking optimized IR extraction", file=sys.stderr)
    
    # Benchmark with optimizations
    optimized_results = benchmark_ir_extraction(
        test_modules, 
        iterations=3, 
        enable_optimizations=True
    )
    
    print("\n📈 Benchmark Results (Optimized):", file=sys.stderr)
    for module, data in optimized_results["modules"].items():
        print(f"  {module}: {data['avg_time']:.2f}ms avg, {data['speedup']:.2f}x speedup", file=sys.stderr)
    
    # Output results as JSON for analysis
    print(json.dumps(optimized_results, indent=2))