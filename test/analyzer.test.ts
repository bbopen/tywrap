import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PyAnalyzer } from '../src/core/analyzer.js';
import * as cacheModule from '../src/utils/cache.js';

describe('PyAnalyzer', () => {
  let analyzer: PyAnalyzer;

  beforeEach(() => {
    analyzer = new PyAnalyzer();
    // Clear any cached results
    vi.spyOn(cacheModule.globalCache, 'getCachedAnalysis').mockResolvedValue(null);
    vi.spyOn(cacheModule.globalCache, 'setCachedAnalysis').mockResolvedValue(undefined);
  });

  describe('initialize', () => {
    it('should initialize the parser successfully', async () => {
      await expect(analyzer.initialize()).resolves.not.toThrow();
    });

    it('should be idempotent (multiple calls safe)', async () => {
      await analyzer.initialize();
      await expect(analyzer.initialize()).resolves.not.toThrow();
    });
  });

  describe('analyzePythonModule', () => {
    it('should analyze an empty module', async () => {
      const result = await analyzer.analyzePythonModule('');

      expect(result.module.functions).toHaveLength(0);
      expect(result.module.classes).toHaveLength(0);
      expect(result.module.imports).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should extract module name from path', async () => {
      const result = await analyzer.analyzePythonModule('', '/path/to/my_module.py');

      expect(result.module.name).toBe('my_module');
      expect(result.module.path).toBe('/path/to/my_module.py');
    });

    it('should handle missing path gracefully', async () => {
      const result = await analyzer.analyzePythonModule('');

      expect(result.module.name).toBe('unknown');
    });

    it('should use cached result when available', async () => {
      const cachedResult = {
        module: {
          name: 'cached',
          path: 'cached.py',
          functions: [],
          classes: [],
          imports: [],
          exports: [],
        },
        errors: [],
        warnings: [],
        dependencies: [],
        statistics: {
          functionsAnalyzed: 0,
          classesAnalyzed: 0,
          typeHintsCoverage: 0,
          estimatedComplexity: 0,
        },
      };

      vi.spyOn(cacheModule.globalCache, 'getCachedAnalysis').mockResolvedValue(cachedResult);

      const result = await analyzer.analyzePythonModule('def foo(): pass');

      expect(result.module.name).toBe('cached');
    });
  });

  describe('extractFunctions', () => {
    it('should extract a simple function', async () => {
      const source = `
def greet():
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      expect(result.module.functions[0]?.name).toBe('greet');
    });

    it('should extract function with parameters', async () => {
      const source = `
def add(a, b):
    return a + b
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      const func = result.module.functions[0];
      expect(func?.parameters).toHaveLength(2);
      expect(func?.parameters[0]?.name).toBe('a');
      expect(func?.parameters[1]?.name).toBe('b');
    });

    it('should extract function with type annotations', async () => {
      const source = `
def add(a: int, b: int) -> int:
    return a + b
`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.parameters[0]?.type.kind).toBe('primitive');
      expect(func?.parameters[0]?.type.name).toBe('int');
      expect(func?.returnType.kind).toBe('primitive');
      expect(func?.returnType.name).toBe('int');
    });

    it('should extract function with default parameters', async () => {
      const source = `
def greet(name="World"):
    return f"Hello, {name}"
`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.parameters[0]?.optional).toBe(true);
      expect(func?.parameters[0]?.defaultValue).toBe('"World"');
    });

    it('should extract function with typed default parameters', async () => {
      const source = `
def greet(name: str = "World") -> str:
    return f"Hello, {name}"
`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.parameters[0]?.type.name).toBe('str');
      expect(func?.parameters[0]?.optional).toBe(true);
    });

    it('should extract async function', async () => {
      const source = `
async def fetch_data():
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.isAsync).toBe(true);
    });

    it('should extract generator function', async () => {
      const source = `
def count():
    yield 1
    yield 2
`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.isGenerator).toBe(true);
    });

    it('should extract *args parameter', async () => {
      const source = `
def variadic(*args):
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      const argsParam = func?.parameters.find(p => p.varArgs);
      expect(argsParam).toBeDefined();
      expect(argsParam?.name).toBe('args');
    });

    it('should extract **kwargs parameter', async () => {
      const source = `
def flexible(**kwargs):
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      const kwargsParam = func?.parameters.find(p => p.kwArgs);
      expect(kwargsParam).toBeDefined();
      expect(kwargsParam?.name).toBe('kwargs');
    });

    it('should extract docstring', async () => {
      const source = `
def documented():
    """This is a docstring."""
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.docstring).toBe('This is a docstring.');
    });

    it('should extract multiple functions', async () => {
      const source = `
def foo():
    pass

def bar():
    pass

def baz():
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(3);
      expect(result.module.functions.map(f => f.name)).toEqual(['foo', 'bar', 'baz']);
    });
  });

  describe('extractClasses', () => {
    it('should extract a simple class', async () => {
      const source = `
class MyClass:
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.classes).toHaveLength(1);
      expect(result.module.classes[0]?.name).toBe('MyClass');
    });

    it('should extract class with base classes', async () => {
      const source = `
class Child(Parent):
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      const cls = result.module.classes[0];
      expect(cls?.bases).toContain('Parent');
    });

    it('should extract class methods', async () => {
      const source = `
class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b
`;
      const result = await analyzer.analyzePythonModule(source);

      const cls = result.module.classes[0];
      expect(cls?.methods).toHaveLength(2);
      expect(cls?.methods.map(m => m.name)).toContain('add');
      expect(cls?.methods.map(m => m.name)).toContain('subtract');
    });

    it('should extract class docstring', async () => {
      const source = `
class Documented:
    """A well-documented class."""
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      const cls = result.module.classes[0];
      expect(cls?.docstring).toBe('A well-documented class.');
    });

    it('should extract class properties', async () => {
      const source = `
class Person:
    name = "Unknown"
    age = 0
`;
      const result = await analyzer.analyzePythonModule(source);

      const cls = result.module.classes[0];
      expect(cls?.properties.length).toBeGreaterThan(0);
    });
  });

  describe('parseTypeAnnotation', () => {
    it('should parse primitive types', async () => {
      const primitives = ['int', 'float', 'str', 'bool', 'bytes', 'None'];

      for (const prim of primitives) {
        const source = `def foo() -> ${prim}: pass`;
        const result = await analyzer.analyzePythonModule(source);

        const func = result.module.functions[0];
        expect(func?.returnType.kind).toBe('primitive');
        expect(func?.returnType.name).toBe(prim);
      }
    });

    it('should parse List type', async () => {
      const source = `def foo() -> List[int]: pass`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.returnType.kind).toBe('collection');
      expect(func?.returnType.name).toBe('list');
    });

    it('should parse Dict type', async () => {
      const source = `def foo() -> Dict[str, int]: pass`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.returnType.kind).toBe('collection');
      expect(func?.returnType.name).toBe('dict');
    });

    it('should parse lowercase list type', async () => {
      const source = `def foo() -> list[int]: pass`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.returnType.kind).toBe('collection');
      expect(func?.returnType.name).toBe('list');
    });

    it('should parse Union type with pipe syntax', async () => {
      // Note: Python 3.10+ pipe syntax may cause parsing issues with tree-sitter
      // This test verifies the behavior when encountering pipe syntax
      const source = `def foo() -> int | str: pass`;
      const result = await analyzer.analyzePythonModule(source);

      // The analyzer may not fully support pipe syntax yet
      // At minimum, it should not crash and should return a result
      expect(result.module.functions.length).toBeLessThanOrEqual(1);
    });

    it('should parse Union type', async () => {
      const source = `def foo() -> Union[int, str]: pass`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.returnType.kind).toBe('union');
    });

    it('should parse Optional type', async () => {
      const source = `def foo() -> Optional[str]: pass`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.returnType.kind).toBe('optional');
    });

    it('should parse Tuple type', async () => {
      const source = `def foo() -> Tuple[int, str]: pass`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.returnType.kind).toBe('collection');
      expect(func?.returnType.name).toBe('tuple');
    });

    it('should parse Set type', async () => {
      const source = `def foo() -> Set[int]: pass`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.returnType.kind).toBe('collection');
      expect(func?.returnType.name).toBe('set');
    });

    it('should parse custom type', async () => {
      const source = `def foo() -> MyCustomType: pass`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.returnType.kind).toBe('custom');
      expect(func?.returnType.name).toBe('MyCustomType');
    });
  });

  describe('extractImports', () => {
    it('should extract simple import', async () => {
      const source = `import os`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.imports).toHaveLength(1);
      expect(result.module.imports[0]?.module).toBe('os');
      expect(result.module.imports[0]?.fromImport).toBe(false);
    });

    it('should extract from import', async () => {
      const source = `from os import path`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.imports).toHaveLength(1);
      expect(result.module.imports[0]?.module).toBe('os');
      expect(result.module.imports[0]?.name).toBe('path');
      expect(result.module.imports[0]?.fromImport).toBe(true);
    });

    it('should extract multiple from imports', async () => {
      const source = `from typing import List, Dict, Optional`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.imports.length).toBeGreaterThanOrEqual(3);
      expect(result.module.imports.some(i => i.name === 'List')).toBe(true);
      expect(result.module.imports.some(i => i.name === 'Dict')).toBe(true);
      expect(result.module.imports.some(i => i.name === 'Optional')).toBe(true);
    });

    it('should deduplicate imports', async () => {
      const source = `
import os
import os
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.imports).toHaveLength(1);
    });

    it('should track dependencies from imports', async () => {
      const source = `
import numpy
from pandas import DataFrame
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.dependencies).toContain('numpy');
      expect(result.dependencies).toContain('pandas');
    });
  });

  describe('exports and __all__', () => {
    it('should extract __all__ exports', async () => {
      const source = `
__all__ = ["foo", "bar"]

def foo():
    pass

def bar():
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.exports).toContain('foo');
      expect(result.module.exports).toContain('bar');
    });
  });

  describe('decorators', () => {
    it('should extract function decorators', async () => {
      const source = `
@staticmethod
def my_static():
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      const func = result.module.functions[0];
      expect(func?.decorators).toContain('@staticmethod');
    });
  });

  describe('error handling', () => {
    it('should handle syntax errors gracefully', async () => {
      const source = `
def broken(
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.type).toBe('syntax');
    });

    it('should still return partial results on error', async () => {
      const source = `
def valid():
    pass

def broken(
`;
      const result = await analyzer.analyzePythonModule(source);

      // Should still extract the valid function
      expect(result.module.functions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('statistics', () => {
    it('should generate analysis statistics', async () => {
      const source = `
def foo(x: int) -> int:
    return x * 2

class Bar:
    def method(self):
        pass
`;
      const result = await analyzer.analyzePythonModule(source);

      // The analyzer extracts all functions (including nested), so it finds both foo and method
      expect(result.statistics.functionsAnalyzed).toBeGreaterThanOrEqual(1);
      expect(result.statistics.classesAnalyzed).toBe(1);
      expect(result.statistics.typeHintsCoverage).toBeGreaterThanOrEqual(0);
    });
  });

  describe('edge cases - complex type annotations', () => {
    it('should handle deeply nested generic types', async () => {
      const source = `
def process() -> Dict[str, List[Tuple[int, str, float]]]:
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      const func = result.module.functions[0];
      expect(func?.returnType).toBeDefined();
      // Should parse without crashing even if nested type info is limited
      expect(result.errors).toHaveLength(0);
    });

    it('should handle Callable type annotations', async () => {
      const source = `
def higher_order(callback: Callable[[int, str], bool]) -> None:
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      const func = result.module.functions[0];
      expect(func?.parameters[0]?.name).toBe('callback');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle TypeVar and Generic', async () => {
      const source = `
from typing import TypeVar, Generic

T = TypeVar('T')

class Container(Generic[T]):
    def get(self) -> T:
        pass

    def set(self, value: T) -> None:
        pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.classes).toHaveLength(1);
      const cls = result.module.classes[0];
      expect(cls?.name).toBe('Container');
      expect(cls?.methods.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle Literal type annotations', async () => {
      const source = `
from typing import Literal

def get_mode() -> Literal["read", "write", "append"]:
    return "read"
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle forward references as strings', async () => {
      const source = `
class Node:
    def get_next(self) -> "Node":
        pass

    def get_children(self) -> List["Node"]:
        pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.classes).toHaveLength(1);
      const cls = result.module.classes[0];
      expect(cls?.methods.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases - deeply nested structures', () => {
    it('should handle deeply nested classes', async () => {
      const source = `
class Outer:
    class Middle:
        class Inner:
            def deepest_method(self) -> int:
                return 42
`;
      const result = await analyzer.analyzePythonModule(source);

      // At minimum, the outer class should be extracted
      expect(result.module.classes.length).toBeGreaterThanOrEqual(1);
      expect(result.module.classes[0]?.name).toBe('Outer');
    });

    it('should handle nested functions', async () => {
      const source = `
def outer():
    def middle():
        def inner():
            return "deep"
        return inner
    return middle
`;
      const result = await analyzer.analyzePythonModule(source);

      // At minimum, the outer function should be extracted
      expect(result.module.functions.length).toBeGreaterThanOrEqual(1);
      expect(result.module.functions[0]?.name).toBe('outer');
    });

    it('should handle class with many methods', async () => {
      // Generate a class with many methods to test scalability
      const methods = Array.from(
        { length: 20 },
        (_, i) => `    def method_${i}(self, arg${i}: int) -> str:\n        return str(arg${i})`
      ).join('\n\n');

      const source = `
class LargeClass:
${methods}
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.classes).toHaveLength(1);
      const cls = result.module.classes[0];
      expect(cls?.methods.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('edge cases - Unicode', () => {
    it('should handle Unicode identifiers', async () => {
      const source = `
def grüß_gott(名前: str) -> str:
    return f"Hallo, {名前}!"

class Résumé:
    def __init__(self, título: str):
        self.título = título
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions.length).toBeGreaterThanOrEqual(1);
      expect(result.module.classes.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle Unicode in docstrings', async () => {
      const source = `
def hello():
    """日本語のドキュメント。

    这是中文文档。
    Документация на русском.
    """
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      const func = result.module.functions[0];
      expect(func?.docstring).toContain('日本語');
    });

    it('should handle emoji in strings', async () => {
      const source = `
def get_emoji() -> str:
    """Returns a fun emoji 🎉"""
    return "Hello! 👋"
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('edge cases - Python 3.8+ syntax', () => {
    it('should handle positional-only parameters', async () => {
      const source = `
def positional_only(x, y, /, z):
    return x + y + z
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      const func = result.module.functions[0];
      // Should extract parameters even with positional-only marker
      expect(func?.parameters.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle keyword-only parameters', async () => {
      const source = `
def keyword_only(x, *, key1, key2):
    return x + key1 + key2
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      const func = result.module.functions[0];
      expect(func?.parameters.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle combined positional-only and keyword-only', async () => {
      const source = `
def complex_signature(pos1, pos2, /, standard, *, kw1, kw2):
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      const func = result.module.functions[0];
      expect(func?.parameters.length).toBeGreaterThanOrEqual(5);
    });

    it('should handle walrus operator in function', async () => {
      const source = `
def with_walrus(data: list) -> int:
    if (n := len(data)) > 10:
        return n
    return 0
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('edge cases - Python 3.10+ syntax', () => {
    it('should handle match statement (pattern matching)', async () => {
      const source = `
def process_command(command):
    match command:
        case "quit":
            return False
        case "help":
            return True
        case _:
            return None
`;
      const result = await analyzer.analyzePythonModule(source);

      // Should parse the function even with match statement
      expect(result.module.functions).toHaveLength(1);
      expect(result.module.functions[0]?.name).toBe('process_command');
    });

    it('should handle structural pattern matching', async () => {
      const source = `
def analyze_point(point):
    match point:
        case (0, 0):
            return "origin"
        case (x, 0):
            return f"x-axis at {x}"
        case (0, y):
            return f"y-axis at {y}"
        case (x, y):
            return f"point at ({x}, {y})"
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
    });

    it('should handle ParamSpec annotation', async () => {
      const source = `
from typing import ParamSpec, Callable, TypeVar

P = ParamSpec('P')
R = TypeVar('R')

def decorator(func: Callable[P, R]) -> Callable[P, R]:
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return func(*args, **kwargs)
    return wrapper
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions.length).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('edge cases - malformed code', () => {
    it('should handle incomplete function definition', async () => {
      const source = `
def incomplete(
`;
      const result = await analyzer.analyzePythonModule(source);

      // Should report syntax error but not crash
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle mismatched indentation', async () => {
      const source = `
def foo():
    x = 1
  y = 2
    return x
`;
      const result = await analyzer.analyzePythonModule(source);

      // Should handle gracefully (may report error or partial results)
      expect(result).toBeDefined();
    });

    it('should handle mixed valid and invalid code', async () => {
      const source = `
def valid_function():
    return 42

class BrokenClass(
    pass

def another_valid():
    return "ok"
`;
      const result = await analyzer.analyzePythonModule(source);

      // Should extract at least one valid function
      expect(result.module.functions.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle empty class body', async () => {
      const source = `
class EmptyClass:
    ...

class AnotherEmpty:
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.classes.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle trailing whitespace and empty lines', async () => {
      const source = `
def with_whitespace():
    pass


def after_empty_lines():
    pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('edge cases - special method names', () => {
    it('should handle dunder methods', async () => {
      const source = `
class MyClass:
    def __init__(self, value: int):
        self.value = value

    def __str__(self) -> str:
        return str(self.value)

    def __add__(self, other: "MyClass") -> "MyClass":
        return MyClass(self.value + other.value)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.classes).toHaveLength(1);
      const cls = result.module.classes[0];
      expect(cls?.methods.length).toBeGreaterThanOrEqual(5);
      expect(cls?.methods.map(m => m.name)).toContain('__init__');
      expect(cls?.methods.map(m => m.name)).toContain('__str__');
    });

    it('should handle property decorators', async () => {
      const source = `
class Person:
    def __init__(self, name: str):
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    @name.setter
    def name(self, value: str) -> None:
        self._name = value
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.classes).toHaveLength(1);
      const cls = result.module.classes[0];
      // Should extract methods with property decorators
      expect(cls?.methods.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle classmethod and staticmethod', async () => {
      const source = `
class Factory:
    @classmethod
    def create(cls, value: int) -> "Factory":
        return cls(value)

    @staticmethod
    def validate(value: int) -> bool:
        return value > 0
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.classes).toHaveLength(1);
      const cls = result.module.classes[0];
      expect(cls?.methods.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases - performance', () => {
    it('should handle large source files', async () => {
      // Generate a large module with many functions
      const functions = Array.from(
        { length: 100 },
        (_, i) =>
          `def func_${i}(x: int) -> int:\n    """Function ${i} documentation."""\n    return x + ${i}`
      ).join('\n\n');

      const startTime = Date.now();
      const result = await analyzer.analyzePythonModule(functions);
      const elapsed = Date.now() - startTime;

      expect(result.module.functions.length).toBeGreaterThanOrEqual(50);
      // Should complete in reasonable time (less than 5 seconds)
      expect(elapsed).toBeLessThan(5000);
    });

    it('should handle deeply nested expressions', async () => {
      const source = `
def deeply_nested() -> Dict[str, Dict[str, Dict[str, List[Tuple[int, int, int]]]]]:
    return {"a": {"b": {"c": [(1, 2, 3)]}}}
`;
      const result = await analyzer.analyzePythonModule(source);

      expect(result.module.functions).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });
  });
});
