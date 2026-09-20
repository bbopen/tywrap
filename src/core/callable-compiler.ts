/**
 * Pure callable compilation.
 *
 * `generate()` owns discovery, caching, and writes. This module owns the
 * deterministic step between validated IR and generated wrapper files.
 */

import {
  VALUE_CONTRACT_REVISION,
  type ValueContract,
  type ValueContractField,
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
import { transformIrToTsModel } from './ir-model.js';

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
  /** Internal recursion counter. Revision 2 rejects contracts deeper than 64 nodes. */
  depth?: number;
  /** Compile-local resolver for nested named values. */
  resolveNested?: (request: ValueConversionRequest) => ValueResolution;
  /** Exact local names already being expanded, used to stop recursive aliases. */
  activeNames?: readonly string[];
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
    | 'dataclass-unsupported'
    | 'overload-ambiguous';
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
  overloadParameters: readonly (readonly ResolvedCallableValue[])[];
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
  /** Select exported names only. The compiler derives all types from validated IR. */
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
    available: true,
    guidance: 'Use a runtime bridge that awaits Python coroutine results.',
  },
  {
    name: 'dataclass-adapter',
    available: false,
    guidance:
      'Use a TypedDict or an explicit record adapter until #339 defines dataclass conversion.',
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
  const child = conversion.resolve({
    ...request,
    logicalType: item,
    path: `${request.path}[]`,
    depth: (request.depth ?? 0) + 1,
  });
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
  const child = conversion.resolve({
    ...request,
    logicalType: valueType,
    path: `${request.path}{value}`,
    depth: (request.depth ?? 0) + 1,
  });
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
        kind: 'tuple',
        wire: 'json',
        decodedAs: 'array',
        items: [],
      },
    };
  }
  if (items.length === 2 && items[1]?.kind === 'custom' && items[1].name === '...') {
    return resolveSequence(items[0]!, request, conversion);
  }
  const entries = items.map((item, index) =>
    conversion.resolve({
      ...request,
      logicalType: item,
      path: `${request.path}[${index}]`,
      depth: (request.depth ?? 0) + 1,
    })
  );
  const childFailure = firstUnresolvedChild(entries);
  if (childFailure) {
    return childFailure;
  }
  const values = entries as SupportedValueResolution[];
  return {
    status: 'supported',
    value: {
      kind: 'tuple',
      wire: 'json',
      decodedAs: 'array',
      items: values.map(entry => entry.value),
    },
  };
}

type WireRelation = 'disjoint' | 'same-decoding' | 'ambiguous';

function combineWireRelations(relations: readonly WireRelation[]): WireRelation {
  if (relations.includes('ambiguous')) {
    return 'ambiguous';
  }
  return relations.includes('same-decoding') ? 'same-decoding' : 'disjoint';
}

type WireCategory = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object' | 'unknown';

function acceptsWireCategory(value: ValueContract, category: WireCategory): boolean {
  if (category === 'unknown' || value.kind === 'unsupported') {
    return true;
  }
  if (value.kind === 'union') {
    return value.options.some(option => acceptsWireCategory(option, category));
  }
  const expected: WireCategory = (() => {
    switch (value.kind) {
      case 'null':
        return 'null';
      case 'boolean':
        return 'boolean';
      case 'integer':
      case 'float':
        return 'number';
      case 'string':
        return 'string';
      case 'sequence':
      case 'tuple':
        return 'array';
      case 'bytes':
      case 'record':
      case 'ndarray-float16':
      case 'torch-float16':
        return 'object';
    }
  })();
  return expected === category;
}

function taggedEnvelopeShapes(
  value: ValueContract
): readonly Readonly<Record<string, WireCategory>>[] {
  switch (value.kind) {
    case 'bytes':
      return [
        { __type__: 'string', encoding: 'string', data: 'string' },
        { __tywrap_bytes__: 'boolean', b64: 'string' },
      ];
    case 'ndarray-float16':
      return [
        {
          __tywrap__: 'string',
          codecVersion: 'number',
          encoding: 'string',
          b64: 'string',
          shape: 'array',
          dtype: 'string',
        },
        {
          __tywrap__: 'string',
          codecVersion: 'number',
          encoding: 'string',
          data: 'unknown',
          shape: 'array',
          dtype: 'string',
        },
      ];
    case 'torch-float16':
      return [
        {
          __tywrap__: 'string',
          codecVersion: 'number',
          encoding: 'string',
          value: 'object',
          shape: 'array',
          dtype: 'string',
          device: 'string',
        },
      ];
    default:
      return [];
  }
}

