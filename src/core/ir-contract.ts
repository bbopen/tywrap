/**
 * Validate the JSON contract emitted by tywrap_ir 0.4 before compilation.
 *
 * This module does not read files, start Python, or write generated output.
 * It only accepts unknown JSON-compatible input and returns located diagnostics.
 */

import type { IrContract } from '../types/index.js';

export const TYWRAP_IR_VERSION = '0.4.0' as const;

const PARAMETER_KINDS = new Set([
  'POSITIONAL_ONLY',
  'POSITIONAL_OR_KEYWORD',
  'VAR_POSITIONAL',
  'KEYWORD_ONLY',
  'VAR_KEYWORD',
]);
const FIELD_KINDS = new Set([...PARAMETER_KINDS, 'FIELD']);

const METHOD_KINDS = new Set(['instance', 'class', 'static']);
const TYPE_PARAMETER_KINDS = new Set(['typevar', 'paramspec', 'typevartuple']);
const VARIANCES = new Set(['covariant', 'contravariant', 'invariant']);

export interface IrParameter {
  name: string;
  kind: string;
  annotation: string | null;
  default: boolean;
}

export interface IrTypeParameter {
  name: string;
  kind: 'typevar' | 'paramspec' | 'typevartuple';
  bound: string | null;
  constraints: string[] | null;
  variance: 'covariant' | 'contravariant' | 'invariant' | null;
}

export interface IrOverload {
  parameters: IrParameter[];
  returns: string | null;
}

export interface IrFunction {
  name: string;
  qualname: string;
  docstring: string | null;
  parameters: IrParameter[];
  returns: string | null;
  is_async: boolean;
  is_generator: boolean;
  type_params: IrTypeParameter[];
  method_kind: 'instance' | 'class' | 'static';
  overloads: IrOverload[];
}

export interface IrAccessor {
  name: string;
  returns: string | null;
  docstring: string | null;
  read_only: boolean | null;
  is_cached: boolean;
}

export interface IrClass {
  name: string;
  qualname: string;
  docstring: string | null;
  bases: string[];
  methods: IrFunction[];
  typed_dict: boolean;
  total: boolean | null;
  fields: IrParameter[];
  is_protocol: boolean;
  is_namedtuple: boolean;
  is_dataclass: boolean;
  is_pydantic: boolean;
  type_params: IrTypeParameter[];
  accessors: IrAccessor[];
}

export interface IrConstant {
  name: string;
  annotation: string | null;
  value_repr: string | null;
  is_final: boolean;
}

export interface IrTypeAlias {
  name: string;
  definition: string;
  is_generic: boolean;
  type_params: IrTypeParameter[];
}

export interface ValidatedIrContract extends IrContract {
  ir_version: typeof TYWRAP_IR_VERSION;
  module: string;
  functions: IrFunction[];
  classes: IrClass[];
  constants: IrConstant[];
  type_aliases: IrTypeAlias[];
  metadata: Record<string, unknown>;
  warnings: string[];
}

export interface IrDiagnostic {
  code: 'ir-version-mismatch' | 'contract-invalid';
  path: string;
  message: string;
}

export interface ValidateIrContractOptions {
  /**
   * Generated offline contracts omit extractor metadata so their bytes stay
   * stable. The reader restores an empty metadata object for that format.
   */
  allowOmittedMetadata?: boolean;
}

export type IrValidationResult =
  | { ok: true; contract: ValidatedIrContract; diagnostics: readonly [] }
  | { ok: false; contract: null; diagnostics: readonly IrDiagnostic[] };

class ValidationState {
  readonly diagnostics: IrDiagnostic[] = [];
  private overflowed = false;

  private static readonly maxDiagnostics = 100;

  constructor(private readonly source: string) {}

  invalid(path: string, message: string): void {
    if (this.diagnostics.length >= ValidationState.maxDiagnostics) {
      this.overflowed = true;
      return;
    }
    this.diagnostics.push({ code: 'contract-invalid', path, message: `${this.source} ${message}` });
  }

