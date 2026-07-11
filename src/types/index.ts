/**
 * Core type definitions for tywrap
 */

export interface PythonModule {
  name: string;
  path?: string;
  version?: string;
  functions: PythonFunction[];
  classes: PythonClass[];
  typeAliases?: PythonTypeAlias[];
  imports: PythonImport[];
  exports: string[];
}

/**
 * How a callable is bound on its owning class.
 *
 * Mirrors `IRFunction.method_kind` from the Python IR (tywrap_ir 0.3.0):
 * `'instance'` (default, keeps `self`), `'class'` (keeps `cls`), or
 * `'static'` (no implicit first parameter). Module-level functions retain the
 * `'instance'` default; it is only meaningful for class members.
 */
export type PythonMethodKind = 'instance' | 'class' | 'static';

export interface PythonFunction {
  name: string;
  signature: FunctionSignature;
  docstring?: string;
  decorators: string[];
  isAsync: boolean;
  isGenerator: boolean;
  typeParameters?: PythonGenericParameter[];
  returnType: PythonType;
  parameters: Parameter[];
  /**
   * Binding of this callable on its owning class. Defaults to `'instance'`.
   * @see PythonMethodKind
   */
  methodKind?: PythonMethodKind;
}

/**
 * A `@property` or `functools.cached_property` exposed on a class.
 *
 * Mirrors `IRAccessor` from the Python IR (tywrap_ir 0.3.0). Distinct from
 * {@link PythonClass.properties} (which model TypedDict/NamedTuple/dataclass
 * data shapes): accessors are computed attributes backed by a getter.
 */
export interface PythonAccessor {
  name: string;
  type: PythonType;
  docstring?: string;
  /** True when there is no setter. `undefined` when undeterminable. */
  readOnly?: boolean;
  /** True for `functools.cached_property`. */
  isCached: boolean;
}

export interface PythonClass {
  name: string;
  bases: string[];
  methods: PythonFunction[];
  properties: Property[];
  /**
   * `@property` / `functools.cached_property` accessors, emitted as TS getters.
   * @see PythonAccessor
   */
  accessors?: PythonAccessor[];
  docstring?: string;
  decorators: string[];
  kind?: 'class' | 'protocol' | 'typed_dict' | 'namedtuple' | 'dataclass' | 'pydantic';
  typeParameters?: PythonGenericParameter[];
}

export interface PythonTypeAlias {
  name: string;
  type: PythonType;
  typeParameters?: PythonGenericParameter[];
}

export type PythonGenericParameterKind = 'typevar' | 'paramspec' | 'typevartuple';

export interface PythonGenericParameter {
  name: string;
  kind: PythonGenericParameterKind;
  bound?: PythonType;
  constraints?: PythonType[];
  variance?: 'covariant' | 'contravariant' | 'invariant';
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
  positionalOnly?: boolean;
  keywordOnly?: boolean;
}