function recordCanMatchEnvelope(
  record: Extract<ValueContract, { kind: 'record' }>,
  envelope: Readonly<Record<string, WireCategory>>
): boolean {
  const fields = new Map(record.fields.map(field => [field.name, field] as const));
  if (record.fields.some(field => field.required && !(field.name in envelope))) {
    return false;
  }
  for (const [name, category] of Object.entries(envelope)) {
    const field = fields.get(name);
    if (field && !acceptsWireCategory(field.value, category)) {
      return false;
    }
    if (record.additionalValues && !acceptsWireCategory(record.additionalValues, category)) {
      return false;
    }
  }
  return true;
}

function taggedRecordRelation(
  record: Extract<ValueContract, { kind: 'record' }>,
  tagged: ValueContract
): WireRelation {
  return taggedEnvelopeShapes(tagged).some(envelope => recordCanMatchEnvelope(record, envelope))
    ? 'ambiguous'
    : 'disjoint';
}

function recordWireRelation(left: ValueContract, right: ValueContract): WireRelation {
  if (left.kind !== 'record' || right.kind !== 'record') {
    return 'disjoint';
  }
  const leftFields = new Map(left.fields.map(field => [field.name, field] as const));
  const rightFields = new Map(right.fields.map(field => [field.name, field] as const));
  const relations: WireRelation[] = [];
  for (const field of left.fields) {
    const otherField = rightFields.get(field.name);
    const other = otherField?.value ?? right.additionalValues;
    if (other) {
      const relation = valueWireRelation(field.value, other);
      if (relation === 'disjoint' && (field.required || otherField?.required)) {
        return 'disjoint';
      }
      relations.push(relation);
    }
  }
  for (const field of right.fields) {
    if (leftFields.has(field.name)) {
      continue;
    }
    if (left.additionalValues) {
      const relation = valueWireRelation(left.additionalValues, field.value);
      if (relation === 'disjoint' && field.required) {
        return 'disjoint';
      }
      relations.push(relation);
    }
  }
  if (left.additionalValues && right.additionalValues) {
    relations.push(valueWireRelation(left.additionalValues, right.additionalValues));
  }
  return relations.includes('ambiguous') ? 'ambiguous' : 'same-decoding';
}

function valueWireRelation(left: ValueContract, right: ValueContract): WireRelation {
  if (left.kind === 'unsupported' || right.kind === 'unsupported') {
    return 'ambiguous';
  }
  if (left.kind === 'union') {
    return combineWireRelations(left.options.map(option => valueWireRelation(option, right)));
  }
  if (right.kind === 'union') {
    return combineWireRelations(right.options.map(option => valueWireRelation(left, option)));
  }
  if (left.kind === 'record' && right.kind === 'record') {
    return recordWireRelation(left, right);
  }
  if (left.kind === 'record' && taggedEnvelopeShapes(right).length > 0) {
    return taggedRecordRelation(left, right);
  }
  if (right.kind === 'record' && taggedEnvelopeShapes(left).length > 0) {
    return taggedRecordRelation(right, left);
  }
  if (left.kind === 'sequence' && right.kind === 'sequence') {
    return valueWireRelation(left.item, right.item) === 'ambiguous' ? 'ambiguous' : 'same-decoding';
  }
  if (left.kind === 'tuple' && right.kind === 'tuple') {
    if (left.items.length !== right.items.length) {
      return 'disjoint';
    }
    const relations = left.items.map((item, index) => valueWireRelation(item, right.items[index]!));
    return relations.includes('disjoint') ? 'disjoint' : combineWireRelations(relations);
  }
  if (left.kind === 'sequence' && right.kind === 'tuple') {
    const relations = right.items.map(item => valueWireRelation(left.item, item));
    return relations.includes('disjoint') ? 'disjoint' : combineWireRelations(relations);
  }
  if (left.kind === 'tuple' && right.kind === 'sequence') {
    return valueWireRelation(right, left);
  }
  if (
    (left.kind === 'integer' && right.kind === 'float') ||
    (left.kind === 'float' && right.kind === 'integer')
  ) {
    return 'same-decoding';
  }
  return left.kind === right.kind ? 'same-decoding' : 'disjoint';
}

