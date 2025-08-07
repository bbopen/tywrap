# API Reference

Complete API reference for tywrap's programmatic interface.

## Core API

### Main Functions

#### `tywrap(options?: Partial<TywrapOptions>): Promise<TywrapInstance>`
Creates a new tywrap instance with the specified configuration.

```typescript
import { tywrap } from 'tywrap';

const instance = await tywrap({
  pythonModules: {
    numpy: { runtime: 'node', typeHints: 'strict' }
  }
});
```

**Parameters**:
- `options` - Partial configuration object

**Returns**: Promise that resolves to a TywrapInstance

---

#### `generate(options: Partial<TywrapOptions>): Promise<{ written: string[]; warnings: string[] }>`
Generates TypeScript wrappers for configured Python modules.

```typescript
import { generate } from 'tywrap';

const result = await generate({
  pythonModules: {
    math: { runtime: 'node', typeHints: 'strict' }
  },
  output: {
    dir: './generated',
    format: 'esm'
  }
});

console.log(`Generated files: ${result.written.join(', ')}`);
console.log(`Warnings: ${result.warnings.join(', ')}`);
```

**Parameters**:
- `options` - Configuration object

**Returns**: Promise with generation results
- `written` - Array of generated file paths
- `warnings` - Array of warning messages

---

#### `defineConfig(config: TywrapOptions): TywrapOptions`
Type-safe configuration helper for TypeScript config files.

```typescript
// tywrap.config.ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    numpy: { runtime: 'pyodide', typeHints: 'strict' }
  },
  output: { dir: './src/generated', format: 'esm' }
});
```

**Parameters**:
- `config` - Complete configuration object

**Returns**: Validated configuration object

---

### Runtime Bridges

#### `RuntimeBridge`
Abstract base class for all runtime implementations.

```typescript
import { RuntimeBridge } from 'tywrap';

abstract class RuntimeBridge {
  abstract call<T>(
    module: string,
    functionName: string, 
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;
  
  abstract instantiate<T>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;
  
  abstract dispose(): Promise<void>;
}
```

#### `NodeBridge`
Node.js subprocess runtime bridge.

```typescript
import { NodeBridge } from 'tywrap/node';

const bridge = new NodeBridge({
  pythonPath: '/usr/local/bin/python3',
  virtualEnv: './venv',
  timeoutMs: 30000
});

// Call Python function
const result = await bridge.call('math', 'sqrt', [16]);

// Instantiate Python class
const instance = await bridge.instantiate('MyClass', 'MyClass', [arg1, arg2]);

// Clean up
await bridge.dispose();
```

**Constructor Options**:
```typescript
interface NodeBridgeOptions {
  pythonPath?: string;
  scriptPath?: string;
  cwd?: string;
  timeoutMs?: number;
  enableJsonFallback?: boolean;
  env?: Record<string, string | undefined>;
}
```

#### `PyodideBridge`
Browser WebAssembly runtime bridge.

```typescript
import { PyodideBridge } from 'tywrap/pyodide';

const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/',
  packages: ['numpy', 'scipy']
});

await bridge.init();
const result = await bridge.call('numpy', 'array', [[1, 2, 3]]);
```

**Constructor Options**:
```typescript
interface PyodideBridgeOptions {
  indexURL?: string;
  packages?: string[];
  micropip?: string[];
}
```

#### `HttpBridge`
HTTP API runtime bridge.

```typescript
import { HttpBridge } from 'tywrap/http';

const bridge = new HttpBridge({
  baseURL: 'https://api.example.com/python',
  timeout: 10000,
  headers: { Authorization: 'Bearer token' }
});

const result = await bridge.call('mymodule', 'myfunction', [args]);
```

**Constructor Options**:
```typescript
interface HttpBridgeOptions {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
}
```

---

### Code Generation

#### `CodeGenerator`
Generates TypeScript wrapper code from Python modules.

```typescript
import { CodeGenerator } from 'tywrap';

const generator = new CodeGenerator();

// Generate function wrapper
const funcCode = generator.generateFunctionWrapper(pythonFunction);

// Generate class wrapper  
const classCode = generator.generateClassWrapper(pythonClass);

// Generate complete module
const moduleCode = generator.generateModuleDefinition(pythonModule);
```

**Methods**:
- `generateFunctionWrapper(func, moduleName?, annotatedJSDoc?): GeneratedCode`
- `generateClassWrapper(cls, moduleName?, annotatedJSDoc?): GeneratedCode`
- `generateModuleDefinition(module, annotatedJSDoc?): GeneratedCode`

#### `TypeMapper`
Maps Python types to TypeScript types.

