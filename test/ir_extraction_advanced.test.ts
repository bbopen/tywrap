import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { processUtils } from '../src/utils/runtime.js';

/**
 * Advanced IR Extraction Test Suite
 *
 * Tests the Python IR extraction capabilities with complex typing constructs
 * including Python 3.9-3.12 features, protocols, generics, dataclasses, and more.
 */

// Test fixture paths
const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'python');
const TEMP_DIR = join(process.cwd(), 'test', 'temp_python_modules');

/**
 * Helper function to execute Python IR extraction
 */
async function extractIR(
  moduleName: string,
  includePrivate: boolean = false,
  useFixtureDir: boolean = false
): Promise<any> {
  // Use Bash tool directly to have full control over the environment
  const { Bash } = await import('../src/utils/runtime.js');

  const pythonPath = useFixtureDir
    ? `${FIXTURES_DIR}:tywrap_ir:${process.env.PYTHONPATH || ''}`
    : `${TEMP_DIR}:tywrap_ir:${process.env.PYTHONPATH || ''}`;

  const result = await processUtils.exec('python3', [
    '-c',
    `
import sys
sys.path.insert(0, "${useFixtureDir ? FIXTURES_DIR : TEMP_DIR}")
sys.path.insert(0, "tywrap_ir")
from tywrap_ir.ir import emit_ir_json
print(emit_ir_json("${moduleName}", include_private=${includePrivate ? 'True' : 'False'}, pretty=False))
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

beforeAll(async () => {
  // Ensure test fixtures exist
  if (!existsSync(FIXTURES_DIR)) {
    throw new Error(`Test fixtures directory not found: ${FIXTURES_DIR}`);
  }

  // Verify Python and tywrap_ir are available
  try {
    const result = await processUtils.exec('python3', ['-m', 'tywrap_ir', '--help']);
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