function resolveUnion(
  options: readonly PythonType[],
  request: ValueConversionRequest,
  conversion: ValueConversionDescription
): ValueResolution {
  if (options.length < 2 || options.length > 32) {
    return {
      status: 'unsupported',
      reason: 'Revision 2 accepts unions with two to 32 alternatives.',
      guidance: 'Split a larger union or provide an explicit tagged record adapter.',
    };
  }
  const entries = options.map((option, index) =>
    conversion.resolve({
      ...request,
      logicalType: option,
      path: `${request.path}.options[${index}]`,
      depth: (request.depth ?? 0) + 1,
    })
  );
  const childFailure = firstUnresolvedChild(entries);
  if (childFailure) {
    return childFailure;
  }
  const values = entries as SupportedValueResolution[];
  const first = values[0]?.value;
  const second = values[1]?.value;
  if (!first || !second) {
    return {
      status: 'unsupported',
      reason: 'Revision 2 requires at least two supported union alternatives.',
      guidance: 'Provide two explicit value alternatives.',
    };
  }
  for (let index = 0; index < values.length; index += 1) {
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (valueWireRelation(values[earlier]!.value, values[index]!.value) === 'ambiguous') {
        return {
          status: 'unsupported',
          reason: 'Union alternatives can share a wire value but decode differently.',
          guidance: 'Use a disjoint tagged record or split the union.',
        };
      }
    }
  }
  return {
    status: 'supported',
    value: {
      kind: 'union',
      wire: 'selected-option',
      decodedAs: 'selected-option',
      options: [first, second, ...values.slice(2).map(entry => entry.value)],
    },
  };
}