  versionMismatch(path: string, found: string): void {
    if (this.diagnostics.length >= ValidationState.maxDiagnostics) {
      this.overflowed = true;
      return;
    }
    this.diagnostics.push({
      code: 'ir-version-mismatch',
      path,
      message: `IR version mismatch: TypeScript expects ${TYWRAP_IR_VERSION}, but ${this.source} declares ${found}. Regenerate the contract with a matching tywrap_ir.`,
    });
  }

  finish(): readonly IrDiagnostic[] {
    if (!this.overflowed) {
      return this.diagnostics;
    }
    return [
      ...this.diagnostics,
      {
        code: 'contract-invalid',
        path: '$',
        message: `${this.source} has more than ${ValidationState.maxDiagnostics} contract errors.`,
      },
    ];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function recordAt(value: unknown, path: string, state: ValidationState): Record<string, unknown> | null {
  if (!isRecord(value)) {
    state.invalid(path, `${path} must be an object.`);
    return null;
  }
  return value;
}

function requiredValue(
  object: Record<string, unknown>,
  name: string,
  path: string,
  state: ValidationState
): unknown {
  if (!(name in object)) {
    state.invalid(`${path}.${name}`, `${path} is missing required field ${name}.`);
    return undefined;
  }
  return object[name];
}

function requiredString(
  object: Record<string, unknown>,
  name: string,
  path: string,
  state: ValidationState,
  allowEmpty = false
): string | null {
  const value = requiredValue(object, name, path, state);
  if (typeof value !== 'string') {
    state.invalid(`${path}.${name}`, `${path}.${name} must be a string.`);
    return null;
  }
  if (!allowEmpty && value.length === 0) {
    state.invalid(`${path}.${name}`, `${path}.${name} must not be empty.`);
    return null;
  }
  return value;
}

function requiredNullableString(
  object: Record<string, unknown>,
  name: string,
  path: string,
  state: ValidationState
): string | null {
  const value = requiredValue(object, name, path, state);
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    state.invalid(`${path}.${name}`, `${path}.${name} must be a string or null.`);
    return null;
  }
  return value;
}

function requiredBoolean(
  object: Record<string, unknown>,
  name: string,
  path: string,
  state: ValidationState
): boolean | null {
  const value = requiredValue(object, name, path, state);
  if (typeof value !== 'boolean') {
    state.invalid(`${path}.${name}`, `${path}.${name} must be a boolean.`);
    return null;
  }
  return value;
}

function requiredArray(
  object: Record<string, unknown>,
  name: string,
  path: string,
  state: ValidationState
): unknown[] | null {
  const value = requiredValue(object, name, path, state);
  if (!Array.isArray(value)) {
    const noun = path === '$' ? `required array field ${name}` : `${path}.${name}`;
    state.invalid(`${path}.${name}`, `${path} is missing ${noun}.`);
    return null;
  }
  return value;
}

function validateStringArray(value: unknown, path: string, state: ValidationState): void {
  if (!Array.isArray(value)) {
    state.invalid(path, `${path} must be an array.`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      state.invalid(`${path}[${index}]`, `${path}[${index}] must be a string.`);
    }
  });
}

function validateParameter(
  value: unknown,
  path: string,
  state: ValidationState,
  allowedKinds: ReadonlySet<string> = PARAMETER_KINDS
): void {
  const parameter = recordAt(value, path, state);
  if (!parameter) {
    return;
  }
  requiredString(parameter, 'name', path, state);
  const kind = requiredString(parameter, 'kind', path, state);
  if (kind !== null && !allowedKinds.has(kind)) {
    state.invalid(`${path}.kind`, `${path}.kind must be a supported Python parameter kind.`);
  }
  requiredNullableString(parameter, 'annotation', path, state);
  requiredBoolean(parameter, 'default', path, state);
}

