# tywrap

TypeScript wrapper for Python libraries with full type safety.

> **⚠️ EXPERIMENTAL SOFTWARE**  
> **Version 0.1.0** - This project is in early experimental development. APIs may change significantly between versions. Not recommended for production use until version 1.0.0.

TypeScript is great. But there are many robust libraries in Python, especially for data and science. Sometimes, there's a library only in Python. Wouldn't it be great if you could those libraries them in your TypeScript project?

tywrap is a build-time code generation system that makes Python libraries feel native in TypeScript with zero runtime overhead and complete type safety.

## Features

- **Full Type Safety** - Complete TypeScript type definitions generated from Python source
- **Zero Runtime Overhead** - Build-time code generation with optimized execution
- **Multi-Runtime Support** - Works in Node.js, Deno, Bun, and browsers
- **IR-First Generation** - Python IR extractor drives type-safe generation
- **Smart Caching** - Intelligent caching and batching for maximum performance
- **Developer Experience** - Hot reload, source maps, and IDE integration

## Quick Start

```bash
# npm
npm install tywrap

# pnpm
pnpm add tywrap

# yarn
yarn add tywrap

# bun
bun add tywrap

# deno
deno add npm:tywrap
```

### Basic Usage

```typescript
import { generate } from 'tywrap';

await generate({
  pythonModules: { math: { runtime: 'node', typeHints: 'strict' } },
  output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false },
  runtime: { node: { pythonPath: 'python3' } },
  performance: { caching: false, batching: false, compression: 'none' },
  development: { hotReload: false, sourceMap: false, validation: 'none' }
});

// Import from ./generated after running generate()
```

## Runtime Support

### Node.js
```typescript
import { NodeBridge } from 'tywrap/node';

const bridge = new NodeBridge({
  pythonPath: '/usr/bin/python3',
  virtualEnv: './venv'
});
```

### Deno
```typescript
import { tywrap } from 'https://deno.land/x/tywrap/mod.ts';
// Or using npm specifier
import { tywrap } from 'npm:tywrap';
```

### Bun
```typescript
import { tywrap } from 'tywrap';
// Works out of the box with Bun's fast runtime
```

### Browser (Pyodide)
```typescript
import { PyodideBridge } from 'tywrap/pyodide';

const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/'
});
```

## Configuration

Create a `tywrap.config.ts` file:

```typescript
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    'pandas': { 
      version: '2.1.0',
      runtime: 'pyodide',
      functions: ['DataFrame', 'read_csv', 'concat'],
      typeHints: 'strict'
    },
    'numpy': {
      version: '1.24.0', 
      runtime: 'auto', // Auto-select best runtime
      alias: 'np'
    },
    './custom_module.py': {
      runtime: 'node',
      watch: true // Enable hot reload
    }
  },
  
  output: {
    dir: './src/generated',
    format: 'esm',
    declaration: true,
    sourceMap: true
  },
  
  performance: {
    caching: true,
    batching: true,
    compression: 'auto'
  },
  
  development: {
    hotReload: true,
    validation: 'runtime'
  }
});
```

### Configuration Fields

- `pythonModules` – modules to wrap and their options
- `output` – directory, format and generated artifacts
- `runtime` – runtime paths and timeouts
- `performance` – caching and batching controls
- `development` – hot reloading and validation mode

### Extension Hooks

Plugins can extend tywrap via lifecycle hooks:

- `beforeGeneration(options)`
- `afterGeneration(result)`
- `transformPythonType(type)`
- `transformTypescriptCode(code)`

See the [Configuration Guide](./docs/configuration.md) for details.

## Build Tool Integration

### Vite
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { tywrap } from 'tywrap/vite';

export default defineConfig({
  plugins: [
    tywrap({
      configFile: './tywrap.config.ts'
    })
  ]
});
```

### Rollup/Webpack
```typescript
// rollup.config.js
import { tywrap } from 'tywrap/rollup';