function resolveNdarray(type: PythonType): ValueResolution {
  const typeArgument =
    type.kind === 'generic' &&
    type.typeArgs.length === 2 &&
    type.typeArgs[1]?.kind === 'generic' &&
    type.typeArgs[1].name === 'dtype' &&
    type.typeArgs[1].module === 'numpy' &&
    (type.typeArgs[0]?.kind === 'collection' ||
      (type.typeArgs[0]?.kind === 'custom' && type.typeArgs[0].name === 'Any'))
      ? type.typeArgs[1].typeArgs[0]
      : type.kind === 'generic' && type.typeArgs.length === 1
        ? type.typeArgs[0]
        : undefined;
  if (
    typeArgument?.kind !== 'custom' ||
    typeArgument.name !== 'float16' ||
    typeArgument.module !== 'numpy'
  ) {
    return {
      status: 'unresolved',
      annotation: annotationName(type),
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

function resolveTorchFloat16(): ValueResolution {
  const ndarray = resolveNdarray({
    kind: 'generic',
    name: 'ndarray',
    module: 'numpy',
    typeArgs: [{ kind: 'custom', name: 'float16', module: 'numpy' }],
  });
  if (ndarray.status !== 'supported' || ndarray.value.kind !== 'ndarray-float16') {
    return ndarray;
  }
  return {
    status: 'supported',
    value: {
      kind: 'torch-float16',
      wire: 'ndarray-envelope',
      decodedAs: 'tensor-record',
      dtype: 'torch.float16',
      value: ndarray.value,
    },
  };
}

/** The conversion set that #335 may use with the frozen value-contract revision. */
export const DEFAULT_VALUE_CONVERSION: ValueConversionDescription = {
  revision: VALUE_CONTRACT_REVISION,
  resolve(request): ValueResolution {
    const { logicalType: type } = request;
    const nestedConversion: ValueConversionDescription = request.resolveNested
      ? { revision: VALUE_CONTRACT_REVISION, resolve: request.resolveNested }
      : DEFAULT_VALUE_CONVERSION;
    if ((request.depth ?? 0) > 64) {
      return {
        status: 'unsupported',
        reason: 'Revision 2 limits value contracts to 64 nested nodes.',
        guidance: 'Flatten the value or provide a bounded adapter.',
      };
    }
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
          return {
            status: 'supported',
            value: { kind: 'string', wire: 'json', decodedAs: 'string' },
          };
        }
        if (type.name === 'bytes') {
          return {
            status: 'supported',
            value: { kind: 'bytes', wire: 'base64-envelope', decodedAs: 'Uint8Array' },
          };
        }
        return {
          status: 'unsupported',
          reason: 'The value contract does not specify this primitive conversion.',
          guidance: 'Use a supported primitive or an explicit value adapter.',
        };
      case 'annotated':
        return nestedConversion.resolve({ ...request, logicalType: type.base });
      case 'final':
      case 'classvar':
        return nestedConversion.resolve({ ...request, logicalType: type.type });
      case 'optional':
        return resolveUnion(
          [type.type, { kind: 'primitive', name: 'None' }],
          request,
          nestedConversion
        );
      case 'union':
        return resolveUnion(type.types, request, nestedConversion);
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
          return resolveRecord(type.itemTypes[1] ?? UNKNOWN_TYPE, request, nestedConversion);
        }
        if (type.name === 'tuple') {
          return resolveTuple(type.itemTypes, request, nestedConversion);
        }
        return resolveSequence(type.itemTypes[0] ?? UNKNOWN_TYPE, request, nestedConversion);
      case 'generic': {
        const leaf = leafName(type);
        if (leaf === 'NDArray' || leaf === 'ndarray') {
          return resolveNdarray(type);
        }
        if (leaf === 'Tensor' && type.module?.startsWith('torch')) {
          const tensorDtype = type.typeArgs[0];
          if (
            type.typeArgs.length !== 1 ||
            tensorDtype?.kind !== 'custom' ||
            tensorDtype.name !== 'float16' ||
            tensorDtype.module !== 'torch'
          ) {
            return { status: 'unresolved', annotation: annotationName(type) };
          }
          return resolveTorchFloat16();
        }
        if (['list', 'List', 'Sequence', 'Iterable', 'set', 'frozenset'].includes(leaf ?? '')) {
          return resolveSequence(type.typeArgs[0] ?? UNKNOWN_TYPE, request, nestedConversion);
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
          return resolveRecord(type.typeArgs[1] ?? UNKNOWN_TYPE, request, nestedConversion);
        }
        return { status: 'unresolved', annotation: annotationName(type) };
      }
      case 'custom': {
        const leaf = leafName(type);
        if (type.name === 'HalfTensor' && type.module === 'torch') {
          return resolveTorchFloat16();
        }
        if (leaf === 'ndarray' || leaf === 'NDArray') {
          return resolveNdarray(type);
        }
        return { status: 'unresolved', annotation: annotationName(type) };
      }
      default:
        return { status: 'unresolved', annotation: annotationName(type) };
    }
  },
};

function capabilityNamesFor(value: ValueContract): CallableCapability[] {
  const names = new Set<CallableCapability>(['value-rpc', 'return-validation']);
  const collect = (current: ValueContract): void => {
    switch (current.kind) {
      case 'sequence':
        collect(current.item);
        break;
      case 'tuple':
        current.items.forEach(collect);
        break;
      case 'union':
        current.options.forEach(collect);
        break;
      case 'record':
        current.fields.forEach(field => collect(field.value));
        if (current.additionalValues) {
          collect(current.additionalValues);
        }
        break;
      case 'ndarray-float16':
        names.add('scientific-ndarray');
        break;
      case 'torch-float16':
        names.add('scientific-torch');
        names.add('scientific-ndarray');
        break;
    }
  };
  collect(value);
  return [...names];
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
      message: `${path}: no value conversion is defined for ${resolution.annotation}; the generated result type is unknown.`,
    };
  }
  return {
    severity: 'error',
    code: 'conversion-unsupported',
    path,
    message: `${path}: ${resolution.reason} ${resolution.guidance}`,
  };
}

function outputType(value: ResolvedCallableValue): PythonType {
  return value.resolution.status === 'supported' ? value.logicalType : UNKNOWN_TYPE;
}