function validateTypeParameter(value: unknown, path: string, state: ValidationState): void {
  const parameter = recordAt(value, path, state);
  if (!parameter) {
    return;
  }
  requiredString(parameter, 'name', path, state);
  const kind = requiredString(parameter, 'kind', path, state);
  if (kind !== null && !TYPE_PARAMETER_KINDS.has(kind)) {
    state.invalid(`${path}.kind`, `${path}.kind must be typevar, paramspec, or typevartuple.`);
  }
  requiredNullableString(parameter, 'bound', path, state);
  const constraints = requiredValue(parameter, 'constraints', path, state);
  if (constraints !== null) {
    validateStringArray(constraints, `${path}.constraints`, state);
  }
  const variance = requiredValue(parameter, 'variance', path, state);
  if (variance !== null && (typeof variance !== 'string' || !VARIANCES.has(variance))) {
    state.invalid(`${path}.variance`, `${path}.variance must be a supported variance or null.`);
  }
}

function validateFunction(value: unknown, path: string, state: ValidationState): void {
  const callable = recordAt(value, path, state);
  if (!callable) {
    return;
  }
  requiredString(callable, 'name', path, state);
  requiredString(callable, 'qualname', path, state);
  requiredNullableString(callable, 'docstring', path, state);
  const parameters = requiredArray(callable, 'parameters', path, state);
  parameters?.forEach((parameter, index) => validateParameter(parameter, `${path}.parameters[${index}]`, state));
  requiredNullableString(callable, 'returns', path, state);
  requiredBoolean(callable, 'is_async', path, state);
  requiredBoolean(callable, 'is_generator', path, state);
  const typeParameters = requiredArray(callable, 'type_params', path, state);
  typeParameters?.forEach((parameter, index) =>
    validateTypeParameter(parameter, `${path}.type_params[${index}]`, state)
  );
  const methodKind = requiredString(callable, 'method_kind', path, state);
  if (methodKind !== null && !METHOD_KINDS.has(methodKind)) {
    state.invalid(`${path}.method_kind`, `${path}.method_kind must be instance, class, or static.`);
  }
  const overloads = requiredArray(callable, 'overloads', path, state);
  overloads?.forEach((overload, index) => {
    const overloadPath = `${path}.overloads[${index}]`;
    const signature = recordAt(overload, overloadPath, state);
    if (!signature) {
      return;
    }
    const overloadParameters = requiredArray(signature, 'parameters', overloadPath, state);
    overloadParameters?.forEach((parameter, parameterIndex) =>
      validateParameter(parameter, `${overloadPath}.parameters[${parameterIndex}]`, state)
    );
    requiredNullableString(signature, 'returns', overloadPath, state);
  });
}

function validateAccessor(value: unknown, path: string, state: ValidationState): void {
  const accessor = recordAt(value, path, state);
  if (!accessor) {
    return;
  }
  requiredString(accessor, 'name', path, state);
  requiredNullableString(accessor, 'returns', path, state);
  requiredNullableString(accessor, 'docstring', path, state);
  const readOnly = requiredValue(accessor, 'read_only', path, state);
  if (readOnly !== null && typeof readOnly !== 'boolean') {
    state.invalid(`${path}.read_only`, `${path}.read_only must be a boolean or null.`);
  }
  requiredBoolean(accessor, 'is_cached', path, state);
}

