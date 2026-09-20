/**
 * Pure callable compilation.
 *
 * `generate()` owns discovery, caching, and writes. This module owns the
 * deterministic step between validated IR and generated wrapper files.
 */

import {
  VALUE_CONTRACT_REVISION,
  type ValueContract,
} from '../contracts/value-contract.js';
import type {
  GeneratedCode,
  Parameter,
  PythonFunction,
  PythonModule,
  PythonType,
} from '../types/index.js';
import type { CodeGenerator } from './generator.js';
import type { ValidatedIrContract } from './ir-contract.js';

export type CallableDirection = 'input' | 'output';

export type CallableCapability =
  | 'value-rpc'
  | 'return-validation'
  | 'scientific-ndarray'
  | 'scientific-torch'
  | 'coroutine-execution'
  | 'dataclass-adapter';

export interface CapabilityDescription {
  name: CallableCapability;
  available: boolean;
  guidance: string;
}

export interface ValueConversionRequest {
  direction: CallableDirection;
  logicalType: PythonType;
  path: string;
}

export interface SupportedValueResolution {
  status: 'supported';
  value: ValueContract;
}

export interface UnsupportedValueResolution {
  status: 'unsupported';
  reason: string;
  guidance: string;
}

export interface UnresolvedValueResolution {
  status: 'unresolved';
  annotation: string;
}

export type ValueResolution =
  | SupportedValueResolution
  | UnsupportedValueResolution
  | UnresolvedValueResolution;

/**
 * Maps an internal Python type to the frozen #343 value policy.
 *
 * The compiler does not infer wire behavior from a TypeScript spelling.
 */
export interface ValueConversionDescription {
  revision: typeof VALUE_CONTRACT_REVISION;
  resolve(request: ValueConversionRequest): ValueResolution;
}

export interface CallableCompilationDiagnostic {
  severity: 'warning' | 'error';
  code:
    | 'conversion-unresolved'
    | 'conversion-unsupported'
    | 'capability-unavailable'
    | 'coroutine-unsupported'
    | 'dataclass-unsupported';
  path: string;
  message: string;
}

export interface ResolvedCallableValue {
  direction: CallableDirection;
  path: string;
  logicalType: PythonType;
  resolution: ValueResolution;
}

export interface ResolvedCallable {
  name: string;
  path: string;
  parameters: readonly ResolvedCallableValue[];
  result: ResolvedCallableValue;
  overloadResults: readonly ResolvedCallableValue[];
  requiredCapabilities: readonly CallableCapability[];
}

export interface CompiledFile {
  kind: 'typescript' | 'declaration';
  content: string;
}

export interface CompiledContract {
  /** Validated IR identity. It is retained for diagnostics and reproducibility. */
  ir: Pick<ValidatedIrContract, 'ir_version' | 'module'>;
  /** Resolved model consumed by declarations, wrappers, and return validators. */
  module: PythonModule;
  callables: readonly ResolvedCallable[];
  diagnostics: readonly CallableCompilationDiagnostic[];
  files: readonly CompiledFile[];
  generated: GeneratedCode;
}

export interface CompileContractOptions {
  /** Parser-mapped model derived from the supplied validated IR. */
  module: PythonModule;
  /** The generator is synchronous and performs no filesystem or runtime work. */
  generator: Pick<CodeGenerator, 'generateModuleDefinition'>;
  conversion: ValueConversionDescription;
  capabilities: readonly CapabilityDescription[];
  annotatedJSDoc?: boolean;
}

const UNKNOWN_TYPE: PythonType = { kind: 'custom', name: 'Any', module: 'typing' };

export const DEFAULT_CALLABLE_CAPABILITIES: readonly CapabilityDescription[] = [
  {
    name: 'value-rpc',
    available: true,
    guidance: 'Use the existing tywrap/1 value RPC transport.',
  },
  {
    name: 'return-validation',
    available: true,
    guidance: 'Generate a return validator for supported decoded values.',
  },
  {
    name: 'scientific-ndarray',
    available: true,
    guidance: 'Keep the existing ndarray Arrow envelope and JSON fallback.',
  },
  {
    name: 'scientific-torch',
    available: true,
    guidance: 'Reuse the ndarray conversion inside the existing Torch envelope.',
  },
  {
    name: 'coroutine-execution',
    available: false,
    guidance: 'Coroutine execution belongs to #338. Expose a value-returning adapter until then.',
  },
  {
    name: 'dataclass-adapter',
    available: false,
    guidance: 'Use a TypedDict or an explicit record adapter until #339 defines dataclass conversion.',
  },
];