function valuesMayOverlap(left: ValueContract, right: ValueContract): boolean {
  if (left.kind === 'unsupported' || right.kind === 'unsupported') {
    return true;
  }
  if (left.kind === 'union') {
    return left.options.some(option => valuesMayOverlap(option, right));
  }
  if (right.kind === 'union') {
    return right.options.some(option => valuesMayOverlap(left, option));
  }
  if (
    (left.kind === 'integer' && right.kind === 'float') ||
    (left.kind === 'float' && right.kind === 'integer')
  ) {
    return true;
  }
  if (
    left.kind === 'ndarray-float16' ||
    right.kind === 'ndarray-float16' ||
    left.kind === 'torch-float16' ||
    right.kind === 'torch-float16'
  ) {
    return true;
  }
  if (left.kind === 'tuple' && right.kind === 'sequence') {
    return left.items.every(item => valuesMayOverlap(item, right.item));
  }
  if (left.kind === 'sequence' && right.kind === 'tuple') {
    return right.items.every(item => valuesMayOverlap(left.item, item));
  }
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'tuple' && right.kind === 'tuple') {
    return (
      left.items.length === right.items.length &&
      left.items.every((item, index) => valuesMayOverlap(item, right.items[index]!))
    );
  }
  if (left.kind === 'sequence' && right.kind === 'sequence') {
    return true; // An empty array matches both element schemas.
  }
  return true;
}

function positionalSlot(parameters: readonly Parameter[], index: number): number | null {
  const parameter = parameters[index]!;
  if (parameter.keywordOnly || parameter.kwArgs || parameter.varArgs) {
    return null;
  }
  let slot = 0;
  for (const earlier of parameters.slice(0, index)) {
    if (earlier.varArgs) {
      return null;
    }
    if (!earlier.keywordOnly && !earlier.kwArgs) {
      slot += 1;
    }
  }
  return slot;
}

function sharesRequiredBinding(
  left: readonly Parameter[],
  leftIndex: number,
  right: readonly Parameter[],
  rightIndex: number
): boolean {
  const a = left[leftIndex]!;
  const b = right[rightIndex]!;
  if (
    a.optional ||
    b.optional ||
    a.varArgs ||
    b.varArgs ||
    a.kwArgs ||
    b.kwArgs ||
    a.name !== b.name
  ) {
    return false;
  }
  if (a.keywordOnly && b.keywordOnly) {
    return true;
  }
  if (a.keywordOnly || b.keywordOnly) {
    return !a.positionalOnly && !b.positionalOnly;
  }
  const leftSlot = positionalSlot(left, leftIndex);
  return leftSlot !== null && leftSlot === positionalSlot(right, rightIndex);
}

function overloadsMayOverlap(
  left: readonly ResolvedCallableValue[],
  right: readonly ResolvedCallableValue[],
  leftParameters: readonly Parameter[],
  rightParameters: readonly Parameter[]
): boolean {
  const countRange = (parameters: readonly Parameter[]): [number, number] => [
    parameters.filter(parameter => !parameter.optional && !parameter.varArgs && !parameter.kwArgs)
      .length,
    parameters.some(parameter => parameter.varArgs || parameter.kwArgs)
      ? Number.POSITIVE_INFINITY
      : parameters.length,
  ];
  const [leftMin, leftMax] = countRange(leftParameters);
  const [rightMin, rightMax] = countRange(rightParameters);
  if (leftMax < rightMin || rightMax < leftMin) {
    return false;
  }
  for (let leftIndex = 0; leftIndex < leftParameters.length; leftIndex += 1) {
    if (
      leftParameters.filter(parameter => parameter.name === leftParameters[leftIndex]!.name)
        .length !== 1
    ) {
      continue;
    }
    const rightIndex = rightParameters.findIndex(
      parameter => parameter.name === leftParameters[leftIndex]!.name
    );
    if (
      rightIndex < 0 ||
      rightParameters.filter(parameter => parameter.name === leftParameters[leftIndex]!.name)
        .length !== 1 ||
      !sharesRequiredBinding(leftParameters, leftIndex, rightParameters, rightIndex)
    ) {
      continue;
    }
    const a = left[leftIndex]?.resolution;
    const b = right[rightIndex]?.resolution;
    if (
      a?.status === 'supported' &&
      b?.status === 'supported' &&
      !valuesMayOverlap(a.value, b.value)
    ) {
      return false;
    }
  }
  return true;
}

