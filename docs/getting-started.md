# Getting Started with tywrap

This guide covers installation, basic configuration, and creating your first TypeScript wrapper for a Python library.

## Prerequisites

- Node.js ≥20.0.0, Deno ≥1.46.0, or Bun ≥1.1.0
- Python 3.10+ with target libraries installed
- Basic TypeScript knowledge

## Installation

Choose your preferred package manager:

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

## Configuration

Create a `tywrap.config.ts` in your project root (or run `npx tywrap init`):

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    math: {
      runtime: 'node',
      typeHints: 'strict',
    },
  },
  output: {
    dir: './generated',
    format: 'esm',
    declaration: false,
    sourceMap: false,
  },
  runtime: {
    node: {
      pythonPath: 'python3',
    },
  },
});
```

## Generation

Run the tywrap CLI to generate TypeScript wrappers:

```bash
# Using npx
npx tywrap generate

# Using the CLI directly (if installed globally)
tywrap generate

# Using programmatic API
node -e "import('tywrap').then(async tw => { const cfg = await tw.resolveConfig({ configFile: './tywrap.config.ts' }); await tw.generate(cfg); })"
```

Run `tywrap generate --help` to see all available options and defaults.

The CLI searches for `tywrap.config.ts`, `.mts`, `.js`, `.mjs`, `.cjs`, and `.json` when `--config` is not provided.

## Usage

After generation, import and use your Python library with full TypeScript support:

```typescript
// Import the generated wrapper
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import * as math from './generated/math.generated.js';

const bridge = new NodeBridge({ pythonPath: 'python3' });
setRuntimeBridge(bridge);

// Use with full type safety
async function example() {
  const result = await math.sqrt(16); // TypeScript knows this returns Promise<number>
  const power = await math.pow(2, 3);  // Full autocompletion and type checking
  
  console.log(`√16 = ${result}`); // 4
  console.log(`2³ = ${power}`);   // 8
}

example().catch(console.error);
```

## Custom Module Example

Create a wrapper for a custom Python module:

### Python Module

Create `my_utils.py`:

```python
"""Custom utility functions with type hints."""

def greet(name: str, excited: bool = False) -> str:
    """Generate a greeting message."""
    message = f"Hello, {name}!"
    return message + " 🎉" if excited else message

def calculate_area(width: float, height: float) -> float:
    """Calculate rectangular area."""
    return width * height

class Calculator:
    """Simple calculator class."""
    
    def __init__(self, precision: int = 2):
        self.precision = precision
    
    def add(self, a: float, b: float) -> float:
        """Add two numbers."""
        return round(a + b, self.precision)
    
    def multiply(self, a: float, b: float) -> float:
        """Multiply two numbers."""
        return round(a * b, self.precision)
```

### Configuration

Update your `tywrap.config.ts`:

```json
{
  "pythonModules": {
    "my_utils": { 
      "runtime": "node", 
      "typeHints": "strict",
      "watch": true
    }
  },
  "output": {
    "dir": "./generated",
    "format": "esm", 
    "declaration": true,
    "sourceMap": true
  },
  "development": {
    "hotReload": true,
    "validation": "runtime"
  }
}
```

### Generate and Import

```bash
npx tywrap generate
```

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import { greet, calculate_area, Calculator } from './generated/my_utils.generated.js';

const bridge = new NodeBridge({ pythonPath: 'python3' });
setRuntimeBridge(bridge);

async function demo() {
  // Function calls with type safety
  const greeting = await greet("World", true);
  console.log(greeting); // "Hello, World! 🎉"
  
  const area = await calculate_area(10.5, 8.2);
  console.log(`Area: ${area}`); // Area: 86.1
  
  // Class instantiation and methods
  const calc = await Calculator.create(3);
  const sum = await calc.add(3.14159, 2.71828);
  const product = await calc.multiply(sum, 2);
  await calc.disposeHandle();
  
  console.log(`Sum: ${sum}`);     // Sum: 5.860
  console.log(`Product: ${product}`); // Product: 11.720
}
```

## Runtime Options

### Node.js (Default)
```json
{
  "pythonModules": {
    "numpy": { "runtime": "node" }
  },
  "runtime": {
    "node": {
      "pythonPath": "/usr/local/bin/python3",
      "virtualEnv": "./venv",
      "timeout": 30000
    }
  }
}
```

### Browser (Pyodide)
```json
{
  "pythonModules": {
    "numpy": { "runtime": "pyodide" }
  },
  "runtime": {
    "pyodide": {
      "indexURL": "https://cdn.jsdelivr.net/pyodide/",
      "packages": ["numpy", "scipy"]
    }
  }
}
```

### HTTP API
```json
{
  "pythonModules": {
    "my_api": { "runtime": "http" }
  },
  "runtime": {
    "http": {
      "baseURL": "https://api.example.com/python",
      "timeout": 10000,
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

## Development Workflow

### With Hot Reload
```json
{
  "development": {
    "hotReload": true,
    "sourceMap": true,
    "validation": "runtime"
  }
}
```

### Build Integration
Run `tywrap generate` as part of your build pipeline until official integrations land.

## Performance Tips

1. **Enable Caching**: Set `"caching": true` for faster rebuilds
2. **Use Batching**: Set `"batching": true` for multiple modules  
3. **Smart Compression**: Use `"compression": "auto"` for optimal size
4. **Selective Imports**: Specify only needed functions/classes

```json
{
  "pythonModules": {
    "numpy": {
      "runtime": "node",
      "functions": ["array", "zeros", "ones"],
      "classes": ["ndarray"]
    }
  },
  "performance": {
    "caching": true,
    "batching": true,
    "compression": "auto"
  }
}
```

## Common Patterns

### Error Handling
```typescript
try {
  const result = await math.sqrt(-1);
} catch (error) {
  if (error.message.includes('ValueError')) {
    console.error('Invalid input for sqrt');
  }
}
```

### Working with Arrays
```typescript
import { array, zeros } from './generated/numpy.generated.js';

// Assumes setRuntimeBridge(...) has been called during app startup.
// Create arrays with proper typing
const arr = await array([1, 2, 3, 4, 5]);
const empty = await zeros([3, 3]);
```

### Async/Await Best Practices
```typescript
// Good: Handle promises properly
const results = await Promise.all([
  math.sin(Math.PI / 2),
  math.cos(0),
  math.tan(Math.PI / 4)
]);

// Better: Batch related calls
const batch = await mathBatch([
  { function: 'sin', args: [Math.PI / 2] },
  { function: 'cos', args: [0] },
  { function: 'tan', args: [Math.PI / 4] }
]);
```

## Next Steps

- [Configuration Guide](./configuration.md) - Complete configuration reference
- [Runtime Guides](./runtimes/nodejs.md) - Platform-specific setup
- [Examples](./examples/README.md) - Usage patterns and examples
- [Troubleshooting](./troubleshooting/README.md) - Common issues and solutions

## Support

- [Troubleshooting Guide](./troubleshooting/README.md)
- [GitHub Issues](https://github.com/tywrap/tywrap/issues)
- [GitHub Discussions](https://github.com/tywrap/tywrap/discussions)
