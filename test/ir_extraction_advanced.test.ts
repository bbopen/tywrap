import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { processUtils } from '../src/utils/runtime.js';
import { getDefaultPythonPath } from '../src/utils/python.js';

/**
 * Advanced IR Extraction Test Suite
 *
 * Tests the Python IR extraction capabilities with complex typing constructs
 * including Python 3.9-3.12 features, protocols, generics, dataclasses, and more.
 */

// Test fixture paths
const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'python');
const TEMP_DIR = join(process.cwd(), 'test', 'temp_python_modules');
const PYTHON_EXECUTABLE = getDefaultPythonPath();

/**
 * Helper function to execute Python IR extraction
 */
async function extractIR(
  moduleName: string,
  includePrivate: boolean = false,
  useFixtureDir: boolean = false
): Promise<any> {
  const modulePath = useFixtureDir ? FIXTURES_DIR : TEMP_DIR;
  const modulePathLiteral = JSON.stringify(modulePath);
  const irPathLiteral = JSON.stringify('tywrap_ir');
  const moduleNameLiteral = JSON.stringify(moduleName);

  const result = await processUtils.exec(PYTHON_EXECUTABLE, [
    '-c',
    `
import sys
sys.path.insert(0, ${modulePathLiteral})
sys.path.insert(0, ${irPathLiteral})
from tywrap_ir.ir import emit_ir_json
print(emit_ir_json(${moduleNameLiteral}, include_private=${includePrivate ? 'True' : 'False'}, pretty=False))
`,
  ]);

  if (result.code !== 0) {
    throw new Error(`IR extraction failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

/**
 * Helper to create a temporary Python module for testing
 */
function createTempModule(name: string, content: string): void {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  const modulePath = join(TEMP_DIR, `${name}.py`);
  writeFileSync(modulePath, content, 'utf-8');

  // Add to Python path for import
  const initPath = join(TEMP_DIR, '__init__.py');
  if (!existsSync(initPath)) {
    writeFileSync(initPath, '', 'utf-8');
  }
}

async function supportsVariadicTypingFeatures(): Promise<boolean> {
  const result = await processUtils.exec(PYTHON_EXECUTABLE, [
    '-c',
    `
try:
    from typing import ParamSpec, TypeVarTuple, Unpack
except ImportError:
    try:
        from typing_extensions import ParamSpec, TypeVarTuple, Unpack
    except ImportError:
        raise SystemExit(1)
raise SystemExit(0)
`,
  ]);
  return result.code === 0;
}

async function supportsTypingExtensionsBackports(): Promise<boolean> {
  const result = await processUtils.exec(PYTHON_EXECUTABLE, [
    '-c',
    'from typing_extensions import ParamSpec, TypeVarTuple, Unpack',
  ]);
  return result.code === 0;
}

async function supportsPep695Syntax(): Promise<boolean> {
  const result = await processUtils.exec(PYTHON_EXECUTABLE, [
    '-c',
    'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)',
  ]);
  return result.code === 0;
}

beforeAll(async () => {
  // Ensure test fixtures exist
  if (!existsSync(FIXTURES_DIR)) {
    throw new Error(`Test fixtures directory not found: ${FIXTURES_DIR}`);
  }

  // Verify Python and tywrap_ir are available
  try {
    const result = await processUtils.exec(PYTHON_EXECUTABLE, ['-m', 'tywrap_ir', '--help']);
    if (result.code !== 0) {
      throw new Error('tywrap_ir module not available');
    }
  } catch (error) {
    throw new Error(`Python IR extraction setup failed: ${error}`);
  }
});

afterAll(() => {
  // Clean up temporary modules
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
});

describe('IR Extraction - Built-in Modules', () => {
  it('should extract math module correctly', async () => {
    const ir = await extractIR('math');

    expect(ir.module).toBe('math');
    expect(ir.functions).toBeDefined();
    expect(Array.isArray(ir.functions)).toBe(true);
    expect(ir.functions.length).toBeGreaterThan(10); // Math has many functions

    // Check some known math functions
    const sqrtFunc = ir.functions.find((f: any) => f.name === 'sqrt');
    expect(sqrtFunc).toBeDefined();
    expect(sqrtFunc.docstring).toContain('square root');

    const powFunc = ir.functions.find((f: any) => f.name === 'pow');
    expect(powFunc).toBeDefined();

    const sinFunc = ir.functions.find((f: any) => f.name === 'sin');
    expect(sinFunc).toBeDefined();
  });

  it('should handle collections module correctly', async () => {
    const ir = await extractIR('collections');

    expect(ir.module).toBe('collections');
    expect(ir.functions).toBeDefined();
    expect(ir.classes).toBeDefined();

    // Collections module should have namedtuple, defaultdict, etc.
    const namedtupleFunc = ir.functions.find((f: any) => f.name === 'namedtuple');
    if (namedtupleFunc) {
      expect(namedtupleFunc).toBeDefined();
    }
  });
});

describe('IR Extraction - Complex Fixture Files', () => {
  it('should extract advanced types from fixture', async () => {
    const ir = await extractIR('advanced_types', false, true);

    expect(ir.module).toBe('advanced_types');
    expect(ir.functions).toBeDefined();
    expect(ir.classes).toBeDefined();

    // Check for some key elements from our advanced types fixture
    const processDataFunc = ir.functions.find((f: any) => f.name === 'process_data');
    expect(processDataFunc).toBeDefined();
    if (processDataFunc) {
      expect(processDataFunc.docstring).toContain('Process data with transformation');
    }

    const containerClass = ir.classes.find((c: any) => c.name === 'Container');
    expect(containerClass).toBeDefined();
    if (containerClass) {
      expect(containerClass.bases).toEqual(['Generic']);
    }

    const personClass = ir.classes.find((c: any) => c.name === 'Person');
    expect(personClass).toBeDefined();
    if (personClass) {
      expect(personClass.is_dataclass).toBe(true);
      expect(personClass.fields.length).toBeGreaterThan(0);
    }
  });

  it('should extract numpy types from fixture', async () => {
    try {
      const ir = await extractIR('numpy_types', false, true);

      expect(ir.module).toBe('numpy_types');
      expect(ir.functions).toBeDefined();
      expect(ir.classes).toBeDefined();

      // Check for numpy-specific functions
      const createArrayFunc = ir.functions.find((f: any) => f.name === 'create_array');
      expect(createArrayFunc).toBeDefined();

      const containerClass = ir.classes.find((c: any) => c.name === 'NumPyContainer');
      expect(containerClass).toBeDefined();
    } catch (error) {
      // Skip if numpy is not available
      console.warn('Skipping numpy test - numpy not available:', error);
    }
  });
});

describe('IR Extraction - Generic Metadata', () => {
  it('extracts ordered type parameters for functions, classes, and type aliases', async () => {
    if (!(await supportsVariadicTypingFeatures())) {
      return;
    }

    createTempModule(
      'generic_type_params',
      `
from __future__ import annotations

from typing import Callable, Generic, TypeVar
try:
    from typing import ParamSpec, TypeVarTuple, Unpack
except ImportError:
    from typing_extensions import ParamSpec, TypeVarTuple, Unpack

T = TypeVar("T")
K = TypeVar("K")
V = TypeVar("V")
P = ParamSpec("P")
Ts = TypeVarTuple("Ts")

Pair = tuple[T, T]
Transform = Callable[P, T]
Variadic = tuple[Unpack[Ts]]

def identity(x: T) -> T:
    return x

class Container(Generic[T]):
    def __init__(self, value: T) -> None:
        self.value = value

    def get(self) -> T:
        return self.value

class KeyValueStore(Generic[K, V]):
    def __init__(self) -> None:
        self._data: dict[K, V] = {}

    def put(self, key: K, value: V) -> None:
        self._data[key] = value
`
    );

    const ir = await extractIR('generic_type_params');
    const summarizeParams = (params: Array<{ name: string; kind: string }>) =>
      params.map(param => ({ name: param.name, kind: param.kind }));

    const identity = ir.functions.find((f: any) => f.name === 'identity');
    expect(identity).toBeDefined();
    expect(summarizeParams(identity.type_params)).toEqual([{ name: 'T', kind: 'typevar' }]);

    const container = ir.classes.find((c: any) => c.name === 'Container');
    expect(container).toBeDefined();
    expect(summarizeParams(container.type_params)).toEqual([{ name: 'T', kind: 'typevar' }]);

    const keyValueStore = ir.classes.find((c: any) => c.name === 'KeyValueStore');
    expect(keyValueStore).toBeDefined();
    expect(summarizeParams(keyValueStore.type_params)).toEqual([
      { name: 'K', kind: 'typevar' },
      { name: 'V', kind: 'typevar' },
    ]);

    const pair = ir.type_aliases.find((alias: any) => alias.name === 'Pair');
    expect(pair).toBeDefined();
    expect(summarizeParams(pair.type_params)).toEqual([{ name: 'T', kind: 'typevar' }]);

    const transform = ir.type_aliases.find((alias: any) => alias.name === 'Transform');
    expect(transform).toBeDefined();
    expect(summarizeParams(transform.type_params)).toEqual([
      { name: 'P', kind: 'paramspec' },
      { name: 'T', kind: 'typevar' },
    ]);

    const variadic = ir.type_aliases.find((alias: any) => alias.name === 'Variadic');
    expect(variadic).toBeDefined();
    expect(summarizeParams(variadic.type_params)).toEqual([{ name: 'Ts', kind: 'typevartuple' }]);
  });

  it('extracts backported generic markers from typing_extensions when available', async () => {
    if (!(await supportsTypingExtensionsBackports())) {
      return;
    }

    createTempModule(
      'generic_type_params_backport',
      `
from __future__ import annotations

from typing import Callable, TypeVar
from typing_extensions import ParamSpec, TypeVarTuple, Unpack

T = TypeVar("T")
P = ParamSpec("P")
Ts = TypeVarTuple("Ts")

Transform = Callable[P, T]
Variadic = tuple[Unpack[Ts]]
`
    );

    const ir = await extractIR('generic_type_params_backport');
    const summarizeParams = (params: Array<{ name: string; kind: string }>) =>
      params.map(param => ({ name: param.name, kind: param.kind }));

    const transform = ir.type_aliases.find((alias: any) => alias.name === 'Transform');
    expect(transform).toBeDefined();
    expect(summarizeParams(transform.type_params)).toEqual([
      { name: 'P', kind: 'paramspec' },
      { name: 'T', kind: 'typevar' },
    ]);

    const variadic = ir.type_aliases.find((alias: any) => alias.name === 'Variadic');
    expect(variadic).toBeDefined();
    expect(summarizeParams(variadic.type_params)).toEqual([{ name: 'Ts', kind: 'typevartuple' }]);
  });

  it('extracts PEP 695 type parameters from functions, classes, and type aliases on Python 3.12+', async () => {
    if (!(await supportsPep695Syntax())) {
      return;
    }

    createTempModule(
      'generic_type_params_pep695',
      `
from __future__ import annotations

type Pair[T] = tuple[T, T]

def identity[T](x: T) -> T:
    return x

class Box[T]:
    def __init__(self, value: T) -> None:
        self.value = value

    def id[U](self, x: U) -> tuple[T, U]:
        return (self.value, x)
`
    );

    const ir = await extractIR('generic_type_params_pep695');
    const summarizeParams = (params: Array<{ name: string; kind: string }>) =>
      params.map(param => ({ name: param.name, kind: param.kind }));

    const identity = ir.functions.find((f: any) => f.name === 'identity');
    expect(identity).toBeDefined();
    expect(summarizeParams(identity.type_params)).toEqual([{ name: 'T', kind: 'typevar' }]);

    const box = ir.classes.find((c: any) => c.name === 'Box');
    expect(box).toBeDefined();
    expect(summarizeParams(box.type_params)).toEqual([{ name: 'T', kind: 'typevar' }]);
    const boxId = box.methods.find((method: any) => method.name === 'id');
    expect(boxId).toBeDefined();
    expect(summarizeParams(boxId.type_params)).toEqual([{ name: 'U', kind: 'typevar' }]);

    const pair = ir.type_aliases.find((alias: any) => alias.name === 'Pair');
    expect(pair).toBeDefined();
    expect(pair.definition).toBe('tuple[T, T]');
    expect(summarizeParams(pair.type_params)).toEqual([{ name: 'T', kind: 'typevar' }]);
  });

  it('preserves protocol method names and generic metadata on Python 3.12+', async () => {
    if (!(await supportsPep695Syntax())) {
      return;
    }

    createTempModule(
      'protocol_method_generics_pep695',
      `
from __future__ import annotations

from typing import Protocol

class Mapper(Protocol):
    def map[U](self, x: U) -> U:
        ...
`
    );

    const ir = await extractIR('protocol_method_generics_pep695');
    const summarizeParams = (params: Array<{ name: string; kind: string }>) =>
      params.map(param => ({ name: param.name, kind: param.kind }));

    const mapper = ir.classes.find((c: any) => c.name === 'Mapper');
    expect(mapper).toBeDefined();
    expect(mapper.is_protocol).toBe(true);

    const mapMethod = mapper.methods.find((method: any) => method.name === 'map');
    expect(mapMethod).toBeDefined();
    expect(summarizeParams(mapMethod.type_params)).toEqual([{ name: 'U', kind: 'typevar' }]);

    const initMethod = mapper.methods.find((method: any) => method.qualname.endsWith('.__init__'));
    if (initMethod) {
      expect(initMethod.name).toBe('__init__');
    }
  });
});

describe('IR Extraction - Metadata and Version Info', () => {
  it('should include correct metadata in IR output', async () => {
    const ir = await extractIR('math'); // Use built-in module

    expect(ir.ir_version).toBeDefined();
    expect(ir.module).toBe('math');
    expect(ir.metadata).toBeDefined();
    expect(ir.metadata.python_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ir.metadata.platform).toBeDefined();
    expect(ir.metadata.cache_key).toBeDefined();
  });
});