export interface Property {
  name: string;
  type: PythonType;
  readonly: boolean;
  optional?: boolean;
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
  | ParamSpecType
  | ParamSpecArgsType
  | ParamSpecKwargsType
  | TypeVarTupleType
  | UnpackType
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
  module?: string;
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
  parameterSpec?: ParamSpecType;
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

export interface ParamSpecType {
  kind: 'paramspec';
  name: string;
}

export interface ParamSpecArgsType {
  kind: 'paramspec_args';
  name: string;
}

export interface ParamSpecKwargsType {
  kind: 'paramspec_kwargs';
  name: string;
}

export interface TypeVarTupleType {
  kind: 'typevartuple';
  name: string;
}

export interface UnpackType {
  kind: 'unpack';
  type: PythonType;
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
  /**
   * Additional Python import paths to prepend to PYTHONPATH during code generation
   * and discovery (IR extraction). Useful for local modules not installed in site-packages.
   */
  pythonImportPath?: string[];
  output: OutputConfig;
  runtime: RuntimeConfig;
  performance: PerformanceConfig;
  types?: TypeMappingConfig;
  debug?: boolean;
}

export interface PythonModuleConfig {
  version?: string;
  /**
   * @deprecated Dead input. The per-module runtime is never read during code
   * generation — the active runtime is resolved from the top-level
   * {@link RuntimeConfig} (`runtime.node`, etc.). Kept optional so existing
   * configs that still set it continue to validate; it has no effect and will
   * be removed in a future major release.
   */
  runtime?: RuntimeStrategy;
  functions?: string[];
  classes?: string[];
  /** Exclude specific exports by exact name. */
  exclude?: string[];
  /** Exclude exports matching one or more regex patterns (JavaScript RegExp source). */
  excludePatterns?: string[];
  alias?: string;
  typeHints: 'strict' | 'loose' | 'ignore';
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
  /** Per-call timeout in milliseconds for the subprocess bridge. */
  timeout?: number;
}

export interface HttpConfig {
  baseURL: string;
  /** Per-request timeout in milliseconds for the HTTP bridge. */
  timeout?: number;
  headers?: Record<string, string>;
}

export interface PerformanceConfig {
  caching: boolean;
  batching: boolean;
  compression: 'auto' | 'gzip' | 'brotli' | 'none';
}

export type TypePreset = 'numpy' | 'pandas' | 'pydantic' | 'stdlib' | 'scipy' | 'torch' | 'sklearn';

export interface TypeMappingConfig {
  presets?: TypePreset[];
}

/** Known bridge backends. Each speaks the identical "tywrap/1" protocol. */
export type BridgeBackend = 'python-subprocess' | 'pyodide' | 'http';

/**
 * Optional chunked-transport negotiation block in {@link BridgeInfo}.
 *
 * Reported by a bridge that understands the `tywrap-frame/1` framing protocol
 * (subprocess only, 0.8.0). It lets the JS side learn, via the `meta` probe,
 * whether the bridge can reassemble chunked frames and the maximum single-frame
 * size it will accept. Absent on old bridges (and on HTTP/Pyodide, which stay
 * single-frame in 0.8.0) — absence means "no chunking", which is backward
 * compatible. See docs/transport-framing.md.
 */
export interface BridgeTransportInfo {
  /** Framing protocol the bridge speaks (e.g. `'tywrap-frame/1'`). */
  frameProtocol: string;
  /** Whether the bridge can fragment/reassemble chunked frames. */
  supportsChunking: boolean;
  /** Maximum size, in bytes, of a single wire frame the bridge will accept. */
  maxFrameBytes: number;
}

export interface BridgeInfo {
  protocol: string;
  protocolVersion: number;
  bridge: BridgeBackend;
  pythonVersion: string;
  /** OS process id for subprocess backends; null for in-WASM (Pyodide). */
  pid: number | null;
  codecFallback: 'json' | 'none';
  arrowAvailable: boolean;
  scipyAvailable: boolean;
  torchAvailable: boolean;
  sklearnAvailable: boolean;
  instances: number;
  /**
   * Optional chunked-transport negotiation block. Present only when the bridge
   * advertises `tywrap-frame/1` framing; absent on old bridges and on
   * HTTP/Pyodide (single-frame in 0.8.0). See {@link BridgeTransportInfo}.
   */
  transport?: BridgeTransportInfo;
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

// PythonRuntime — the call-only cross-boundary RPC method generated wrappers call.
// This is the contract that, after the composition rework, is implemented ONLY
// by the bridge facades (NodeBridge/HttpBridge/PyodideBridge); the facades
// satisfy it by delegating to an owned RpcClient. It deliberately carries NO
// lifecycle method — dispose() is a separate lifecycle concern (see Disposable
// in runtime/disposable.ts), so transports and the lifecycle base class
// (DisposableBase) never have to stub these methods.
export interface PythonRuntime {
  call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;
}

// Runtime bridge interface — the call RPC method plus lifecycle dispose().
// Kept as PythonRuntime + dispose() so getRuntimeBridge() and every existing
// `RuntimeExecution` reference (registry, dev.ts) compile with zero churn. The
// RuntimeExecution -> PythonRuntime symbol rename is deferred to the T9 pass.
export interface RuntimeExecution extends PythonRuntime {
  dispose(): Promise<void>;
}
