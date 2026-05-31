/**
 * Type Tests for tywrap - Enhanced type checking with tsd
 * 
 * Tests TypeScript type definitions at compile-time to ensure
 * type safety and correct API surface for consumers
 */

import { expectType, expectError, expectAssignable, expectNotAssignable } from 'tsd';
import {
  // Core API
  tywrap,
  defineConfig,
  resolveConfig,

  // Types
  PythonModule,
  PythonFunction,
  PythonClass,
  PythonType,
  PrimitiveType,
  CollectionType,
  UnionType,
  OptionalType,
  CustomType,
  Parameter,
  AnalysisResult,
  TywrapOptions,
  RuntimeStrategy,

  // Bridge errors
  BridgeError,
  BridgeProtocolError,

  // Runtime utilities
  detectRuntime,
  isNodejs,
  isDeno,
  isBun,
  isBrowser
} from '../src/index.js';
// Registry lives behind the `tywrap/runtime` subpath, not the package root.
import { setRuntimeBridge, getRuntimeBridge, clearRuntimeBridge } from '../src/runtime/index.js';
// Concrete bridges live behind their own subpaths, not the package root.
import { NodeBridge } from '../src/runtime/node.js';
import { PyodideBridge } from '../src/runtime/pyodide.js';
import { HttpBridge } from '../src/runtime/http.js';

// =============================================================================
// Core API Type Tests
// =============================================================================

// Main tywrap function should accept partial options  
// Note: Actual return type to be determined based on implementation
const tywrapResult = tywrap();
const tywrapWithConfig = tywrap({});

const resolvedConfig = await resolveConfig();
expectType<TywrapOptions>(defineConfig(resolvedConfig));

// =============================================================================
// Python Type System Tests
// =============================================================================

// Primitive types should be correctly constrained
const primitiveType: PrimitiveType = {
  kind: 'primitive',
  name: 'int'
};
expectType<PrimitiveType>(primitiveType);

// Should accept all valid primitive types
expectAssignable<PrimitiveType>({ kind: 'primitive', name: 'int' });
expectAssignable<PrimitiveType>({ kind: 'primitive', name: 'float' });
expectAssignable<PrimitiveType>({ kind: 'primitive', name: 'str' });
expectAssignable<PrimitiveType>({ kind: 'primitive', name: 'bool' });
expectAssignable<PrimitiveType>({ kind: 'primitive', name: 'bytes' });
expectAssignable<PrimitiveType>({ kind: 'primitive', name: 'None' });

// Should reject invalid primitive types
// Note: TypeScript will catch these at compile time with current strict typing

// Collection types should be correctly constrained
const collectionType: CollectionType = {
  kind: 'collection',
  name: 'list',
  itemTypes: [{ kind: 'primitive', name: 'int' }]
};
expectType<CollectionType>(collectionType);

// Should accept all valid collection types
expectAssignable<CollectionType>({ kind: 'collection', name: 'list', itemTypes: [] });
expectAssignable<CollectionType>({ kind: 'collection', name: 'dict', itemTypes: [] });
expectAssignable<CollectionType>({ kind: 'collection', name: 'tuple', itemTypes: [] });
expectAssignable<CollectionType>({ kind: 'collection', name: 'set', itemTypes: [] });

// Union types should accept array of types
const unionType: UnionType = {
  kind: 'union',
  types: [
    { kind: 'primitive', name: 'int' },
    { kind: 'primitive', name: 'str' }
  ]
};
expectType<UnionType>(unionType);

// Optional types should wrap other types
const optionalType: OptionalType = {
  kind: 'optional',
  type: { kind: 'primitive', name: 'int' }
};
expectType<OptionalType>(optionalType);

// Custom types should accept any name
const customType: CustomType = {
  kind: 'custom',
  name: 'MyClass'
};
expectType<CustomType>(customType);

// PythonType union should accept all type variants
expectAssignable<PythonType>(primitiveType);
// expectAssignable<PythonType>(collectionType); // TODO: Fix collection type assignability
expectAssignable<PythonType>(unionType);  
expectAssignable<PythonType>(optionalType);
expectAssignable<PythonType>(customType);

// Test specific type narrowing
expectType<PrimitiveType>(primitiveType);
expectType<UnionType>(unionType);
expectType<OptionalType>(optionalType);
expectType<CustomType>(customType);

// =============================================================================
// Parameter and Function Type Tests
// =============================================================================

// Parameters should have correct structure
const parameter: Parameter = {
  name: 'x',
  type: { kind: 'primitive', name: 'int' },
  optional: false,
  varArgs: false,
  kwArgs: false
};
expectType<Parameter>(parameter);