function validateClass(value: unknown, path: string, state: ValidationState): void {
  const cls = recordAt(value, path, state);
  if (!cls) {
    return;
  }
  requiredString(cls, 'name', path, state);
  requiredString(cls, 'qualname', path, state);
  requiredNullableString(cls, 'docstring', path, state);
  validateStringArray(requiredValue(cls, 'bases', path, state), `${path}.bases`, state);
  const methods = requiredArray(cls, 'methods', path, state);
  methods?.forEach((method, index) => validateFunction(method, `${path}.methods[${index}]`, state));
  requiredBoolean(cls, 'typed_dict', path, state);
  const total = requiredValue(cls, 'total', path, state);
  if (total !== null && typeof total !== 'boolean') {
    state.invalid(`${path}.total`, `${path}.total must be a boolean or null.`);
  }
  const fields = requiredArray(cls, 'fields', path, state);
  fields?.forEach((field, index) =>
    validateParameter(field, `${path}.fields[${index}]`, state, FIELD_KINDS)
  );
  requiredBoolean(cls, 'is_protocol', path, state);
  requiredBoolean(cls, 'is_namedtuple', path, state);
  requiredBoolean(cls, 'is_dataclass', path, state);
  requiredBoolean(cls, 'is_pydantic', path, state);
  const typeParameters = requiredArray(cls, 'type_params', path, state);
  typeParameters?.forEach((parameter, index) =>
    validateTypeParameter(parameter, `${path}.type_params[${index}]`, state)
  );
  const accessors = requiredArray(cls, 'accessors', path, state);
  accessors?.forEach((accessor, index) => validateAccessor(accessor, `${path}.accessors[${index}]`, state));
}

function validateConstant(value: unknown, path: string, state: ValidationState): void {
  const constant = recordAt(value, path, state);
  if (!constant) {
    return;
  }
  requiredString(constant, 'name', path, state);
  requiredNullableString(constant, 'annotation', path, state);
  requiredNullableString(constant, 'value_repr', path, state);
  requiredBoolean(constant, 'is_final', path, state);
}

function validateTypeAlias(value: unknown, path: string, state: ValidationState): void {
  const alias = recordAt(value, path, state);
  if (!alias) {
    return;
  }
  requiredString(alias, 'name', path, state);
  requiredString(alias, 'definition', path, state, true);
  requiredBoolean(alias, 'is_generic', path, state);
  const typeParameters = requiredArray(alias, 'type_params', path, state);
  typeParameters?.forEach((parameter, index) =>
    validateTypeParameter(parameter, `${path}.type_params[${index}]`, state)
  );
}

/**
 * Validate every field emitted by `tywrap_ir` 0.4.
 *
 * The return value is safe to compile without further structural checks. The
 * caller owns all filesystem, cache, interpreter, and output operations.
 */
export function validateIrContract(
  input: unknown,
  source = 'IR',
  options: ValidateIrContractOptions = {}
): IrValidationResult {
  const state = new ValidationState(source);
  const contract = recordAt(input, '$', state);
  if (!contract) {
    return { ok: false, contract: null, diagnostics: state.finish() };
  }

  const version = requiredString(contract, 'ir_version', '$', state);
  if (version !== null && version !== TYWRAP_IR_VERSION) {
    state.versionMismatch('$.ir_version', version);
  }
  requiredString(contract, 'module', '$', state);
  const functions = requiredArray(contract, 'functions', '$', state);
  functions?.forEach((functionValue, index) => validateFunction(functionValue, `$.functions[${index}]`, state));
  const classes = requiredArray(contract, 'classes', '$', state);
  classes?.forEach((classValue, index) => validateClass(classValue, `$.classes[${index}]`, state));
  const constants = requiredArray(contract, 'constants', '$', state);
  constants?.forEach((constant, index) => validateConstant(constant, `$.constants[${index}]`, state));
  const aliases = requiredArray(contract, 'type_aliases', '$', state);
  aliases?.forEach((alias, index) => validateTypeAlias(alias, `$.type_aliases[${index}]`, state));
  const metadata = contract.metadata;
  if (metadata === undefined && !options.allowOmittedMetadata) {
    state.invalid('$.metadata', '$ is missing required field metadata.');
  } else if (metadata !== undefined && !isRecord(metadata)) {
    state.invalid('$.metadata', '$.metadata must be an object.');
  }
  validateStringArray(requiredValue(contract, 'warnings', '$', state), '$.warnings', state);

  if (state.diagnostics.length > 0) {
    return { ok: false, contract: null, diagnostics: state.finish() };
  }
  return {
    ok: true,
    contract: {
      ...contract,
      metadata: isRecord(metadata) ? metadata : {},
    } as ValidatedIrContract,
    diagnostics: [],
  };
}