```typescript
import { TypeMapper } from 'tywrap';

const mapper = new TypeMapper();

// Map Python type to TypeScript
const tsType = mapper.mapPythonType(pythonType, 'value');
```

**Methods**:
- `mapPythonType(pythonType, context): TypescriptType`
- `mapPrimitiveType(type, context): TSPrimitiveType`
- `mapCollectionType(type): TSArrayType | TSTupleType | TSObjectType`
- `mapUnionType(type, context): TSUnionType`

---

### Utilities

#### Runtime Detection
```typescript
import { 
  detectRuntime, 
  isNodejs, 
  isDeno, 
  isBun, 
  isBrowser 
} from 'tywrap';

const runtime = detectRuntime(); // 'node' | 'deno' | 'bun' | 'browser'

if (isNodejs()) {
  // Node.js specific code
} else if (isBrowser()) {
  // Browser specific code
}
```

#### Data Codec
```typescript
import { 
  decodeValue, 
  decodeValueAsync, 
  registerArrowDecoder 
} from 'tywrap';

// Register Arrow decoder
registerArrowDecoder((bytes) => {
  return ArrowTable.from(bytes);
});

// Decode Python values
const decoded = await decodeValueAsync(pythonValue);
```

---

## Type Definitions

### Core Types

```typescript
interface TywrapOptions {
  pythonModules: Record<string, PythonModuleConfig>;
  output: OutputConfig;
  runtime: RuntimeConfig;
  performance: PerformanceConfig;
  development: DevelopmentConfig;
}

interface PythonModuleConfig {
  version?: string;
  runtime: 'pyodide' | 'node' | 'http' | 'auto';
  functions?: string[];
  classes?: string[];
  alias?: string;
  typeHints: 'strict' | 'loose' | 'ignore';
  watch?: boolean;
}

interface OutputConfig {
  dir: string;
  format: 'esm' | 'cjs' | 'both';
  declaration: boolean;
  sourceMap: boolean;
  minify?: boolean;
  annotatedJSDoc?: boolean;
}

interface RuntimeConfig {
  pyodide?: PyodideConfig;
  node?: NodeConfig;
  http?: HttpConfig;
}

interface PerformanceConfig {
  caching: boolean;
  batching: boolean;
  compression: 'auto' | 'gzip' | 'brotli' | 'none';
  memoryLimit?: number;
}

interface DevelopmentConfig {
  hotReload: boolean;
  sourceMap: boolean;
  validation: 'runtime' | 'compile' | 'both' | 'none';
  verbose?: boolean;
}
```

### Python Type System

```typescript
type PythonType =
  | PrimitiveType
  | CollectionType
  | UnionType
  | OptionalType
  | GenericType
  | CallableType
  | LiteralType
  | AnnotatedType
  | CustomType;

interface PrimitiveType {
  kind: 'primitive';
  name: 'int' | 'float' | 'str' | 'bool' | 'bytes' | 'None';
}

interface CollectionType {
  kind: 'collection';
  name: 'list' | 'dict' | 'tuple' | 'set' | 'frozenset';
  itemTypes: PythonType[];
}

interface UnionType {
  kind: 'union';
  types: PythonType[];
}

interface CallableType {
  kind: 'callable';
  parameters: PythonType[];
  returnType: PythonType;
}
```

### TypeScript Type System

```typescript
type TypescriptType =
  | TSPrimitiveType
  | TSArrayType
  | TSTupleType
  | TSObjectType
  | TSUnionType
  | TSFunctionType
  | TSGenericType
  | TSLiteralType
  | TSCustomType;

interface TSPrimitiveType {
  kind: 'primitive';
  name: 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'void' | 'unknown';
}

interface TSArrayType {
  kind: 'array';
  elementType: TypescriptType;
}

interface TSFunctionType {
  kind: 'function';
  parameters: TSParameter[];
  returnType: TypescriptType;
  isAsync: boolean;
}
```

### Analysis Results

```typescript
interface AnalysisResult {
  module: PythonModule;
  errors: AnalysisError[];
  warnings: AnalysisWarning[];
  dependencies: string[];
  statistics: AnalysisStatistics;
}

interface GeneratedCode {
  typescript: string;
  declaration: string;
  sourceMap?: string;
  metadata: GenerationMetadata;
}
```

---

## Error Types

### Core Errors

```typescript
class TywrapError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'TywrapError';
  }
}

class ConfigurationError extends TywrapError {
  constructor(message: string, public field?: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
  }
}

class GenerationError extends TywrapError {
  constructor(message: string, public module?: string) {
    super(message, 'GENERATION_ERROR');
    this.name = 'GenerationError';
  }
}

class RuntimeError extends TywrapError {
  constructor(
    message: string,
    public pythonType?: string,
    public traceback?: string
  ) {
    super(message, 'RUNTIME_ERROR');
    this.name = 'RuntimeError';
  }
}
```

