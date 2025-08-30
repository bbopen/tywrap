/**
 * Python Module Discovery System
 *
 * Handles module resolution, dependency detection, and file system operations
 * across different runtime environments
 */

// import type { PythonImport } from '../types/index.js';
import { fsUtils, processUtils, pathUtils } from '../utils/runtime.js';

export interface ModuleInfo {
  name: string;
  path: string;
  version?: string;
  isPackage: boolean;
  dependencies: string[];
}

export interface DiscoveryOptions {
  pythonPath?: string;
  virtualEnv?: string;
  searchPaths?: string[];
  excludePatterns?: string[];
  includeStdLib?: boolean;
}

export class ModuleDiscovery {
  private options: DiscoveryOptions;
  private moduleCache = new Map<string, ModuleInfo>();
  private dependencyGraph = new Map<string, Set<string>>();

  constructor(options: DiscoveryOptions = {}) {
    this.options = {
      pythonPath: 'python3',
      includeStdLib: false,
      excludePatterns: ['__pycache__', '*.pyc', '.git', '.svn'],
      ...options,
    };
  }

  /**
   * Find Python modules from various sources
   */
  async findPythonModules(paths: string[]): Promise<ModuleInfo[]> {
    const modules: ModuleInfo[] = [];
    const seen = new Set<string>();

    for (const path of paths) {
      try {
        const foundModules = await this.scanPath(path);
        for (const module of foundModules) {
          if (!seen.has(module.name)) {
            modules.push(module);
            seen.add(module.name);
            this.moduleCache.set(module.name, module);
          }
        }
      } catch (error) {
        console.warn(`Failed to scan path ${path}: ${error}`);
      }
    }

    return modules;
  }

  /**
   * Resolve Python module path from module name
   */
  async resolvePythonPath(moduleName: string): Promise<string | null> {
    // Check cache first
    const cached = this.moduleCache.get(moduleName);
    if (cached) {
      return cached.path;
    }

    // Try to resolve using Python's module finder
    if (processUtils.isAvailable()) {
      try {
        const result = await processUtils.exec(this.options.pythonPath ?? 'python3', [
          '-c',
          `import ${moduleName}; print(${moduleName}.__file__ if hasattr(${moduleName}, '__file__') else '${moduleName}.__path__[0]' if hasattr(${moduleName}, '__path__') else 'builtin')`,
        ]);

        if (result.code === 0 && result.stdout.trim() !== 'builtin') {
          const modulePath = result.stdout.trim();

          // Cache the result
          this.moduleCache.set(moduleName, {
            name: moduleName,
            path: modulePath,
            isPackage: modulePath.endsWith('__init__.py'),
            dependencies: [],
          });

          return modulePath;
        }
      } catch (error) {
        console.warn(`Failed to resolve module ${moduleName}: ${error}`);
      }
    }

    // Fallback: search in known Python paths
    const searchPaths = await this.getPythonSearchPaths();

    for (const searchPath of searchPaths) {
      const candidates = [
        await pathUtils.join(searchPath, `${moduleName}.py`),
        await pathUtils.join(searchPath, moduleName, '__init__.py'),
      ];

      for (const candidate of candidates) {
        try {
          if (fsUtils.isAvailable()) {
            await fsUtils.readFile(candidate);
            return candidate; // File exists
          }
        } catch {
          // File doesn't exist, continue
        }
      }
    }

    return null;
  }