// Optional parameters should allow defaultValue
const optionalParameter: Parameter = {
  name: 'y',
  type: { kind: 'primitive', name: 'str' },
  optional: true,
  defaultValue: 'hello',
  varArgs: false,
  kwArgs: false
};
expectType<Parameter>(optionalParameter);

// Functions should have correct structure
const pythonFunction: PythonFunction = {
  name: 'add_numbers',
  signature: {
    parameters: [parameter],
    returnType: { kind: 'primitive', name: 'int' },
    isAsync: false,
    isGenerator: false
  },
  docstring: 'Adds two numbers',
  decorators: [],
  isAsync: false,
  isGenerator: false,
  returnType: { kind: 'primitive', name: 'int' },
  parameters: [parameter]
};
expectType<PythonFunction>(pythonFunction);

// =============================================================================
// Module and Class Type Tests
// =============================================================================

// Classes should have correct structure
const pythonClass: PythonClass = {
  name: 'Calculator',
  bases: ['BaseClass'],
  methods: [pythonFunction],
  properties: [],
  docstring: 'A calculator class',
  decorators: []
};
expectType<PythonClass>(pythonClass);

// Modules should contain functions and classes
const pythonModule: PythonModule = {
  name: 'math_utils',
  path: '/path/to/math_utils.py',
  functions: [pythonFunction],
  classes: [pythonClass],
  imports: [
    { module: 'os', fromImport: false },
    { module: 'typing', name: 'List', fromImport: true }
  ],
  exports: ['add_numbers', 'Calculator']
};
expectType<PythonModule>(pythonModule);

// Analysis results should contain all expected fields
const analysisResult: AnalysisResult = {
  module: pythonModule,
  errors: [],
  warnings: [],
  dependencies: ['os', 'typing'],
  statistics: {
    functionsAnalyzed: 1,
    classesAnalyzed: 1,
    typeHintsCoverage: 100,
    estimatedComplexity: 2
  }
};
expectType<AnalysisResult>(analysisResult);

// =============================================================================
// Runtime Bridge Type Tests
// =============================================================================

// Runtime bridges should be constructible
expectType<NodeBridge>(new NodeBridge());
expectType<PyodideBridge>(new PyodideBridge());
expectType<HttpBridge>(new HttpBridge({ baseURL: 'http://localhost:8000' }));

setRuntimeBridge(new NodeBridge());
expectAssignable<ReturnType<typeof getRuntimeBridge>>(new NodeBridge());
const runtimeBridge = getRuntimeBridge();
clearRuntimeBridge();
expectType<ReturnType<typeof getRuntimeBridge>>(runtimeBridge);

const protocolError = new BridgeProtocolError('bad protocol');
expectType<BridgeError>(protocolError);

// =============================================================================
// Runtime Detection Type Tests
// =============================================================================

// Runtime detection functions should return correct types
// Note: Actual return types may vary based on implementation
const runtime = detectRuntime();
expectType<boolean>(isNodejs());
expectType<boolean>(isDeno());
expectType<boolean>(isBun());
expectType<boolean>(isBrowser());

// =============================================================================
// Configuration Type Tests
// =============================================================================

// TywrapOptions requires all fields, functions accept Partial<TywrapOptions>
expectAssignable<Partial<TywrapOptions>>({});
expectAssignable<Partial<TywrapOptions>>({
  output: {
    dir: './generated',
    format: 'esm',
    declaration: true,
    sourceMap: true
  }
});

// Runtime strategy should be constrained to valid values
expectAssignable<RuntimeStrategy>('pyodide');
expectAssignable<RuntimeStrategy>('node');
expectAssignable<RuntimeStrategy>('http');
expectAssignable<RuntimeStrategy>('auto');

// =============================================================================
// Complex Type Composition Tests  
// =============================================================================

// Test complex nested types work correctly
const complexType: PythonType = {
  kind: 'collection',
  name: 'dict',
  itemTypes: [
    { kind: 'primitive', name: 'str' }, // key type
    {
      kind: 'union',
      types: [
        { kind: 'primitive', name: 'int' },
        { kind: 'collection', name: 'list', itemTypes: [{ kind: 'primitive', name: 'str' }] }
      ]
    }
  ]
};
expectType<CollectionType>(complexType);

// Test Optional with complex inner types
const complexOptional: OptionalType = {
  kind: 'optional',
  type: {
    kind: 'collection',
    name: 'list',
    itemTypes: [
      {
        kind: 'union',
        types: [
          { kind: 'primitive', name: 'int' },
          { kind: 'custom', name: 'MyClass' }
        ]
      }
    ]
  }
};
expectType<OptionalType>(complexOptional);

// =============================================================================
// Additional Type Safety Tests
// =============================================================================

