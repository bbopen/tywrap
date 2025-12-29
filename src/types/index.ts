/**
 * Core type definitions for tywrap
 */

export interface PythonModule {
  name: string;
  path?: string;
  version?: string;
  functions: PythonFunction[];
  classes: PythonClass[];
  imports: PythonImport[];
  exports: string[];
}

export interface PythonFunction {
  name: string;
  signature: FunctionSignature;
  docstring?: string;
  decorators: string[];
  isAsync: boolean;
  isGenerator: boolean;
  returnType: PythonType;
  parameters: Parameter[];
}

export interface PythonClass {
  name: string;
  bases: string[];
  methods: PythonFunction[];
  properties: Property[];
  docstring?: string;
  decorators: string[];
  kind?: 'class' | 'protocol' | 'typed_dict' | 'namedtuple' | 'dataclass' | 'pydantic';
}

export interface PythonImport {
  module: string;
  name?: string;
  alias?: string;
  fromImport: boolean;
}

export interface Parameter {
  name: string;
  type: PythonType;
  optional: boolean;
  defaultValue?: unknown;
  varArgs: boolean;
  kwArgs: boolean;
}

export interface Property {
  name: string;
  type: PythonType;
  readonly: boolean;
  setter?: boolean;
  getter?: boolean;
}

export interface FunctionSignature {
  parameters: Parameter[];
  returnType: PythonType;
  isAsync: boolean;
  isGenerator: boolean;
}

// Python type system
export type PythonType =
  | PrimitiveType
  | CollectionType
  | UnionType
  | OptionalType
  | GenericType
  | CallableType
  | LiteralType
  | AnnotatedType
  | CustomType
  | TypeVarType
  | FinalType
  | ClassVarType;

export interface PrimitiveType {
  kind: 'primitive';
  name: 'int' | 'float' | 'str' | 'bool' | 'bytes' | 'None';
}

export interface CollectionType {
  kind: 'collection';
  name: 'list' | 'dict' | 'tuple' | 'set' | 'frozenset';
  itemTypes: PythonType[];
}

export interface UnionType {
  kind: 'union';
  types: PythonType[];
}

export interface OptionalType {
  kind: 'optional';
  type: PythonType;
}

export interface GenericType {
  kind: 'generic';
  name: string;
  typeArgs: PythonType[];
}

export interface CustomType {
  kind: 'custom';
  name: string;
  module?: string;
}

export interface CallableType {
  kind: 'callable';
  parameters: PythonType[];
  returnType: PythonType;
}

export interface LiteralType {
  kind: 'literal';
  value: string | number | boolean | null;
}

export interface AnnotatedType {
  kind: 'annotated';
  base: PythonType;
  metadata: readonly unknown[];
}

export interface TypeVarType {
  kind: 'typevar';
  name: string;
  bound?: PythonType;
  constraints?: PythonType[];
  variance?: 'covariant' | 'contravariant' | 'invariant';
}

export interface FinalType {
  kind: 'final';
  type: PythonType;
}

export interface ClassVarType {
  kind: 'classvar';
  type: PythonType;
}

// TypeScript type system
export type TypescriptType =
  | TSPrimitiveType
  | TSArrayType
  | TSTupleType
  | TSObjectType
  | TSUnionType
  | TSFunctionType
  | TSGenericType
  | TSLiteralType
  | TSCustomType;

export interface TSPrimitiveType {
  kind: 'primitive';
  name:
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'undefined'
    | 'void'
    | 'unknown'
    | 'never'
    | 'object';
}

export interface TSArrayType {
  kind: 'array';
  elementType: TypescriptType;
}

export interface TSTupleType {
  kind: 'tuple';
  elementTypes: TypescriptType[];
}

export interface TSObjectType {
  kind: 'object';
  properties: TSProperty[];
  indexSignature?: TSIndexSignature;
}

export interface TSProperty {
  name: string;
  type: TypescriptType;
  optional: boolean;
  readonly: boolean;
}

export interface TSIndexSignature {
  keyType: TypescriptType;
  valueType: TypescriptType;
}