  /**
   * Check if a file is a valid Python file
   */
  isValidPythonFile(path: string): boolean {
    if (!path.endsWith('.py')) {
      return false;
    }

    // Check against exclude patterns
    for (const pattern of this.options.excludePatterns ?? []) {
      if (pattern.startsWith('*') && path.endsWith(pattern.slice(1))) {
        return false;
      }
      if (path.includes(pattern)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Build dependency graph for modules
   */
  async buildDependencyGraph(modules: ModuleInfo[]): Promise<Map<string, Set<string>>> {
    this.dependencyGraph.clear();

    for (const module of modules) {
      const dependencies = await this.extractDependencies(module.path);
      this.dependencyGraph.set(module.name, new Set(dependencies));

      // Update module info
      module.dependencies = dependencies;
    }

    return new Map(this.dependencyGraph);
  }

  /**
   * Extract dependencies from Python source file
   */
  async extractDependencies(filePath: string): Promise<string[]> {
    if (!fsUtils.isAvailable()) {
      return [];
    }

    try {
      const source = await fsUtils.readFile(filePath);
      return this.parseDependenciesFromSource(source);
    } catch (error) {
      console.warn(`Failed to read file ${filePath}: ${error}`);
      return [];
    }
  }

  /**
   * Parse import statements from Python source code
   */
  parseDependenciesFromSource(source: string): string[] {
    const dependencies: string[] = [];
    const lines = source.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed === '') {
        continue;
      }

      // Match import statements
      const importMatch = trimmed.match(/^import\s+([a-zA-Z_][a-zA-Z0-9_\.]*)/);
      if (importMatch?.[1]) {
        const fullModuleName = importMatch[1];
        const moduleName = fullModuleName.split('.')[0]; // Get top-level module
        if (moduleName) {
          dependencies.push(moduleName);
        }
        continue;
      }

      // Match from ... import statements
      const fromMatch = trimmed.match(/^from\s+([a-zA-Z_][a-zA-Z0-9_\.]*)\s+import/);
      if (fromMatch?.[1]) {
        const fullModuleName = fromMatch[1];
        const moduleName = fullModuleName.split('.')[0]; // Get top-level module
        if (moduleName) {
          dependencies.push(moduleName);
        }
        continue;
      }
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Detect circular dependencies
   */
  detectCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (module: string, path: string[]): void => {
      if (recursionStack.has(module)) {
        // Found cycle
        const cycleStart = path.indexOf(module);
        cycles.push([...path.slice(cycleStart), module]);
        return;
      }

      if (visited.has(module)) {
        return;
      }

      visited.add(module);
      recursionStack.add(module);

      const dependencies = this.dependencyGraph.get(module);
      if (dependencies) {
        for (const dep of dependencies) {
          dfs(dep, [...path, module]);
        }
      }

      recursionStack.delete(module);
    };

    for (const module of this.dependencyGraph.keys()) {
      if (!visited.has(module)) {
        dfs(module, []);
      }
    }

    return cycles;
  }

  /**
   * Get Python search paths
   */
  private async getPythonSearchPaths(): Promise<string[]> {
    const paths: string[] = [];

    // Add explicit search paths
    if (this.options.searchPaths) {
      paths.push(...this.options.searchPaths);
    }

    // Add virtual environment paths
    if (this.options.virtualEnv) {
      paths.push(
        await pathUtils.join(this.options.virtualEnv, 'lib', 'python*', 'site-packages'),
        await pathUtils.join(this.options.virtualEnv, 'Lib', 'site-packages') // Windows
      );
    }

    // Get Python's sys.path if available
    if (processUtils.isAvailable()) {
      try {
        const result = await processUtils.exec(this.options.pythonPath ?? 'python3', [
          '-c',
          'import sys; print("\\n".join(sys.path))',
        ]);

        if (result.code === 0) {
          const sysPaths = result.stdout
            .trim()
            .split('\n')
            .filter(p => p.trim());
          paths.push(...sysPaths);
        }
      } catch (error) {
        console.warn(`Failed to get Python sys.path: ${error}`);
      }
    }

    return [...new Set(paths)]; // Remove duplicates
  }

  /**
   * Scan a directory path for Python modules
   */
  private async scanPath(path: string): Promise<ModuleInfo[]> {
    const modules: ModuleInfo[] = [];

    if (!fsUtils.isAvailable()) {
      return modules;
    }

    try {
      // For now, just create a stub - full directory scanning would need more complex logic
      if (this.isValidPythonFile(path)) {
        // Single file
        const moduleName = this.extractModuleNameFromPath(path);
        const dependencies = await this.extractDependencies(path);

        modules.push({
          name: moduleName,
          path,
          isPackage: false,
          dependencies,
        });
      }
    } catch (error) {
      console.warn(`Failed to scan ${path}: ${error}`);
    }

    return modules;
  }

  /**
   * Extract module name from file path
   */
  private extractModuleNameFromPath(path: string): string {
    const parts = path.split('/');
    const filename = parts[parts.length - 1];

    if (filename === '__init__.py') {
      // Package module
      return parts[parts.length - 2] ?? 'unknown';
    }

    // Regular module
    return filename?.replace('.py', '') ?? 'unknown';
  }

  /**
   * Get module version information
   */
  async getModuleVersion(moduleName: string): Promise<string | undefined> {
    if (!processUtils.isAvailable()) {
      return undefined;
    }

    try {
      const result = await processUtils.exec(this.options.pythonPath ?? 'python3', [
        '-c',
        `import ${moduleName}; print(getattr(${moduleName}, '__version__', 'unknown'))`,
      ]);

      if (result.code === 0 && result.stdout.trim() !== 'unknown') {
        return result.stdout.trim();
      }
    } catch (error) {
      console.warn(`Failed to get version for ${moduleName}: ${error}`);
    }

    return undefined;
  }

  /**
   * Clear module cache
   */
  clearCache(): void {
    this.moduleCache.clear();
    this.dependencyGraph.clear();
  }

  /**
   * Get cached module information
   */
  getCachedModule(moduleName: string): ModuleInfo | undefined {
    return this.moduleCache.get(moduleName);
  }

  /**
   * Get dependency graph
   */
  getDependencyGraph(): Map<string, Set<string>> {
    return new Map(this.dependencyGraph);
  }
}
