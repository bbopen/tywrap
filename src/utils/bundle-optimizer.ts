/**
 * Bundle Size Optimization for tywrap
 * Implements tree-shaking, code splitting, and runtime optimization strategies
 */

import { writeFile } from 'node:fs/promises';
import ts from 'typescript';

import type { GeneratedCode } from '../types/index.js';

import { globalCache } from './cache.js';

export interface BundleAnalysis {
  totalSize: number;
  compressedSize: number;
  compressionRatio: number;
  modules: ModuleAnalysis[];
  runtime: RuntimeAnalysis;
  suggestions: OptimizationSuggestion[];
}

export interface BundleManifest {
  version: string;
  target: BundleOptions['target'];
  modules: string[];
  runtime: BundleOptions['runtimeMode'] | 'minimal';
  optimizations: {
    treeShaking: boolean;
    minified: boolean;
    compressed: boolean;
    codeSplitting: boolean;
  };
  stats: BundleAnalysis;
}

export interface ModuleAnalysis {
  name: string;
  size: number;
  exports: string[];
  imports: string[];
  unusedExports: string[];
  dependencies: string[];
  treeshakeable: boolean;
  complexity: number;
}

export interface RuntimeAnalysis {
  coreSize: number;
  bridgeSize: number;
  codecSize: number;
  utilsSize: number;
  totalSize: number;
  minimizable: boolean;
}

export interface OptimizationSuggestion {
  type: 'tree-shaking' | 'code-splitting' | 'runtime-minimal' | 'compression' | 'lazy-loading';
  severity: 'low' | 'medium' | 'high';
  description: string;
  estimatedSaving: number; // bytes
  implementation: string;
}

export interface BundleOptions {
  target: 'node' | 'browser' | 'deno' | 'bun' | 'universal';
  minify: boolean;
  compress: boolean;
  treeShaking: boolean;
  codeSplitting: boolean;
  runtimeMode: 'full' | 'minimal' | 'lazy';
  outputFormat: 'esm' | 'cjs' | 'umd';
}

export class BundleOptimizer {
  private options: BundleOptions;
  private generatedModules = new Map<string, GeneratedCode>();
  private analysisCache = new Map<string, ModuleAnalysis>();

  constructor(options: Partial<BundleOptions> = {}) {
    this.options = {
      target: 'universal',
      minify: true,
      compress: true,
      treeShaking: true,
      codeSplitting: false,
      runtimeMode: 'minimal',
      outputFormat: 'esm',
      ...options,
    };
  }

  /**
   * Add generated module for optimization
   */
  addModule(name: string, code: GeneratedCode): void {
    this.generatedModules.set(name, code);
  }

  /**
   * Analyze bundle composition and identify optimization opportunities
   */
  async analyzeBundles(): Promise<BundleAnalysis> {
    const modules: ModuleAnalysis[] = [];
    let totalSize = 0;

    // Analyze each generated module
    for (const [name, code] of this.generatedModules) {
      const analysis = await this.analyzeModule(name, code);
      modules.push(analysis);
      totalSize += analysis.size;
    }

    // Analyze runtime overhead
    const runtime = this.analyzeRuntime();
    totalSize += runtime.totalSize;

    // Estimate compressed size
    const compressedSize = this.estimateCompressedSize(totalSize);
    const compressionRatio = totalSize > 0 ? compressedSize / totalSize : 0;

    // Generate optimization suggestions
    const suggestions = this.generateOptimizationSuggestions(modules, runtime);

    return {
      totalSize,
      compressedSize,
      compressionRatio,
      modules,
      runtime,
      suggestions,
    };
  }

  /**
   * Analyze individual module
   */
  private async analyzeModule(name: string, code: GeneratedCode): Promise<ModuleAnalysis> {
    const cacheKey = globalCache.generateKey('module_analysis', name, code.typescript);
    const cached = await globalCache.get<ModuleAnalysis>(cacheKey);
    if (cached) {
      return cached;
    }

    const typescript = code.typescript;
    const size = Buffer.byteLength(typescript, 'utf8');

    // Extract exports
    const exports = this.extractExports(typescript);

    // Extract imports
    const imports = this.extractImports(typescript);

    // Find dependencies
    const dependencies = this.extractDependencies(typescript);

    // Calculate complexity
    const complexity = this.calculateComplexity(typescript);

    // Check if treeshakeable
    const treeshakeable = this.isTreeshakeable(typescript);

    const analysis: ModuleAnalysis = {
      name,
      size,
      exports,
      imports,
      unusedExports: [], // Would need usage analysis
      dependencies,
      treeshakeable,
      complexity,
    };

    // Cache the analysis
    await globalCache.set(cacheKey, analysis, { computeTime: 0 });
    this.analysisCache.set(name, analysis);

    return analysis;
  }