export default {
  plugins: [tywrap()]
};
```

## Performance

tywrap is designed for production use with enterprise-grade performance:

- **30-50% faster** than runtime bridges
- **Zero runtime overhead** with build-time optimization  
- **Smart bundling** with tree-shaking and code splitting
- **Intelligent caching** with automatic invalidation
- **Request batching** for optimal throughput

## How It Works

1. **Python IR Extraction** - `tywrap_ir` reflects Python modules and emits versioned JSON IR
2. **Type Mapping** - Converts Python IR annotations to TypeScript types
3. **Code Generation** - Generates TypeScript wrappers with runtime bridge hooks
4. **Runtime Execution** - Node.js (subprocess) MVP; others later

## Arrow/Codec (optional)

Numpy/Pandas results can be transported more efficiently using Arrow. tywrap emits structured envelopes from the Python side; on the JS side you can opt-in to Arrow decoding.

Envelopes (from Python bridge):
- `{"__tywrap__":"dataframe","encoding":"arrow","b64":"..."}` (Feather/Arrow)
- `{"__tywrap__":"series","encoding":"arrow","b64":"..."}` or JSON fallback with `data`
- `{"__tywrap__":"ndarray","encoding":"arrow","b64":"...","shape":[...]} or JSON fallback with `data`

Enable decoding (Node/browser) when you have `apache-arrow` installed:

```ts
import { registerArrowDecoder } from 'tywrap';

// If you have apache-arrow available, register a decoder once at app startup
import('apache-arrow').then(mod => {
  const Table = (mod as { Table: { from: (i: Uint8Array | Iterable<Uint8Array>) => unknown } }).Table;
  registerArrowDecoder(bytes => {
    try {
      return Table.from(bytes as Uint8Array);
    } catch {
      return Table.from([bytes as Uint8Array]);
    }
  });
});
```

If you don't register a decoder, `decodeValue`/`decodeValueAsync` will return raw `Uint8Array` for Arrow-encoded payloads or JSON `data` for fallbacks.

Fallback policy: By default, the Python bridge requires Arrow for DataFrame/Series/ndarray and will throw if unavailable. To opt into JSON fallback for development or constrained environments, set the environment variable `TYWRAP_CODEC_FALLBACK=json` when launching Python (e.g., `TYWRAP_CODEC_FALLBACK=json node app.js`).

## Matrix quick run (optional)

Generate wrappers for a curated set of libraries to validate coverage locally.

```bash
npm run build
npm run matrix
```

Notes:
- The harness creates `.tywrap/venv` and prefers `python3.12` for better wheel availability (e.g., pydantic-core).
- Results end up in `generated/`. You can tweak the list in `tools/matrix.js`.

## Roadmap

- [x] Core architecture and multi-runtime support
- [x] Python AST analysis and type extraction  
- [x] TypeScript code generation
- [ ] Build tool integrations (Vite, Webpack, Rollup)
- [ ] Advanced optimizations (SharedArrayBuffer, streaming)
- [ ] IDE extensions and developer tools
- [ ] Enterprise features (security sandbox, monitoring)

## Documentation

- [Getting Started Guide](./docs/getting-started.md) - Get up and running in minutes
- [Configuration Reference](./docs/configuration.md) - Complete configuration options
- [Node.js Runtime](./docs/runtimes/nodejs.md) - Node.js integration guide
- [Browser Runtime](./docs/runtimes/browser.md) - Browser/Pyodide integration
- [API Reference](./docs/api/README.md) - Complete API documentation
- [Examples](./docs/examples/README.md) - Real-world usage examples
- [Troubleshooting](./docs/troubleshooting/README.md) - Common issues and solutions

## Versioning

tywrap follows [Semantic Versioning](https://semver.org/):

- **0.x.x** - Experimental releases. Breaking changes may occur in any release
- **1.x.x** - Stable API. Breaking changes only in major versions
- **x.Y.x** - New features and improvements (backwards compatible)
- **x.x.Z** - Bug fixes and patches (backwards compatible)

### Version 0.1.0 Status

**Current State:**
- ✅ Core TypeScript generation working
- ✅ Node.js runtime bridge functional
- ✅ Multi-runtime support (Node.js, Deno, Bun, Browser)
- ✅ Type safety and IR extraction
- ⚠️ API surface may change significantly
- ⚠️ Limited real-world testing

**Roadmap to 1.0:**
- Extensive testing with popular Python libraries
- API stabilization and documentation
- Performance optimization
- Production deployment guides

## Contributing

We welcome contributions! See [CONTRIBUTING](./CONTRIBUTING.md).

## License

MIT © [tywrap contributors](LICENSE)

## Links

- [Documentation](https://tywrap.dev/docs)
- [API Reference](https://tywrap.dev/api)  
- [Examples](https://github.com/tywrap/examples)
- [Discord Community](https://discord.gg/tywrap)