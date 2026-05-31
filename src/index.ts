/**
 * tywrap - TypeScript wrapper for Python libraries with full type safety
 *
 * @description Build-time code generation system that makes Python libraries
 * feel native in TypeScript with zero runtime overhead
 *
 * This is the package root. It intentionally exposes only the stable,
 * consumer-facing surface. Runtime plumbing (codec, transport, bridge
 * implementations, disposables, validators) lives behind the subpath
 * entrypoints: `tywrap/runtime`, `tywrap/node`, `tywrap/pyodide`, `tywrap/http`.
 */

import { tywrap } from './tywrap.js';

// Configuration
export type { TywrapConfig, ResolvedTywrapConfig } from './config/index.js';
export { defineConfig, resolveConfig } from './config/index.js';

// Bridge error hierarchy
export {
  BridgeError,
  BridgeCodecError,
  BridgeProtocolError,
  BridgeTimeoutError,
  BridgeDisposedError,
  BridgeExecutionError,
} from './runtime/errors.js';

// Core types
export type {
  PythonModule,
  PythonFunction,
  PythonClass,
  PythonTypeAlias,
  PythonType,
  PythonGenericParameter,
  PythonGenericParameterKind,
  PrimitiveType,
  CollectionType,
  UnionType,
  OptionalType,
  CustomType,
  GenericType,
  CallableType,
  LiteralType,
  AnnotatedType,
  TypeVarType,
  ParamSpecType,
  ParamSpecArgsType,
  ParamSpecKwargsType,
  TypeVarTupleType,
  UnpackType,
  FinalType,
  ClassVarType,
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
export type { GenerateFailure, GenerateResult, GenerateRunOptions } from './tywrap.js';

// Runtime detection utilities
export { detectRuntime, isNodejs, isDeno, isBun, isBrowser } from './utils/runtime.js';

// Arrow/codec public helpers
export {
  decodeValue,
  decodeValueAsync,
  autoRegisterArrowDecoder,
  registerArrowDecoder,
  clearArrowDecoder,
} from './utils/codec.js';

// Version info — single-sourced from package.json via scripts/generate-version.mjs
export { VERSION } from './version.js';

// Default export for convenience
export default tywrap;