  /**
   * Extract export statements from TypeScript code
   */
  private extractExports(code: string): string[] {
    const source = this.parseSource(code);
    const exports = new Set<string>();

    const visit = (node: ts.Node): void => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)
      ) {
        if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
          const name = (node as ts.NamedDeclaration).name?.getText();
          if (name) {
            exports.add(name);
          }
        }
      } else if (ts.isVariableStatement(node)) {
        if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
          node.declarationList.declarations.forEach(d => {
            if (ts.isIdentifier(d.name)) {
              exports.add(d.name.text);
            }
          });
        }
      } else if (ts.isExportAssignment(node)) {
        if (ts.isIdentifier(node.expression)) {
          exports.add(node.expression.text);
        } else {
          exports.add('default');
        }
      } else if (ts.isExportDeclaration(node)) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          node.exportClause.elements.forEach(el => {
            exports.add((el.propertyName ?? el.name).text);
          });
        } else {
          exports.add('*');
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
    return Array.from(exports);
  }

  /**
   * Extract import statements from TypeScript code
   */
  private extractImports(code: string): string[] {
    const source = this.parseSource(code);
    const imports = new Set<string>();

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        const moduleName = (node.moduleSpecifier as ts.StringLiteral).text;
        imports.add(moduleName);
        const clause = node.importClause;
        if (clause) {
          if (clause.name) {
            imports.add(clause.name.text);
          }
          if (clause.namedBindings) {
            if (ts.isNamedImports(clause.namedBindings)) {
              clause.namedBindings.elements.forEach(el => {
                imports.add((el.propertyName ?? el.name).text);
              });
            } else if (ts.isNamespaceImport(clause.namedBindings)) {
              imports.add(clause.namedBindings.name.text);
            }
          }
        }
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          imports.add(arg.text);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
    return Array.from(imports);
  }

  /**
   * Extract module dependencies
   */
  private extractDependencies(code: string): string[] {
    const source = this.parseSource(code);
    const dependencies = new Set<string>();

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const expr = node.expression;
        if (
          ts.isCallExpression(expr) &&
          ts.isIdentifier(expr.expression) &&
          expr.expression.text === 'getRuntimeBridge'
        ) {
          dependencies.add('runtime-bridge');
        }
      }

      if (ts.isIdentifier(node)) {
        if (node.text === 'decodeValue' || node.text === 'encodeValue') {
          dependencies.add('codec');
        }
      }

      if (ts.isImportDeclaration(node)) {
        const moduleName = (node.moduleSpecifier as ts.StringLiteral).text;
        if (node.importClause?.isTypeOnly) {
          dependencies.add(moduleName);
        } else {
          const comments = ts.getTrailingCommentRanges(code, node.end) ?? [];
          for (const range of comments) {
            const comment = code.slice(range.pos, range.end);
            if (/types?/i.test(comment)) {
              dependencies.add(moduleName);
              break;
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
    return Array.from(dependencies);
  }

  private parseSource(code: string): ts.SourceFile {
    return ts.createSourceFile('module.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }

  /**
   * Calculate code complexity score
   */
  private calculateComplexity(code: string): number {
    let complexity = 0;

    // Function complexity
    const functions = (code.match(/\bfunction\b/g) ?? []).length;
    const asyncFunctions = (code.match(/\basync\s+function\b/g) ?? []).length;
    complexity += functions + asyncFunctions * 1.5;

    // Class complexity
    const classes = (code.match(/\bclass\b/g) ?? []).length;
    complexity += classes * 2;

    // Interface complexity
    const interfaces = (code.match(/\binterface\b/g) ?? []).length;
    complexity += interfaces * 0.5;

    // Type alias complexity
    const types = (code.match(/\btype\b/g) ?? []).length;
    complexity += types * 0.3;

    // Generic complexity
    const generics = (code.match(/<[^>]*>/g) ?? []).length;
    complexity += generics * 0.2;

    return Math.round(complexity);
  }

  /**
   * Check if code is tree-shakeable
   */
  private isTreeshakeable(code: string): boolean {
    // Code is tree-shakeable if it uses ES modules and has no side effects
    const hasESModules = code.includes('export') && !code.includes('module.exports');
    const hasSideEffects =
      code.includes('console.') || code.includes('window.') || code.includes('global.');

    return hasESModules && !hasSideEffects;
  }

  /**
   * Analyze runtime overhead
   */
  private analyzeRuntime(): RuntimeAnalysis {
    const estimates = {
      coreSize: 5 * 1024, // 5KB - Core runtime logic
      bridgeSize: this.estimateBridgeSize(),
      codecSize: 8 * 1024, // 8KB - Codec utilities
      utilsSize: 3 * 1024, // 3KB - Utility functions
    };

    const totalSize = Object.values(estimates).reduce((sum, size) => sum + size, 0);

    return {
      ...estimates,
      totalSize,
      minimizable: this.options.runtimeMode !== 'full',
    };
  }

  /**
   * Estimate bridge size based on target
   */
  private estimateBridgeSize(): number {
    switch (this.options.target) {
      case 'node':
        return 12 * 1024; // 12KB - Node.js specific bridge
      case 'browser':
        return 15 * 1024; // 15KB - Browser/Pyodide bridge
      case 'deno':
        return 10 * 1024; // 10KB - Deno bridge
      case 'bun':
        return 8 * 1024; // 8KB - Bun bridge
      case 'universal':
        return 25 * 1024; // 25KB - Universal bridge with all runtimes
      default:
        return 15 * 1024;
    }
  }

  /**
   * Estimate compressed size using typical compression ratios
   */
  private estimateCompressedSize(originalSize: number): number {
    // Typical gzip compression ratios for JavaScript/TypeScript:
    // - Minified: 3:1 to 4:1
    // - Non-minified: 4:1 to 6:1
    const compressionRatio = this.options.minify ? 3.5 : 5;
    return Math.round(originalSize / compressionRatio);
  }

  /**
   * Generate optimization suggestions
   */
  private generateOptimizationSuggestions(
    modules: ModuleAnalysis[],
    runtime: RuntimeAnalysis
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Tree-shaking suggestions
    if (this.options.treeShaking) {
      const treeshakeableModules = modules.filter(m => m.treeshakeable);
      if (treeshakeableModules.length > 0) {
        const estimatedSaving = treeshakeableModules.reduce((sum, m) => sum + m.size * 0.3, 0);
        suggestions.push({
          type: 'tree-shaking',
          severity: estimatedSaving > 10 * 1024 ? 'high' : 'medium',
          description: `Enable tree-shaking for ${treeshakeableModules.length} modules`,
          estimatedSaving,
          implementation: 'Configure bundler with ES modules and sideEffects: false',
        });
      }
    }

    // Code splitting suggestions
    const largeModules = modules.filter(m => m.size > 50 * 1024);
    if (largeModules.length > 1 && !this.options.codeSplitting) {
      const estimatedSaving = largeModules.reduce((sum, m) => sum + m.size * 0.2, 0);
      suggestions.push({
        type: 'code-splitting',
        severity: 'medium',
        description: `Split ${largeModules.length} large modules for lazy loading`,
        estimatedSaving,
        implementation: 'Implement dynamic imports and route-based code splitting',
      });
    }

    // Runtime optimization suggestions
    if (runtime.minimizable && this.options.runtimeMode === 'full') {
      const estimatedSaving = runtime.totalSize * 0.4;
      suggestions.push({
        type: 'runtime-minimal',
        severity: 'medium',
        description: 'Use minimal runtime for production builds',
        estimatedSaving,
        implementation: 'Set runtimeMode to "minimal" and include only used features',
      });
    }

    // Compression suggestions
    if (!this.options.compress) {
      const totalSize = modules.reduce((sum, m) => sum + m.size, 0) + runtime.totalSize;
      const estimatedSaving = totalSize - this.estimateCompressedSize(totalSize);
      suggestions.push({
        type: 'compression',
        severity: estimatedSaving > 20 * 1024 ? 'high' : 'medium',
        description: 'Enable gzip/brotli compression',
        estimatedSaving,
        implementation: 'Configure web server or CDN with compression enabled',
      });
    }

    // Lazy loading suggestions
    const complexModules = modules.filter(m => m.complexity > 10);
    if (complexModules.length > 0) {
      const estimatedSaving = complexModules.reduce((sum, m) => sum + m.size * 0.5, 0);
      suggestions.push({
        type: 'lazy-loading',
        severity: 'low',
        description: `Implement lazy loading for ${complexModules.length} complex modules`,
        estimatedSaving,
        implementation: 'Use dynamic imports and load modules on demand',
      });
    }

    // Sort suggestions by estimated saving
    return suggestions.sort((a, b) => b.estimatedSaving - a.estimatedSaving);
  }

  /**
   * Generate optimized bundle with tree-shaking
   */
  async generateOptimizedBundle(): Promise<{
    modules: Map<string, string>;
    runtime: string;
    manifest: BundleManifest;
  }> {
    const optimizedModules = new Map<string, string>();

    // Apply optimizations to each module
    for (const [name, code] of this.generatedModules) {
      let optimized = code.typescript;

      if (this.options.treeShaking) {
        optimized = this.applyTreeShaking(optimized);
      }

      if (this.options.minify) {
        optimized = this.applyMinification(optimized);
      }

      optimizedModules.set(name, optimized);
    }

    // Generate minimal runtime
    const runtime = this.generateMinimalRuntime();

    // Create bundle manifest
    const manifest: BundleManifest = {
      version: '1.0.0',
      target: this.options.target,
      modules: Array.from(optimizedModules.keys()),
      runtime: 'minimal',
      optimizations: {
        treeShaking: this.options.treeShaking,
        minified: this.options.minify,
        compressed: this.options.compress,
        codeSplitting: this.options.codeSplitting,
      },
      stats: await this.analyzeBundles(),
    };

    return { modules: optimizedModules, runtime, manifest };
  }

  /**
   * Apply tree-shaking to remove unused exports
   */
  private applyTreeShaking(code: string): string {
    // Basic tree-shaking implementation
    // In a real implementation, this would use AST analysis

    // Remove unused function declarations
    const usedFunctions = this.findUsedFunctions(code);
    const lines = code.split('\n');
    const filteredLines = lines.filter(line => {
      const functionName = this.getExportedFunctionName(line);
      if (functionName) {
        return usedFunctions.has(functionName);
      }
      return true;
    });

    return filteredLines.join('\n');
  }

  /**
   * Find functions that are actually used
   */
  private findUsedFunctions(code: string): Set<string> {
    const used = new Set<string>();

    // Find all function calls
    const callRegex = /(\w+)\s*\(/g;
    let match;
    while ((match = callRegex.exec(code)) !== null) {
      if (match[1]) {
        used.add(match[1]);
      }
    }

    // Find all exported functions (assume all exports are used externally)
    for (const line of code.split('\n')) {
      const exportName = this.getExportedFunctionName(line);
      if (exportName) {
        used.add(exportName);
      }
    }

    return used;
  }

  private getExportedFunctionName(line: string): string | null {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('export ')) {
      return null;
    }
    const tokens = this.splitWhitespace(trimmed);
    const functionIndex = tokens.indexOf('function');
    if (functionIndex === -1) {
      return null;
    }
    const nameToken = tokens[functionIndex + 1];
    if (!nameToken) {
      return null;
    }
    const name = nameToken.split('(')[0];
    if (!name) {
      return null;
    }
    return name;
  }

  private splitWhitespace(value: string): string[] {
    const tokens: string[] = [];
    let current = '';
    for (const char of value) {
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    if (current) {
      tokens.push(current);
    }
    return tokens;
  }

  /**
   * Apply basic minification
   */
  private applyMinification(code: string): string {
    let minified = code;

    // Remove comments
    minified = minified.replace(/\/\*[\s\S]*?\*\//g, '');
    minified = minified.replace(/\/\/.*$/gm, '');

    // Remove extra whitespace
    minified = minified.replace(/\s+/g, ' ');
    minified = minified.replace(/\s*([{}();,:])\s*/g, '$1');

    // Remove trailing semicolons before }
    minified = minified.replace(/;\s*}/g, '}');

    return minified.trim();
  }

  /**
   * Generate minimal runtime based on target
   */
  private generateMinimalRuntime(): string {
    const baseRuntime = `
// tywrap minimal runtime
let __runtimeBridge;

const getRuntimeBridge = () => {
  if (!__runtimeBridge) {
    throw new Error('No runtime bridge configured. Call setRuntimeBridge(...) before using generated modules.');
  }
  return __runtimeBridge;
};

const setRuntimeBridge = (bridge) => {
  __runtimeBridge = bridge;
};

const runtimeBridge = {
  async call(module, functionName, args, kwargs) {
    // Target-specific bridge implementation
    ${this.generateBridgeImplementation('call')}
  },
  async instantiate(module, className, args, kwargs) {
    // Target-specific bridge implementation
    ${this.generateBridgeImplementation('instantiate')}
  },
  async callMethod(handle, methodName, args, kwargs) {
    // Target-specific bridge implementation
    ${this.generateBridgeImplementation('call_method')}
  },
  async disposeInstance(handle) {
    // Target-specific bridge implementation
    ${this.generateBridgeImplementation('dispose_instance')}
  }
};

setRuntimeBridge(runtimeBridge);

// Minimal codec
const decodeValue = (value) => {
  if (value?.__tywrap__) {
    // Handle special types
    return value.data ?? value;
  }
  return value;
};

export { getRuntimeBridge, setRuntimeBridge, decodeValue };
`;

    return this.options.minify ? this.applyMinification(baseRuntime) : baseRuntime;
  }

  /**
   * Generate bridge implementation based on target
   */
  private generateBridgeImplementation(
    method: 'call' | 'instantiate' | 'call_method' | 'dispose_instance'
  ): string {
    switch (this.options.target) {
      case 'node':
        return `
        // Node.js subprocess bridge
        if (!this._process) {
          const { spawn } = require('child_process');
          this._process = spawn('python3', ['python_bridge.py']);
        }
        // Implementation details for ${method}...
        return result;
        `;

      case 'browser':
        return `
        // Pyodide browser bridge
        if (!globalThis.pyodide) {
          await import('pyodide');
        }
        // Implementation details for ${method}...
        return result;
        `;

      default:
        return `
        // Universal bridge - detect environment
        if (typeof process !== 'undefined') {
          // Node.js environment
        } else if (typeof window !== 'undefined') {
          // Browser environment
        }
        // Implementation details for ${method}...
        return result;
        `;
    }
  }

  /**
   * Save bundle analysis report
   */
  async saveAnalysisReport(filePath: string): Promise<BundleAnalysis> {
    const analysis = await this.analyzeBundles();

    const report = {
      timestamp: new Date().toISOString(),
      options: this.options,
      analysis,
      modules: Object.fromEntries(this.generatedModules.entries()),
    };

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- report path is caller-provided
    await writeFile(filePath, JSON.stringify(report, null, 2));
    process.stdout.write(`Bundle analysis report saved to ${filePath}\n`);

    return analysis;
  }

  /**
   * Clear all modules and cache
   */
  clear(): void {
    this.generatedModules.clear();
    this.analysisCache.clear();
  }
}

interface RollupBundleChunk {
  code?: string;
}

type RollupBundle = Record<string, RollupBundleChunk>;

interface RollupPlugin {
  name: string;
  generateBundle: (options: unknown, bundle: RollupBundle) => void;
  writeBundle: () => Promise<void>;
}

interface WebpackAsset {
  source: () => string | Buffer;
}

interface WebpackCompilation {
  assets: Record<string, WebpackAsset>;
}

interface WebpackCompiler {
  hooks: {
    emit: {
      tap: (name: string, handler: (compilation: WebpackCompilation) => void) => void;
    };
  };
}

interface WebpackPlugin {
  apply: (compiler: WebpackCompiler) => void;
}

// Export utilities for rollup/webpack integration
export function createRollupPlugin(options: Partial<BundleOptions> = {}): RollupPlugin {
  const optimizer = new BundleOptimizer(options);

  return {
    name: 'tywrap-optimizer',
    generateBundle(_options: unknown, bundle: RollupBundle): void {
      // Integrate with Rollup bundle generation
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (
          (fileName.endsWith('.ts') || fileName.endsWith('.js')) &&
          typeof chunk.code === 'string'
        ) {
          // Add to optimizer for analysis
          const code = {
            typescript: chunk.code,
            declaration: '',
            metadata: {
              generatedAt: new Date(),
              sourceFiles: [fileName],
              runtime: 'node' as const,
              optimizations: ['tree-shaking'],
            },
          };
          optimizer.addModule(fileName, code);
        }
      }
    },
    async writeBundle(): Promise<void> {
      // Generate analysis report
      await optimizer.saveAnalysisReport('bundle-analysis.json');
    },
  };
}

export function createWebpackPlugin(options: Partial<BundleOptions> = {}): WebpackPlugin {
  const optimizer = new BundleOptimizer(options);

  return {
    apply(compiler: WebpackCompiler): void {
      compiler.hooks.emit.tap('TywrapOptimizerPlugin', (compilation: WebpackCompilation) => {
        // Process webpack assets
        for (const [filename, asset] of Object.entries(compilation.assets)) {
          if (filename.endsWith('.js') || filename.endsWith('.ts')) {
            const assetSource = asset.source();
            const sourceText =
              typeof assetSource === 'string' ? assetSource : assetSource.toString();
            const code = {
              typescript: sourceText,
              declaration: '',
              metadata: {
                generatedAt: new Date(),
                sourceFiles: [filename],
                runtime: 'node' as const,
                optimizations: ['minification'],
              },
            };
            optimizer.addModule(filename, code);
          }
        }

        // Generate analysis
        optimizer.saveAnalysisReport('webpack-bundle-analysis.json').catch(error => {
          process.stderr.write(`Failed to write webpack analysis report: ${String(error)}\n`);
        });
      });
    },
  };
}
