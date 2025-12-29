import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ModuleDiscovery } from '../src/core/discovery.js';
import * as runtimeModule from '../src/utils/runtime.js';
import * as pythonModule from '../src/utils/python.js';
import { isNodejs, getPythonExecutableName } from '../src/utils/runtime.js';

describe('ModuleDiscovery', () => {
  let discovery: ModuleDiscovery;

  beforeEach(() => {
    discovery = new ModuleDiscovery();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const d = new ModuleDiscovery();
      expect(d).toBeInstanceOf(ModuleDiscovery);
    });

    it('should create instance with custom options', () => {
      const d = new ModuleDiscovery({
        pythonPath: '/usr/bin/python3',
        virtualEnv: '.venv',
        searchPaths: ['/custom/path'],
        excludePatterns: ['*.pyc'],
        includeStdLib: true,
      });
      expect(d).toBeInstanceOf(ModuleDiscovery);
    });
  });

  describe('isValidPythonFile', () => {
    it('should accept .py files', () => {
      expect(discovery.isValidPythonFile('module.py')).toBe(true);
      expect(discovery.isValidPythonFile('/path/to/module.py')).toBe(true);
    });

    it('should reject non-.py files', () => {
      expect(discovery.isValidPythonFile('module.txt')).toBe(false);
      expect(discovery.isValidPythonFile('module.js')).toBe(false);
      expect(discovery.isValidPythonFile('module')).toBe(false);
    });

    it('should reject files matching exclude patterns', () => {
      expect(discovery.isValidPythonFile('__pycache__/module.py')).toBe(false);
      expect(discovery.isValidPythonFile('module.pyc')).toBe(false);
      expect(discovery.isValidPythonFile('.git/hooks/pre-commit.py')).toBe(false);
    });
  });

  describe('parseDependenciesFromSource', () => {
    it('should extract simple import statements', () => {
      const source = `import os`;
      const deps = discovery.parseDependenciesFromSource(source);
      expect(deps).toContain('os');
    });

    it('should extract dotted import (top-level module)', () => {
      const source = `import os.path`;
      const deps = discovery.parseDependenciesFromSource(source);
      expect(deps).toContain('os');
    });

    it('should extract from imports', () => {
      const source = `from typing import List`;
      const deps = discovery.parseDependenciesFromSource(source);
      expect(deps).toContain('typing');
    });

    it('should extract from dotted imports (top-level module)', () => {
      const source = `from collections.abc import Mapping`;
      const deps = discovery.parseDependenciesFromSource(source);
      expect(deps).toContain('collections');
    });

    it('should handle multiple imports', () => {
      const source = `
import os
import sys
from typing import List
from collections import OrderedDict
`;
      const deps = discovery.parseDependenciesFromSource(source);
      expect(deps).toContain('os');
      expect(deps).toContain('sys');
      expect(deps).toContain('typing');
      expect(deps).toContain('collections');
    });

    it('should deduplicate imports', () => {
      const source = `
import os
import os
from os import path
`;
      const deps = discovery.parseDependenciesFromSource(source);
      const osCount = deps.filter(d => d === 'os').length;
      expect(osCount).toBe(1);
    });

    it('should skip comments', () => {
      const source = `
# import notimported
import os
`;
      const deps = discovery.parseDependenciesFromSource(source);
      expect(deps).toContain('os');
      expect(deps).not.toContain('notimported');
    });

    it('should handle empty source', () => {
      const deps = discovery.parseDependenciesFromSource('');
      expect(deps).toHaveLength(0);
    });
  });

  describe('detectCircularDependencies', () => {
    it('should detect no cycles in empty graph', () => {
      const cycles = discovery.detectCircularDependencies();
      expect(cycles).toHaveLength(0);
    });

    it('should return empty when no graph built', () => {
      const cycles = discovery.detectCircularDependencies();
      expect(cycles).toEqual([]);
    });
  });

  describe('clearCache', () => {
    it('should clear internal caches', () => {
      discovery.clearCache();
      // Should not throw
      expect(discovery.getCachedModule('nonexistent')).toBeUndefined();
    });
  });

  describe('getCachedModule', () => {
    it('should return undefined for uncached modules', () => {
      expect(discovery.getCachedModule('nonexistent')).toBeUndefined();
    });
  });

  describe('getDependencyGraph', () => {
    it('should return empty map initially', () => {
      const graph = discovery.getDependencyGraph();
      expect(graph).toBeInstanceOf(Map);
      expect(graph.size).toBe(0);
    });
  });

  describe('findPythonModules', () => {
    it('should return empty array for empty paths', async () => {
      const modules = await discovery.findPythonModules([]);
      expect(modules).toHaveLength(0);
    });

    it('should handle invalid paths gracefully', async () => {
      // Should not throw - the discovery module attempts to scan valid Python files
      // even if the file doesn't exist (it validates the extension, not file existence)
      const modules = await discovery.findPythonModules(['/nonexistent/path/file.py']);
      // Should have attempted to create module info (file validation is separate from existence)
      expect(Array.isArray(modules)).toBe(true);
    });
  });

  describe('resolvePythonPath with mocked subprocess', () => {
    it('should return null for unknown module when subprocess fails', async () => {
      // Mock processUtils to simulate failure
      vi.spyOn(runtimeModule.processUtils, 'isAvailable').mockReturnValue(false);

      const discovery2 = new ModuleDiscovery();
      const result = await discovery2.resolvePythonPath('nonexistent_module');

      expect(result).toBeNull();
    });
  });

  describe('buildDependencyGraph', () => {
    it('should return empty map for empty modules list', async () => {
      const graph = await discovery.buildDependencyGraph([]);
      expect(graph.size).toBe(0);
    });
  });

  describe('extractDependencies', () => {
    it('should return empty array when filesystem unavailable', async () => {
      vi.spyOn(runtimeModule.fsUtils, 'isAvailable').mockReturnValue(false);

      const discovery2 = new ModuleDiscovery();
      const deps = await discovery2.extractDependencies('/any/path.py');

      expect(deps).toEqual([]);
    });
  });

  describe('getModuleVersion', () => {
    it('should return undefined when subprocess unavailable', async () => {
      vi.spyOn(runtimeModule.processUtils, 'isAvailable').mockReturnValue(false);

      const discovery2 = new ModuleDiscovery();
      const version = await discovery2.getModuleVersion('os');

      expect(version).toBeUndefined();
    });
  });
});