### Error Handling

```typescript
try {
  const result = await generate(config);
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(`Configuration error in ${error.field}: ${error.message}`);
  } else if (error instanceof GenerationError) {
    console.error(`Generation failed for ${error.module}: ${error.message}`);
  } else if (error instanceof RuntimeError) {
    console.error(`Python error (${error.pythonType}): ${error.message}`);
    if (error.traceback) {
      console.error('Traceback:', error.traceback);
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

---

## CLI API

### Command Interface

```bash
# Generate wrappers
tywrap generate [options]

# Validate configuration  
tywrap validate [options]

# Show version
tywrap --version

# Show help
tywrap --help
```

### Programmatic CLI

```typescript
import { CLI } from 'tywrap/cli';

const cli = new CLI();

// Run CLI command programmatically
await cli.run(['generate', '--config', './tywrap.config.json']);

// Parse arguments
const options = cli.parseArgs(['--output-dir', './generated', '--format', 'esm']);
```

---

## Advanced API

### Custom Runtime Bridge

```typescript
import { RuntimeBridge } from 'tywrap';

class CustomBridge extends RuntimeBridge {
  async call<T>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    // Your custom implementation
    return customPythonCall(module, functionName, args, kwargs);
  }
  
  async instantiate<T>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    // Your custom implementation
    return customPythonInstantiate(module, className, args, kwargs);
  }
  
  async dispose(): Promise<void> {
    // Cleanup logic
  }
}

// Register custom bridge
tywrap.registerBridge('custom', CustomBridge);
```

### Custom Type Mapping

```typescript
import { TypeMapper } from 'tywrap';

class CustomTypeMapper extends TypeMapper {
  mapCustomType(type: CustomType, context: MappingContext): TypescriptType {
    // Handle special types
    if (type.name === 'MySpecialType') {
      return { kind: 'custom', name: 'MyTSType' };
    }
    return super.mapCustomType(type, context);
  }
}

// Use custom mapper
const generator = new CodeGenerator();
generator.setMapper(new CustomTypeMapper());
```

### Plugin System

```typescript
interface TywrapPlugin {
  name: string;
  version: string;
  
  // Lifecycle hooks
  beforeGeneration?(options: TywrapOptions): Promise<void>;
  afterGeneration?(result: GenerationResult): Promise<void>;
  
  // Custom transformations
  transformPythonType?(type: PythonType): PythonType;
  transformTypescriptCode?(code: string): string;
}

class MyPlugin implements TywrapPlugin {
  name = 'my-plugin';
  version = '1.0.0';
  
  async beforeGeneration(options: TywrapOptions) {
    console.log('Starting generation with custom plugin');
  }
  
  transformTypescriptCode(code: string): string {
    // Add custom imports or modifications
    return `// Custom plugin enhancement\n${code}`;
  }
}

// Register plugin
tywrap.use(new MyPlugin());
```

---

## Integration APIs

### Build Tool Integration

#### Vite Plugin
```typescript
// vite.config.ts
import { tywrap } from 'tywrap/vite';

export default defineConfig({
  plugins: [
    tywrap({
      configFile: './tywrap.config.ts',
      watch: true,
      generateOnBuild: true
    })
  ]
});
```

#### Webpack Plugin  
```javascript
// webpack.config.js
const { TywrapWebpackPlugin } = require('tywrap/webpack');

module.exports = {
  plugins: [
    new TywrapWebpackPlugin({
      configFile: './tywrap.config.json'
    })
  ]
};
```

#### Rollup Plugin
```javascript
// rollup.config.js
import { tywrap } from 'tywrap/rollup';

export default {
  plugins: [
    tywrap({
      configFile: './tywrap.config.ts'
    })
  ]
};
```

---

## Migration Guide

### From v0.0.x to v0.1.x

```typescript
// Old API (v0.0.x)
import tywrap from 'tywrap';
const result = tywrap.generate({ modules: ['numpy'] });

// New API (v0.1.x)
import { generate } from 'tywrap';
const result = await generate({
  pythonModules: {
    numpy: { runtime: 'node', typeHints: 'strict' }
  }
});
```

### Configuration Changes

```json
// Old format
{
  "modules": ["numpy", "pandas"],
  "outputDir": "./generated"
}

// New format  
{
  "pythonModules": {
    "numpy": { "runtime": "node", "typeHints": "strict" },
    "pandas": { "runtime": "node", "typeHints": "strict" }
  },
  "output": { "dir": "./generated", "format": "esm" }
}
```

For more examples and usage patterns, see the [Examples](../examples/README.md) section.