// Test that type system correctly constrains values
const validParameter: Parameter = {
  name: 'x',
  type: { kind: 'primitive', name: 'int' },
  optional: false,
  varArgs: false,
  kwArgs: false
};
expectType<Parameter>(validParameter);

// Test full TywrapOptions structure
const fullConfig: TywrapOptions = {
  pythonModules: {
    'numpy': {
      runtime: 'pyodide',
      typeHints: 'strict'
    }
  },
  output: {
    dir: './generated',
    format: 'esm',
    declaration: true,
    sourceMap: true
  },
  runtime: {
    pyodide: {
      indexURL: 'https://cdn.jsdelivr.net/pyodide/',
      packages: ['numpy']
    }
  },
  performance: {
    caching: true,
    batching: true,
    compression: 'auto'
  }
};
expectType<TywrapOptions>(fullConfig);

// =============================================================================
// Root Public Surface Lock
// =============================================================================
//
// Snapshot the intended `tywrap` (package root) value-level export set. This
// catches accidental additions/removals — including type-only moves, which a
// runtime Object.keys() snapshot cannot see. The complementary runtime snapshot
// lives in test/api_surface.test.ts.
//
// Keep this list in sync with src/index.ts. When the public surface changes on
// purpose, update both this lock and the runtime snapshot in the same commit.

import * as RootApi from '../src/index.js';

// Intended value exports must be present (accessing each must type-check).
expectType<typeof import('../src/tywrap.js').tywrap>(RootApi.tywrap);
expectType<typeof RootApi.tywrap>(RootApi.default);
expectType<typeof import('../src/config/index.js').defineConfig>(RootApi.defineConfig);
expectType<typeof import('../src/config/index.js').resolveConfig>(RootApi.resolveConfig);
expectType<typeof import('../src/tywrap.js').generate>(RootApi.generate);
expectType<typeof import('../src/runtime/errors.js').BridgeError>(RootApi.BridgeError);
expectType<typeof import('../src/runtime/errors.js').BridgeCodecError>(RootApi.BridgeCodecError);
expectType<typeof import('../src/runtime/errors.js').BridgeProtocolError>(
  RootApi.BridgeProtocolError
);
expectType<typeof import('../src/runtime/errors.js').BridgeTimeoutError>(
  RootApi.BridgeTimeoutError
);
expectType<typeof import('../src/runtime/errors.js').BridgeDisposedError>(
  RootApi.BridgeDisposedError
);
expectType<typeof import('../src/runtime/errors.js').BridgeExecutionError>(
  RootApi.BridgeExecutionError
);
expectType<typeof import('../src/utils/codec.js').decodeValue>(RootApi.decodeValue);
expectType<typeof import('../src/utils/codec.js').decodeValueAsync>(RootApi.decodeValueAsync);
expectType<typeof import('../src/utils/codec.js').autoRegisterArrowDecoder>(
  RootApi.autoRegisterArrowDecoder
);
expectType<typeof import('../src/utils/codec.js').registerArrowDecoder>(
  RootApi.registerArrowDecoder
);
expectType<typeof import('../src/utils/codec.js').clearArrowDecoder>(RootApi.clearArrowDecoder);
expectType<typeof import('../src/utils/runtime.js').detectRuntime>(RootApi.detectRuntime);
expectType<typeof import('../src/utils/runtime.js').isNodejs>(RootApi.isNodejs);
expectType<typeof import('../src/utils/runtime.js').isDeno>(RootApi.isDeno);
expectType<typeof import('../src/utils/runtime.js').isBun>(RootApi.isBun);
expectType<typeof import('../src/utils/runtime.js').isBrowser>(RootApi.isBrowser);
expectType<typeof import('../src/version.js').VERSION>(RootApi.VERSION);

// Moved/removed members must NOT be reachable from the package root.
// Codec + transport contract moved to `tywrap/runtime`:
expectError(RootApi.SafeCodec);
expectError(RootApi.isTransport);
expectError(RootApi.isProtocolMessage);
expectError(RootApi.isProtocolResponse);
expectError(RootApi.PROTOCOL_ID);
// Registry moved to `tywrap/runtime`:
expectError(RootApi.setRuntimeBridge);
expectError(RootApi.getRuntimeBridge);
expectError(RootApi.clearRuntimeBridge);
// Concrete bridges live behind their own subpaths:
expectError(RootApi.NodeBridge);
expectError(RootApi.PyodideBridge);
expectError(RootApi.HttpBridge);
// Deprecated alias removed:
expectError(RootApi.RuntimeBridge);
// Other runtime plumbing is non-public:
expectError(RootApi.RpcClient);
expectError(RootApi.DisposableBase);
expectError(RootApi.WorkerPool);
expectError(RootApi.ProcessIO);
expectError(RootApi.ValidationError);