function leafName(type: PythonType): string | null {
  if (type.kind !== 'custom' && type.kind !== 'generic') {
    return null;
  }
  return type.name.split('.').at(-1) ?? null;
}

function annotationName(type: PythonType): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'custom':
    case 'generic':
      return type.module ? `${type.module}.${type.name}` : type.name;
    default:
      return type.kind;
  }
}

function firstUnresolvedChild(
  resolutions: readonly ValueResolution[]
): UnsupportedValueResolution | UnresolvedValueResolution | null {
  return resolutions.find(resolution => resolution.status !== 'supported') ?? null;
}

function resolveSequence(
  item: PythonType,
  request: ValueConversionRequest,
  conversion: ValueConversionDescription
): ValueResolution {
  const child = conversion.resolve({ ...request, logicalType: item, path: `${request.path}[]` });
  if (child.status !== 'supported') {
    return child;
  }
  return {
    status: 'supported',
    value: { kind: 'sequence', wire: 'json', decodedAs: 'array', item: child.value },
  };
}

function resolveRecord(
  valueType: PythonType,
  request: ValueConversionRequest,
  conversion: ValueConversionDescription
): ValueResolution {
  const child = conversion.resolve({ ...request, logicalType: valueType, path: `${request.path}{value}` });
  if (child.status !== 'supported') {
    return child;
  }
  return {
    status: 'supported',
    value: {
      kind: 'record',
      wire: 'json',
      decodedAs: 'object',
      fields: [],
      additionalValues: child.value,
    },
  };
}

function resolveTuple(
  items: readonly PythonType[],
  request: ValueConversionRequest,
  conversion: ValueConversionDescription
): ValueResolution {
  if (items.length === 0) {
    return {
      status: 'supported',
      value: {
        kind: 'sequence',
        wire: 'json',
        decodedAs: 'array',
        item: { kind: 'null', wire: 'json', decodedAs: 'null' },
      },
    };
  }
  const entries = items.map((item, index) =>
    conversion.resolve({ ...request, logicalType: item, path: `${request.path}[${index}]` })
  );
  const childFailure = firstUnresolvedChild(entries);
  if (childFailure) {
    return childFailure;
  }
  const values = entries as SupportedValueResolution[];
  const first = values[0]?.value;
  if (!first || values.some(entry => JSON.stringify(entry.value) !== JSON.stringify(first))) {
    return {
      status: 'unsupported',
      reason: 'The frozen value contract does not represent a heterogeneous tuple.',
      guidance: 'Return a TypedDict or a homogeneous list until tuple conversion is specified.',
    };
  }
  return {
    status: 'supported',
    value: { kind: 'sequence', wire: 'json', decodedAs: 'array', item: first },
  };
}

function resolveNdarray(type: PythonType): ValueResolution {
  const typeArgument = type.kind === 'generic' ? type.typeArgs[0] : undefined;
  const dtype = typeArgument ? leafName(typeArgument) : undefined;
  const normalizedDtype = dtype?.toLowerCase();
  if (normalizedDtype && normalizedDtype !== 'float16') {
    return {
      status: 'unresolved',
      annotation: `${annotationName(type)}[${dtype}]`,
    };
  }
  return {
    status: 'supported',
    value: {
      kind: 'ndarray-float16',
      wire: 'arrow',
      decodedAs: 'nested-array-or-scalar',
      element: { kind: 'float', wire: 'json', decodedAs: 'number', constraint: 'finite' },
      dtype: 'float16',
    },
  };
}

