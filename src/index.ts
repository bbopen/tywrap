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
// BridgeProtocol - unified BoundedContext + SafeCodec + Transport
export { BridgeProtocol, type BridgeProtocolOptions } from './runtime/bridge-protocol.js';
// SafeCodec - validation and serialization for JS<->Python boundary
export { SafeCodec, type CodecOptions } from './runtime/safe-codec.js';
// Transport - abstract I/O channel interface
export type { Transport, TransportOptions, ProtocolMessage, ProtocolResponse } from './runtime/transport.js';
export { PROTOCOL_ID, isTransport, isProtocolMessage, isProtocolResponse } from './runtime/transport.js';
// Transport implementations
export { ProcessIO, type ProcessIOOptions } from './runtime/process-io.js';
export { HttpIO, type HttpIOOptions } from './runtime/http-io.js';
export { PyodideIO, type PyodideIOOptions } from './runtime/pyodide-io.js';
// WorkerPool - concurrent transport management
export { WorkerPool, type WorkerPoolOptions, type PooledWorker } from './runtime/worker-pool.js';
// PooledTransport - Transport adapter that wraps WorkerPool
export { PooledTransport, type PooledTransportOptions } from './runtime/pooled-transport.js';
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

// Runtime-specific exports (Bridges using new BridgeProtocol architecture)
export { NodeBridge, type NodeBridgeOptions } from './runtime/node.js';
export { PyodideBridge, type PyodideBridgeOptions } from './runtime/pyodide.js';
export { HttpBridge, type HttpBridgeOptions } from './runtime/http.js';

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