function resolveCallable(
  func: PythonFunction,
  path: string,
  conversion: ValueConversionDescription,
  capabilities: ReadonlyMap<CallableCapability, CapabilityDescription>,
  dataclassNames: ReadonlySet<string>,
  diagnostics: CallableCompilationDiagnostic[]
): { function: PythonFunction; callable: ResolvedCallable } {
  const resolveValue = (
    direction: CallableDirection,
    logicalType: PythonType,
    valuePath: string
  ): ResolvedCallableValue => ({
    direction,
    path: valuePath,
    logicalType,
    resolution: conversion.resolve({ direction, logicalType, path: valuePath }),
  });
  const parameters = func.parameters.map((parameter, index) =>
    resolveValue('input', parameter.type, `${path}.parameters[${index}]`)
  );
  const result = resolveValue('output', func.returnType, `${path}.returns`);
  const overloadParameters = (func.overloads ?? []).map((overload, overloadIndex) =>
    overload.parameters.map((parameter, parameterIndex) =>
      resolveValue(
        'input',
        parameter.type,
        `${path}.overloads[${overloadIndex}].parameters[${parameterIndex}]`
      )
    )
  );
  const overloadResults = (func.overloads ?? []).map((overload, index) =>
    resolveValue('output', overload.returnType, `${path}.overloads[${index}].returns`)
  );
  // Python binds these receivers before the wrapper sends RPC arguments.
  const visibleParameters = parameters.filter(
    (_, index) => func.parameters[index]?.name !== 'self' && func.parameters[index]?.name !== 'cls'
  );
  const visibleOverloadParameters = overloadParameters.map((values, overloadIndex) =>
    values.filter(
      (_, index) =>
        func.overloads?.[overloadIndex]?.parameters[index]?.name !== 'self' &&
        func.overloads?.[overloadIndex]?.parameters[index]?.name !== 'cls'
    )
  );
  const visibleOverloadSignatures = (func.overloads ?? []).map(overload =>
    overload.parameters.filter(parameter => parameter.name !== 'self' && parameter.name !== 'cls')
  );
  const values = [
    ...visibleParameters,
    result,
    ...visibleOverloadParameters.flat(),
    ...overloadResults,
  ];
  const requiredCapabilities = new Set<CallableCapability>();
  for (const value of values) {
    const diagnostic = diagnosticForResolution(value.resolution, value.path);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }
  for (let index = 0; index < overloadParameters.length; index += 1) {
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (
        overloadsMayOverlap(
          visibleOverloadParameters[earlier]!,
          visibleOverloadParameters[index]!,
          visibleOverloadSignatures[earlier]!,
          visibleOverloadSignatures[index]!
        )
      ) {
        diagnostics.push({
          severity: 'warning',
          code: 'overload-ambiguous',
          path: `${path}.overloads[${index}]`,
          message: `${path}.overloads[${index}]: input values may also match overload ${earlier}. Runtime return validation selects the first declared match.`,
        });
      }
    }
  }
  for (const value of values) {
    const directDataclass =
      (value.logicalType.kind === 'custom' || value.logicalType.kind === 'generic') &&
      dataclassNames.has(leafName(value.logicalType) ?? '');
    const adaptedDataclass =
      value.direction === 'output' &&
      directDataclass &&
      capabilities.get('dataclass-adapter')?.available === true &&
      value.resolution.status === 'supported' &&
      value.resolution.value.kind === 'record';
    if (adaptedDataclass) {
      requiredCapabilities.add('dataclass-adapter');
    } else if (containsNamedType(value.logicalType, dataclassNames)) {
      diagnostics.push({
        severity: 'error',
        code: 'dataclass-unsupported',
        path: value.path,
        message: `${value.path}: a dataclass annotation has no value adapter. Use a TypedDict or an explicit record adapter until #339.`,
      });
      value.resolution = {
        status: 'unsupported',
        reason: 'No dataclass value adapter is available.',
        guidance: 'Use a TypedDict or an explicit record adapter.',
      };
    }
    if (value.direction === 'output' && func.isAsync) {
      if (capabilities.get('coroutine-execution')?.available !== true) {
        diagnostics.push({
          severity: 'error',
          code: 'coroutine-unsupported',
          path: value.path,
          message: `${value.path}: this callable requires a runtime bridge that awaits Python coroutine results.`,
        });
        value.resolution = {
          status: 'unsupported',
          reason: 'Coroutine execution is unavailable.',
          guidance: 'Use a coroutine-capable runtime bridge or a synchronous adapter.',
        };
      } else {
        requiredCapabilities.add('coroutine-execution');
      }
    }
    if (value.resolution.status === 'supported') {
      const needed = capabilityNamesFor(value.resolution.value);
      needed.forEach(capability => requiredCapabilities.add(capability));
      const missing = needed.filter(capability => capabilities.get(capability)?.available !== true);
      if (missing.length > 0) {
        missing.forEach(capability => {
          const description = capabilities.get(capability);
          diagnostics.push({
            severity: 'error',
            code: 'capability-unavailable',
            path: value.path,
            message: `${value.path}: ${capability} is required. ${description?.guidance ?? 'Add a declared capability before generating this callable.'}`,
          });
        });
        value.resolution = {
          status: 'unsupported',
          reason: `Required capability is unavailable: ${missing.join(', ')}.`,
          guidance: 'Provide the capability or use a supported value adapter.',
        };
      }
    }
  }

  const resolvedParameters: Parameter[] = parameters.map((parameter, index) => ({
    ...func.parameters[index]!,
    type: parameter.resolution.status === 'unsupported' ? UNKNOWN_TYPE : parameter.logicalType,
  }));
  const resolvedOverloads = (func.overloads ?? []).map((overload, index) => ({
    ...overload,
    parameters: overload.parameters.map((parameter, parameterIndex) => ({
      ...parameter,
      type:
        overloadParameters[index]?.[parameterIndex]?.resolution.status === 'unsupported'
          ? UNKNOWN_TYPE
          : parameter.type,
    })),
    returnType: overloadResults[index] ? outputType(overloadResults[index]) : overload.returnType,
  }));
  const supportedValue = (value: ResolvedCallableValue): ValueContract | undefined =>
    value.resolution.status === 'supported' ? value.resolution.value : undefined;
  const resolvedFunction: PythonFunction = {
    ...func,
    parameters: resolvedParameters,
    signature: {
      ...func.signature,
      parameters: resolvedParameters,
      returnType: outputType(result),
    },
    returnType: outputType(result),
    overloads: resolvedOverloads,
    callableContract: {
      parameterValues: parameters.map(supportedValue),
      returnValue: supportedValue(result),
      returnValidationType: result.resolution.status === 'unresolved' ? func.returnType : undefined,
      overloads: overloadResults.map((overload, index) => ({
        parameterValues: overloadParameters[index]!.map(supportedValue),
        returnValue: supportedValue(overload),
        returnValidationType:
          overload.resolution.status === 'unresolved'
            ? func.overloads![index]!.returnType
            : undefined,
      })),
    },
  };
  return {
    function: resolvedFunction,
    callable: {
      name: func.name,
      path,
      parameters,
      result,
      overloadParameters,
      overloadResults,
      requiredCapabilities: [...requiredCapabilities].sort(),
    },
  };
}