/** The conversion set that #335 may use with the frozen value-contract revision. */
export const DEFAULT_VALUE_CONVERSION: ValueConversionDescription = {
  revision: VALUE_CONTRACT_REVISION,
  resolve(request): ValueResolution {
    const { logicalType: type } = request;
    switch (type.kind) {
      case 'primitive':
        if (type.name === 'None') {
          return { status: 'supported', value: { kind: 'null', wire: 'json', decodedAs: 'null' } };
        }
        if (type.name === 'bool') {
          return {
            status: 'supported',
            value: { kind: 'boolean', wire: 'json', decodedAs: 'boolean' },
          };
        }
        if (type.name === 'int') {
          return {
            status: 'supported',
            value: {
              kind: 'integer',
              wire: 'json',
              decodedAs: 'number',
              constraint: 'safe-integer',
            },
          };
        }
        if (type.name === 'float') {
          return {
            status: 'supported',
            value: { kind: 'float', wire: 'json', decodedAs: 'number', constraint: 'finite' },
          };
        }
        if (type.name === 'str') {
          return { status: 'supported', value: { kind: 'string', wire: 'json', decodedAs: 'string' } };
        }
        return {
          status: 'unsupported',
          reason: 'The frozen value contract does not specify bytes conversion.',
          guidance: 'Use an explicit string or ndarray adapter for byte data.',
        };
      case 'annotated':
        return DEFAULT_VALUE_CONVERSION.resolve({ ...request, logicalType: type.base });
      case 'final':
      case 'classvar':
        return DEFAULT_VALUE_CONVERSION.resolve({ ...request, logicalType: type.type });
      case 'collection':
        if (type.name === 'dict') {
          const key = type.itemTypes[0];
          if (key?.kind !== 'primitive' || key.name !== 'str') {
            return {
              status: 'unsupported',
              reason: 'The frozen record contract requires string keys.',
              guidance: 'Convert keys to strings before crossing the value RPC boundary.',
            };
          }
          return resolveRecord(
            type.itemTypes[1] ?? UNKNOWN_TYPE,
            request,
            DEFAULT_VALUE_CONVERSION
          );
        }
        if (type.name === 'tuple') {
          return resolveTuple(type.itemTypes, request, DEFAULT_VALUE_CONVERSION);
        }
        return resolveSequence(type.itemTypes[0] ?? UNKNOWN_TYPE, request, DEFAULT_VALUE_CONVERSION);
      case 'generic': {
        const leaf = leafName(type);
        if (leaf === 'NDArray' || leaf === 'ndarray') {
          return resolveNdarray(type);
        }
        if (['list', 'List', 'Sequence', 'Iterable', 'set', 'frozenset'].includes(leaf ?? '')) {
          return resolveSequence(type.typeArgs[0] ?? UNKNOWN_TYPE, request, DEFAULT_VALUE_CONVERSION);
        }
        if (['dict', 'Dict', 'Mapping', 'MutableMapping'].includes(leaf ?? '')) {
          const key = type.typeArgs[0];
          if (key?.kind !== 'primitive' || key.name !== 'str') {
            return {
              status: 'unsupported',
              reason: 'The frozen record contract requires string keys.',
              guidance: 'Convert keys to strings before crossing the value RPC boundary.',
            };
          }
          return resolveRecord(type.typeArgs[1] ?? UNKNOWN_TYPE, request, DEFAULT_VALUE_CONVERSION);
        }
        return { status: 'unresolved', annotation: annotationName(type) };
      }
      case 'custom': {
        const leaf = leafName(type);
        if (leaf === 'ndarray' || leaf === 'NDArray') {
          return resolveNdarray(type);
        }
        if (leaf === 'Tensor' && type.module?.startsWith('torch')) {
          const ndarray = resolveNdarray({ kind: 'custom', name: 'ndarray', module: 'numpy' });
          if (ndarray.status !== 'supported' || ndarray.value.kind !== 'ndarray-float16') {
            return ndarray;
          }
          return {
            status: 'supported',
            value: {
              kind: 'torch-float16',
              wire: 'ndarray-envelope',
              decodedAs: 'tensor-record',
              value: ndarray.value,
            },
          };
        }
        return { status: 'unresolved', annotation: annotationName(type) };
      }
      default:
        return { status: 'unresolved', annotation: annotationName(type) };
    }
  },
};

