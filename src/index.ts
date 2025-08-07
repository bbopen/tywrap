/**
 * tywrap - TypeScript wrapper for Python libraries with full type safety
 *
 * @description Build-time code generation system that makes Python libraries
 * feel native in TypeScript with zero runtime overhead
 */

import type { TywrapOptions } from './types/index.js';
import { tywrap, type TywrapInstance } from './tywrap.js';

export { TypeMapper } from './core/mapper.js';
export { CodeGenerator } from './core/generator.js';
export { PyAnalyzer } from './core/analyzer.js';
export { TywrapConfig, createConfig } from './config/index.js';
export { RuntimeBridge } from './runtime/base.js';

// Runtime-specific exports
export { NodeBridge } from './runtime/node.js';
export { PyodideBridge } from './runtime/pyodide.js';
export { HttpBridge } from './runtime/http.js';

// Core types
export type {
  PythonModule,
  PythonFunction,
  PythonClass,
  PythonType,
  PrimitiveType,
  CollectionType,
  UnionType,
  OptionalType,
  CustomType,
  GenericType,
  Parameter,
  Property,
  PythonImport,
  TypescriptType,
  RuntimeStrategy,
  TywrapOptions,
  PythonModuleConfig,
  OutputConfig,
  RuntimeConfig,
  PyodideConfig,
  NodeConfig,
  HttpConfig,
  PerformanceConfig,
  DevelopmentConfig,
  AnalysisResult,
  AnalysisError,
  AnalysisWarning,
  AnalysisStatistics,
  GeneratedCode,
} from './types/index.js';

// Main API
export { tywrap } from './tywrap.js';
export { generate } from './tywrap.js';

// Runtime detection utilities
export { detectRuntime, isNodejs, isDeno, isBun, isBrowser } from './utils/runtime.js';
export { decodeValue, decodeValueAsync, registerArrowDecoder } from './utils/codec.js';

// Version info
export const VERSION = '0.1.0';

/**
 * Quick setup function for getting started
 */
export async function quickStart(config: Partial<TywrapOptions> = {}): Promise<TywrapInstance> {
  return tywrap(config);
}

// Default export for convenience
export default tywrap;