export interface TSUnionType {
  kind: 'union';
  types: TypescriptType[];
}

export interface TSFunctionType {
  kind: 'function';
  parameters: TSParameter[];
  returnType: TypescriptType;
  isAsync: boolean;
}

export interface TSParameter {
  name: string;
  type: TypescriptType;
  optional: boolean;
  rest: boolean;
}

export interface TSGenericType {
  kind: 'generic';
  name: string;
  typeArgs: TypescriptType[];
}

export interface TSCustomType {
  kind: 'custom';
  name: string;
  module?: string;
}

export interface TSLiteralType {
  kind: 'literal';
  value: string | number | boolean | null;
}

// Runtime and configuration types
export type RuntimeStrategy = 'pyodide' | 'node' | 'http' | 'auto';

export interface TywrapOptions {
  pythonModules: Record<string, PythonModuleConfig>;
  output: OutputConfig;
  runtime: RuntimeConfig;
  performance: PerformanceConfig;
  development: DevelopmentConfig;
  types?: TypeMappingConfig;
  debug?: boolean;
}

export interface PythonModuleConfig {
  version?: string;
  runtime: RuntimeStrategy;
  functions?: string[];
  classes?: string[];
  alias?: string;
  typeHints: 'strict' | 'loose' | 'ignore';
  watch?: boolean;
}

export interface OutputConfig {
  dir: string;
  format: 'esm' | 'cjs' | 'both';
  declaration: boolean;
  sourceMap: boolean;
  annotatedJSDoc?: boolean;
}

export interface RuntimeConfig {
  pyodide?: PyodideConfig;
  node?: NodeConfig;
  http?: HttpConfig;
}

export interface PyodideConfig {
  indexURL?: string;
  packages?: string[];
}

export interface NodeConfig {
  pythonPath?: string;
  virtualEnv?: string;
  timeout?: number;
}

export interface HttpConfig {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface PerformanceConfig {
  caching: boolean;
  batching: boolean;
  compression: 'auto' | 'gzip' | 'brotli' | 'none';
}

export interface DevelopmentConfig {
  hotReload: boolean;
  sourceMap: boolean;
  validation: 'runtime' | 'compile' | 'both' | 'none';
}

export type TypePreset = 'numpy' | 'pandas' | 'pydantic' | 'stdlib' | 'scipy' | 'torch' | 'sklearn';

export interface TypeMappingConfig {
  presets?: TypePreset[];
}

export interface BridgeInfo {
  protocol: string;
  protocolVersion: number;
  bridge: 'python-subprocess';
  pythonVersion: string;
  pid: number;
  codecFallback: 'json' | 'none';
  arrowAvailable: boolean;
  instances: number;
}

// Analysis and generation results
export interface AnalysisResult {
  module: PythonModule;
  errors: AnalysisError[];
  warnings: AnalysisWarning[];
  dependencies: string[];
  statistics: AnalysisStatistics;
}

export interface AnalysisError {
  type: 'syntax' | 'import' | 'type' | 'unsupported';
  message: string;
  line?: number;
  column?: number;
  file?: string;
}

export interface AnalysisWarning {
  type: 'missing-type' | 'deprecated' | 'performance' | 'compatibility';
  message: string;
  line?: number;
  column?: number;
  file?: string;
}

export interface AnalysisStatistics {
  functionsAnalyzed: number;
  classesAnalyzed: number;
  typeHintsCoverage: number;
  estimatedComplexity: number;
}

export interface GeneratedCode {
  typescript: string;
  declaration: string;
  sourceMap?: string;
  metadata: GenerationMetadata;
}

export interface GenerationMetadata {
  generatedAt: Date;
  sourceFiles: string[];
  runtime: RuntimeStrategy;
  optimizations: string[];
}

// Runtime bridge interface
export interface RuntimeExecution {
  call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;

  instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;

  callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;

  disposeInstance(handle: string): Promise<void>;

  dispose(): Promise<void>;
}

// Utility types
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

export type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];