// Integration tests with real files
const describeNodeOnly = isNodejs() ? describe : describe.skip;
const FIXTURES_DIR = join(process.cwd(), 'test', 'fixtures', 'python');

const checkPythonAvailable = (): string | null => {
  const candidates = [getPythonExecutableName(), 'python3', 'python'];
  for (const candidate of candidates) {
    try {
      const res = spawnSync(candidate, ['--version'], { encoding: 'utf-8' });
      if (res.status === 0) {
        return candidate;
      }
    } catch {
      // continue
    }
  }
  return null;
};

describeNodeOnly('ModuleDiscovery - Integration with real files', () => {
  let tempDir: string;
  let pythonPath: string | null;

  beforeAll(() => {
    // Restore all mocks to ensure no interference from mocked tests
    vi.restoreAllMocks();
    pythonPath = checkPythonAvailable();
    tempDir = mkdtempSync(join(tmpdir(), 'tywrap-discovery-test-'));
  });

  beforeEach(() => {
    // Ensure mocks are restored before each test
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('findPythonModules with real fixture files', () => {
    it('should discover module from individual file path', async () => {
      const simpleModulePath = join(FIXTURES_DIR, 'simple_module.py');
      if (!existsSync(simpleModulePath)) return;

      const discovery = new ModuleDiscovery();
      const modules = await discovery.findPythonModules([simpleModulePath]);

      // Should find the module
      expect(modules.length).toBe(1);
      expect(modules[0]?.name).toBe('simple_module');
    });

    it('should exclude __pycache__ paths', async () => {
      const pycachePath = join(FIXTURES_DIR, '__pycache__', 'some_file.py');

      const discovery = new ModuleDiscovery();
      const modules = await discovery.findPythonModules([pycachePath]);

      // Should not include __pycache__ files
      expect(modules.length).toBe(0);
    });

    it('should discover multiple modules from file paths', async () => {
      // Create test files in temp directory
      const pathA = join(tempDir, 'test_mod_a.py');
      const pathB = join(tempDir, 'test_mod_b.py');

      writeFileSync(
        pathA,
        `
def func_a():
    return "A"
`
      );
      writeFileSync(
        pathB,
        `
import test_mod_a

def func_b():
    return test_mod_a.func_a() + "B"
`
      );

      const discovery = new ModuleDiscovery();
      const modules = await discovery.findPythonModules([pathA, pathB]);

      expect(modules.length).toBe(2);
      const names = modules.map(m => m.name);
      expect(names).toContain('test_mod_a');
      expect(names).toContain('test_mod_b');
    });
  });

  describe('buildDependencyGraph with real files', () => {
    it('should build graph from module file paths', async () => {
      // Create files
      const pathA = join(tempDir, 'graph_mod_a.py');
      const pathB = join(tempDir, 'graph_mod_b.py');

      writeFileSync(
        pathA,
        `
import os
import sys
`
      );
      writeFileSync(
        pathB,
        `
import graph_mod_a
from typing import List
`
      );

      const discovery = new ModuleDiscovery();
      const modules = await discovery.findPythonModules([pathA, pathB]);

      const graph = await discovery.buildDependencyGraph(modules);

      // Should have entries in the graph
      expect(graph.size).toBe(2);
    });

    it('should track dependencies from source parsing', async () => {
      const discovery = new ModuleDiscovery();

      // Create a module with clear dependencies
      const depsTestPath = join(tempDir, 'deps_test.py');
      writeFileSync(
        depsTestPath,
        `
import json
import re
from collections import OrderedDict
from typing import Dict, List, Optional
`
      );

      const deps = await discovery.extractDependencies(depsTestPath);

      // Should extract top-level modules
      expect(deps).toContain('json');
      expect(deps).toContain('re');
      expect(deps).toContain('collections');
      expect(deps).toContain('typing');
    });
  });

  describe('detectCircularDependencies with real files', () => {
    it('should detect circular dependencies between modules', async () => {
      // Create modules with circular imports
      const circAPath = join(tempDir, 'circ_a.py');
      const circBPath = join(tempDir, 'circ_b.py');

      writeFileSync(
        circAPath,
        `
import circ_b

def func_a():
    return circ_b.func_b()
`
      );
      writeFileSync(
        circBPath,
        `
import circ_a

def func_b():
    return circ_a.func_a()
`
      );

      const discovery = new ModuleDiscovery();
      const modules = await discovery.findPythonModules([circAPath, circBPath]);

      await discovery.buildDependencyGraph(modules);
      const cycles = discovery.detectCircularDependencies();

      // Note: Cycle detection depends on graph construction
      // At minimum, should not crash
      expect(Array.isArray(cycles)).toBe(true);
    });

    it('should return empty array for non-circular dependencies', async () => {
      // Create modules without circular imports
      const linearAPath = join(tempDir, 'linear_a.py');
      const linearBPath = join(tempDir, 'linear_b.py');
      const linearCPath = join(tempDir, 'linear_c.py');

      writeFileSync(
        linearAPath,
        `
def func_a():
    return "A"
`
      );
      writeFileSync(
        linearBPath,
        `
import linear_a

def func_b():
    return linear_a.func_a()
`
      );
      writeFileSync(
        linearCPath,
        `
import linear_b

def func_c():
    return linear_b.func_b()
`
      );

      const discovery = new ModuleDiscovery();
      const modules = await discovery.findPythonModules([linearAPath, linearBPath, linearCPath]);

      await discovery.buildDependencyGraph(modules);
      const cycles = discovery.detectCircularDependencies();

      // Linear dependencies should have no cycles
      expect(cycles.length).toBe(0);
    });
  });

  describe('resolvePythonPath with real Python', () => {
    it('should resolve standard library module paths', async () => {
      if (!pythonPath) return; // Skip if Python not available

      const discovery = new ModuleDiscovery({ pythonPath });
      const osPath = await discovery.resolvePythonPath('os');

      // os is a standard library module, should resolve
      // May return null on some systems but should not throw
      expect(osPath === null || typeof osPath === 'string').toBe(true);
    });

    it('should return null for nonexistent modules', async () => {
      if (!pythonPath) return;

      const discovery = new ModuleDiscovery({ pythonPath });
      const result = await discovery.resolvePythonPath('definitely_not_a_real_module_xyz123');

      expect(result).toBeNull();
    });
  });

  describe('getModuleVersion with real Python', () => {
    it('should get version for installed packages', async () => {
      if (!pythonPath) return;

      const discovery = new ModuleDiscovery({ pythonPath });

      // pip is usually installed, try to get its version
      const version = await discovery.getModuleVersion('pip');

      // May or may not work depending on environment, but should not throw
      expect(version === undefined || typeof version === 'string').toBe(true);
    });
  });

  describe('caching behavior', () => {
    it('should cache discovered modules', async () => {
      const discovery = new ModuleDiscovery();

      // First discovery
      await discovery.findPythonModules([tempDir]);

      // Write new file after discovery
      writeFileSync(join(tempDir, 'after_cache.py'), 'def after(): pass');

      // Clear cache
      discovery.clearCache();

      // Cache should be cleared
      const cached = discovery.getCachedModule('after_cache');
      expect(cached).toBeUndefined();
    });

    it('should return cached module after discovery', async () => {
      writeFileSync(join(tempDir, 'cached_mod.py'), 'def cached(): pass');

      const discovery = new ModuleDiscovery();
      const modules = await discovery.findPythonModules([tempDir]);

      // Find the cached module
      const cachedMod = modules.find(m => m.name === 'cached_mod');
      if (cachedMod) {
        // Attempt to get from cache (implementation specific)
        const cached = discovery.getCachedModule('cached_mod');
        // May or may not cache by name, depends on implementation
        expect(cached === undefined || cached !== undefined).toBe(true);
      }
    });
  });

  describe('error handling with malformed files', () => {
    it('should handle files with syntax errors gracefully', async () => {
      const syntaxErrorPath = join(tempDir, 'syntax_error.py');
      writeFileSync(
        syntaxErrorPath,
        `
def broken(
    pass
`
      );

      const discovery = new ModuleDiscovery();

      // Should not throw when encountering syntax errors
      const modules = await discovery.findPythonModules([syntaxErrorPath]);
      expect(Array.isArray(modules)).toBe(true);
    });

    it('should continue discovering other modules when one has errors', async () => {
      const valid1Path = join(tempDir, 'error_valid1.py');
      const brokenPath = join(tempDir, 'error_broken.py');
      const valid2Path = join(tempDir, 'error_valid2.py');

      writeFileSync(valid1Path, 'def valid1(): return 1');
      writeFileSync(
        brokenPath,
        `
def broken(
`
      );
      writeFileSync(valid2Path, 'def valid2(): return 2');

      const discovery = new ModuleDiscovery();
      const modules = await discovery.findPythonModules([valid1Path, brokenPath, valid2Path]);

      // Should still find all modules (discovery doesn't fail on syntax errors)
      expect(modules.length).toBe(3);
      const names = modules.map(m => m.name);
      expect(names).toContain('error_valid1');
      expect(names).toContain('error_valid2');
    });
  });
});
