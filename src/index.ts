/**
 * tywrap - TypeScript wrapper for Python libraries with full type safety
 *
 * @description Build-time code generation system that makes Python libraries
 * feel native in TypeScript with zero runtime overhead
 */

import { tywrap } from './tywrap.js';

export type { TywrapConfig } from './config/index.js';
export { defineConfig, resolveConfig } from './config/index.js';
// BoundedContext - unified abstraction for cross-boundary concerns
export { BoundedContext, type ContextState, type ExecuteOptions } from './runtime/bounded-context.js';
export type { Disposable } from './runtime/disposable.js';
export { isDisposable, safeDispose, disposeAll } from './runtime/disposable.js';
export {
  ValidationError,
  isFiniteNumber,
  isPositiveNumber,
  isNonNegativeNumber,
  isNonEmptyString,
  isPlainObject,
  assertFiniteNumber,
  assertPositive,
  assertNonNegative,
  assertString,
  assertNonEmptyString,
  assertArray,
  assertObject,
  containsSpecialFloat,
  assertNoSpecialFloats,
  sanitizeForFilename,
  containsPathTraversal,
} from './runtime/validators.js';

/**
 * @deprecated Use BoundedContext instead. RuntimeBridge will be removed in the next major version.
 */
export { RuntimeBridge } from './runtime/base.js';

export {
  BridgeError,
  BridgeProtocolError,
  BridgeTimeoutError,
  BridgeDisposedError,
  BridgeExecutionError,
} from './runtime/errors.js';
export { getRuntimeBridge, setRuntimeBridge, clearRuntimeBridge } from './runtime/index.js';

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
  TypeMappingConfig,
  TypePreset,
  BridgeInfo,
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
export {
  decodeValue,
  decodeValueAsync,
  autoRegisterArrowDecoder,
  registerArrowDecoder,
  clearArrowDecoder,
} from './utils/codec.js';

// Version info
export const VERSION = '0.2.0';

/**
 * Quick setup function for getting started
 */
// Default export for convenience
export default tywrap;