function capabilityNamesFor(value: ValueContract): CallableCapability[] {
  const names: CallableCapability[] = ['value-rpc', 'return-validation'];
  if (value.kind === 'ndarray-float16') {
    names.push('scientific-ndarray');
  }
  if (value.kind === 'torch-float16') {
    names.push('scientific-torch', 'scientific-ndarray');
  }
  return names;
}

function containsNamedType(type: PythonType, names: ReadonlySet<string>): boolean {
  if ((type.kind === 'custom' || type.kind === 'generic') && names.has(leafName(type) ?? '')) {
    return true;
  }
  switch (type.kind) {
    case 'collection':
      return type.itemTypes.some(item => containsNamedType(item, names));
    case 'union':
      return type.types.some(item => containsNamedType(item, names));
    case 'optional':
    case 'final':
    case 'classvar':
    case 'unpack':
      return containsNamedType(type.type, names);
    case 'annotated':
      return containsNamedType(type.base, names);
    case 'generic':
      return type.typeArgs.some(item => containsNamedType(item, names));
    case 'callable':
      return (
        type.parameters.some(item => containsNamedType(item, names)) ||
        containsNamedType(type.returnType, names)
      );
    default:
      return false;
  }
}

function diagnosticForResolution(
  resolution: ValueResolution,
  path: string
): CallableCompilationDiagnostic | null {
  if (resolution.status === 'supported') {
    return null;
  }
  if (resolution.status === 'unresolved') {
    return {
      severity: 'warning',
      code: 'conversion-unresolved',
      path,
      message: `${path}: no value conversion is defined for ${resolution.annotation}; the generated type keeps its existing explicit fallback.`,
    };
  }
  return {
    severity: 'error',
    code: 'conversion-unsupported',
    path,
    message: `${path}: ${resolution.reason} ${resolution.guidance}`,
  };
}