/**
 * Compile already-validated IR without filesystem, subprocess, cache, or
 * registry access. `generate()` selects exports and writes these files.
 */
export function compileContract(
  ir: ValidatedIrContract,
  options: CompileContractOptions
): CompiledContract {
  if (ir.module !== options.module.name) {
    throw new Error(
      `Compiled module ${options.module.name} does not match IR module ${ir.module}.`
    );
  }
  const canonical = transformIrToTsModel(ir);
  const select = <T extends { name: string }>(
    kind: string,
    source: readonly T[],
    requested: readonly { name: string }[]
  ): T[] => {
    const byName = new Map(source.map(item => [item.name, item] as const));
    const seen = new Set<string>();
    return requested.map(item => {
      const match = byName.get(item.name);
      if (!match || seen.has(item.name)) {
        throw new Error(`Selected ${kind} ${item.name} does not match validated IR.`);
      }
      seen.add(item.name);
      return match;
    });
  };
  const selectedFunctions = select('function', canonical.functions, options.module.functions);
  const selectedClasses = select('class', canonical.classes, options.module.classes);
  const selectedAliases = select(
    'type alias',
    canonical.typeAliases ?? [],
    options.module.typeAliases ?? canonical.typeAliases ?? []
  );
  const localTypedDicts = new Map(
    selectedClasses
      .filter(cls => cls.kind === 'typed_dict' && !cls.typeParameters?.length)
      .map(cls => [cls.name, cls] as const)
  );
  const localAliases = new Map(
    selectedAliases
      .filter(alias => !alias.typeParameters?.length)
      .map(alias => [alias.name, alias] as const)
  );
  const conversion: ValueConversionDescription = {
    revision: options.conversion.revision,
    resolve(request): ValueResolution {
      const type = request.logicalType;
      const direct = options.conversion.resolve({ ...request, resolveNested: conversion.resolve });
      if (
        direct.status !== 'unresolved' ||
        type.kind !== 'custom' ||
        (type.module !== undefined && type.module !== ir.module)
      ) {
        return direct;
      }
      const typedDict = localTypedDicts.get(type.name);
      if (typedDict) {
        const key = `typed-dict:${type.name}`;
        if (request.activeNames?.includes(key)) {
          return { status: 'unresolved', annotation: annotationName(type) };
        }
        if ((request.depth ?? 0) >= 64) {
          return {
            status: 'unsupported',
            reason: 'Revision 2 limits value contracts to 64 nested nodes.',
            guidance: 'Flatten the value or provide a bounded adapter.',
          };
        }
        const fields: ValueContractField[] = [];
        for (const property of typedDict.properties) {
          const field = conversion.resolve({
            ...request,
            logicalType: property.type,
            path: `${request.path}.${property.name}`,
            depth: (request.depth ?? 0) + 1,
            activeNames: [...(request.activeNames ?? []), key],
          });
          if (field.status !== 'supported') {
            return field;
          }
          fields.push({ name: property.name, value: field.value, required: !property.optional });
        }
        return {
          status: 'supported',
          value: { kind: 'record', wire: 'json', decodedAs: 'object', fields },
        };
      }
      const alias = localAliases.get(type.name);
      if (alias) {
        const key = `alias:${type.name}`;
        if (request.activeNames?.includes(key)) {
          return { status: 'unresolved', annotation: annotationName(type) };
        }
        if ((request.depth ?? 0) >= 64) {
          return {
            status: 'unsupported',
            reason: 'Revision 2 limits value contracts to 64 nested nodes.',
            guidance: 'Flatten the value or provide a bounded adapter.',
          };
        }
        return conversion.resolve({
          ...request,
          logicalType: alias.type,
          depth: (request.depth ?? 0) + 1,
          activeNames: [...(request.activeNames ?? []), key],
        });
      }
      return direct;
    },
  };
  const capabilities = new Map(
    options.capabilities.map(capability => [capability.name, capability])
  );
  const dataclassNames = new Set(ir.classes.filter(cls => cls.is_dataclass).map(cls => cls.name));
  const diagnostics: CallableCompilationDiagnostic[] = [];
  const callables: ResolvedCallable[] = [];
  const compileFunction = (func: PythonFunction, path: string): PythonFunction => {
    const result = resolveCallable(
      func,
      path,
      conversion,
      capabilities,
      dataclassNames,
      diagnostics
    );
    callables.push(result.callable);
    return result.function;
  };
  const module: PythonModule = {
    ...canonical,
    functions: selectedFunctions.map(func =>
      compileFunction(
        func,
        `$.functions[${ir.functions.findIndex(entry => entry.name === func.name)}]`
      )
    ),
    classes: selectedClasses.map(cls => ({
      ...cls,
      methods:
        cls.kind === 'protocol'
          ? cls.methods
          : cls.methods.map(method => {
              const sourceClassIndex = ir.classes.findIndex(entry => entry.name === cls.name);
              const sourceMethodIndex = ir.classes[sourceClassIndex]!.methods.findIndex(
                entry => entry.name === method.name
              );
              return compileFunction(
                method,
                `$.classes[${sourceClassIndex}].methods[${sourceMethodIndex}]`
              );
            }),
    })),
    typeAliases: selectedAliases,
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