function resolveCallable(
  func: PythonFunction,
  path: string,
  conversion: ValueConversionDescription,
  capabilities: ReadonlyMap<CallableCapability, CapabilityDescription>,
  dataclassNames: ReadonlySet<string>,
  diagnostics: CallableCompilationDiagnostic[]
): { function: PythonFunction; callable: ResolvedCallable } {
  const parameters = func.parameters.map((parameter, index) => ({
    direction: 'input' as const,
    path: `${path}.parameters[${index}]`,
    logicalType: parameter.type,
    resolution: conversion.resolve({
      direction: 'input',
      logicalType: parameter.type,
      path: `${path}.parameters[${index}]`,
    }),
  }));
  const result: ResolvedCallableValue = {
    direction: 'output',
    path: `${path}.returns`,
    logicalType: func.returnType,
    resolution: conversion.resolve({ direction: 'output', logicalType: func.returnType, path: `${path}.returns` }),
  };
  const overloadResults = (func.overloads ?? []).map((overload, index) => ({
    direction: 'output' as const,
    path: `${path}.overloads[${index}].returns`,
    logicalType: overload.returnType,
    resolution: conversion.resolve({
      direction: 'output',
      logicalType: overload.returnType,
      path: `${path}.overloads[${index}].returns`,
    }),
  }));
  const requiredCapabilities = new Set<CallableCapability>();
  for (const value of [...parameters, result, ...overloadResults]) {
    const diagnostic = diagnosticForResolution(value.resolution, value.path);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
    if (value.resolution.status === 'supported') {
      capabilityNamesFor(value.resolution.value).forEach(capability => requiredCapabilities.add(capability));
    }
  }

  const forceUnsupportedOutput = (
    resolution: ValueResolution,
    logicalType: PythonType,
    outputPath: string
  ): ValueResolution => {
    if (containsNamedType(logicalType, dataclassNames)) {
      diagnostics.push({
        severity: 'error',
        code: 'dataclass-unsupported',
        path: outputPath,
        message: `${outputPath}: a dataclass annotation has no value adapter. Use a TypedDict or an explicit record adapter until #339.`,
      });
      return {
        status: 'unsupported',
        reason: 'No dataclass value adapter is available.',
        guidance: 'Use a TypedDict or an explicit record adapter.',
      };
    }
    if (func.isAsync && capabilities.get('coroutine-execution')?.available !== true) {
      diagnostics.push({
        severity: 'error',
        code: 'coroutine-unsupported',
        path: outputPath,
        message: `${outputPath}: this callable requires coroutine execution, which #338 has not implemented.`,
      });
      return {
        status: 'unsupported',
        reason: 'Coroutine execution is unavailable.',
        guidance: 'Expose a synchronous value-returning adapter until #338 lands.',
      };
    }
    return resolution;
  };

  result.resolution = forceUnsupportedOutput(result.resolution, result.logicalType, result.path);
  overloadResults.forEach(overload => {
    overload.resolution = forceUnsupportedOutput(
      overload.resolution,
      overload.logicalType,
      overload.path
    );
  });
  for (const capability of requiredCapabilities) {
    const description = capabilities.get(capability);
    if (description?.available !== true) {
      diagnostics.push({
        severity: 'error',
        code: 'capability-unavailable',
        path,
        message: `${path}: ${capability} is required. ${description?.guidance ?? 'Add a declared capability before generating this callable.'}`,
      });
    }
  }

  const resolvedParameters: Parameter[] = parameters.map((parameter, index) => ({
    ...func.parameters[index]!,
    type:
      parameter.resolution.status === 'unsupported' ? UNKNOWN_TYPE : parameter.logicalType,
  }));
  const resolvedOverloads = (func.overloads ?? []).map((overload, index) => ({
    ...overload,
    returnType:
      overloadResults[index]?.resolution.status === 'unsupported' ? UNKNOWN_TYPE : overload.returnType,
  }));
  const resolvedFunction: PythonFunction = {
    ...func,
    parameters: resolvedParameters,
    signature: {
      ...func.signature,
      parameters: resolvedParameters,
      returnType: result.resolution.status === 'unsupported' ? UNKNOWN_TYPE : func.returnType,
    },
    returnType: result.resolution.status === 'unsupported' ? UNKNOWN_TYPE : func.returnType,
    overloads: resolvedOverloads,
  };
  return {
    function: resolvedFunction,
    callable: {
      name: func.name,
      path,
      parameters,
      result,
      overloadResults,
      requiredCapabilities: [...requiredCapabilities].sort(),
    },
  };
}

/**
 * Compile already-validated IR without filesystem, subprocess, cache, or
 * registry access. `generate()` supplies the model and writes these files.
 */
export function compileContract(
  ir: ValidatedIrContract,
  options: CompileContractOptions
): CompiledContract {
  const capabilities = new Map(options.capabilities.map(capability => [capability.name, capability]));
  const dataclassNames = new Set(
    options.module.classes.filter(cls => cls.kind === 'dataclass').map(cls => cls.name)
  );
  const diagnostics: CallableCompilationDiagnostic[] = [];
  const callables: ResolvedCallable[] = [];
  const compileFunction = (func: PythonFunction, path: string): PythonFunction => {
    const result = resolveCallable(
      func,
      path,
      options.conversion,
      capabilities,
      dataclassNames,
      diagnostics
    );
    callables.push(result.callable);
    return result.function;
  };
  const module: PythonModule = {
    ...options.module,
    functions: options.module.functions.map((func, index) =>
      compileFunction(func, `$.functions[${index}]`)
    ),
    classes: options.module.classes.map((cls, classIndex) => ({
      ...cls,
      methods: cls.methods.map((method, methodIndex) =>
        compileFunction(method, `$.classes[${classIndex}].methods[${methodIndex}]`)
      ),
    })),
  };
  const generated = options.generator.generateModuleDefinition(module, options.annotatedJSDoc);
  return {
    ir: { ir_version: ir.ir_version, module: ir.module },
    module,
    callables,
    diagnostics,
    files: [
      { kind: 'typescript', content: generated.typescript },
      { kind: 'declaration', content: generated.declaration },
    ],
    generated,
  };
}
