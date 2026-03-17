# Node.js Runtime Guide

The Node.js runtime is tywrap's default and most feature-complete runtime
environment. It uses child processes to execute Python code, providing excellent
performance and compatibility.

## Overview

The Node.js runtime:

- **Executes Python via subprocess** - Spawns Python processes for code
  execution
- **High Performance** - Direct process communication with minimal overhead
- **Full Feature Support** - Supports all tywrap features and Python libraries
- **Development Friendly** - Excellent debugging and error reporting
- **Production Ready** - Battle-tested with proper error handling and timeouts

## Bridge Selection

- **NodeBridge (default)**: correctness-first, simplest lifecycle, recommended
  for most users.
- **OptimizedNodeBridge (experimental)**: process pooling + optional caching for
  throughput; not a drop-in replacement yet and not part of the public API
  exports. See `ROADMAP.md` for the unification plan and parity goals.

Both bridges share the same JSONL core for protocol validation, timeouts, and
stderr buffering.

## Basic Setup

### Installation

```bash
npm install tywrap
```

### Configuration

```json
{
  "pythonModules": {
    "numpy": { "runtime": "node" },
    "pandas": { "runtime": "node" }
  },
  "runtime": {
    "node": {
      "pythonPath": "python3",
      "timeout": 30000
    }
  }
}
```

### Usage

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import { array, zeros } from './generated/numpy.generated.js';

const bridge = new NodeBridge({ pythonPath: 'python3' });
setRuntimeBridge(bridge);

async function example() {
  const arr = await array([1, 2, 3, 4, 5]);
  const empty = await zeros([3, 3]);
  console.log('Array created:', arr);
}
```

### Bridge Diagnostics

```typescript
const info = await bridge.getBridgeInfo({ refresh: true });
console.log(info.protocol, info.pythonVersion, info.instances);
```

## Configuration Options

`tywrap.config.*` and `NodeBridge` do different jobs:

- `tywrap.config.*` controls wrapper generation.
- `new NodeBridge(...)` controls the live subprocess bridge in your app.

### `tywrap.config.*` fields

```json
{
  "runtime": {
    "node": {
      "pythonPath": "/usr/local/bin/python3",
      "virtualEnv": "./venv",
      "timeout": 30000
    }
  }
}
```

### `NodeBridge` constructor options

```typescript
const bridge = new NodeBridge({
  pythonPath: '/usr/local/bin/python3.11',
  virtualEnv: './venv',
  scriptPath: './custom_bridge.py',
  cwd: './python_src',
  timeoutMs: 60000,
  queueTimeoutMs: 60000,
  inheritProcessEnv: true,
  env: {
    PYTHONPATH: './additional_modules',
    OMP_NUM_THREADS: '4',
  },
  codec: {
    bytesHandling: 'base64',
  },
});
```

| Option                    | Type                                     | Default         | Description                              |
| ------------------------- | ---------------------------------------- | --------------- | ---------------------------------------- |
| `pythonPath`              | `string`                                 | auto-detect     | Path to the Python executable            |
| `scriptPath`              | `string`                                 | built-in bridge | Custom `python_bridge.py` path           |
| `virtualEnv`              | `string`                                 | —               | Virtual environment root                 |
| `cwd`                     | `string`                                 | `process.cwd()` | Working directory for the subprocess     |
| `timeoutMs`               | `number`                                 | `30000`         | Per-call timeout                         |
| `queueTimeoutMs`          | `number`                                 | `30000`         | Queue timeout when the pool is saturated |
| `minProcesses`            | `number`                                 | `1`             | Minimum worker count                     |
| `maxProcesses`            | `number`                                 | `1`             | Maximum worker count                     |
| `maxConcurrentPerProcess` | `number`                                 | `10`            | Concurrent requests per worker           |
| `inheritProcessEnv`       | `boolean`                                | `false`         | Pass the full parent environment through |
| `enableCache`             | `boolean`                                | `false`         | Cache pure function results              |
| `env`                     | `Record<string, string \| undefined>`    | `{}`            | Extra subprocess env vars                |
| `codec`                   | `CodecOptions`                           | —               | Codec validation and byte handling       |
| `warmupCommands`          | `Array<{ module, functionName, args? }>` | `[]`            | Commands to run when each worker starts  |

Deprecated compatibility fields still exist on the interface: `maxIdleTime`,
`maxRequestsPerProcess`, `enableJsonFallback`, and `maxLineLength`. Avoid them
in new code.

By default, the subprocess environment is minimal (PATH/PYTHON*/TYWRAP\_* only).
Set `inheritProcessEnv: true` to pass through the full environment when needed.

## Python Environment Setup

### Using System Python

```json
{
  "runtime": {
    "node": {
      "pythonPath": "/usr/bin/python3"
    }
  }
}
```

### Using Virtual Environment

```json
{
  "runtime": {
    "node": {
      "pythonPath": "./venv/bin/python",
      "virtualEnv": "./venv"
    }
  }
}
```

### Using Conda Environment

```bash
# Activate conda environment first
conda activate myenv

# Then use conda's python
```

```json
{
  "runtime": {
    "node": {
      "pythonPath": "/opt/miniconda3/envs/myenv/bin/python"
    }
  }
}
```

### Using pyenv

```bash
# Set Python version with pyenv
pyenv local 3.11.0
```

```json
{
  "runtime": {
    "node": {
      "pythonPath": "python3" // pyenv will provide the right version
    }
  }
}
```

## Data Transport and Performance

### Arrow Transport (Default)

For optimal performance with NumPy/Pandas data:

```bash
# Install Apache Arrow for Python
pip install pyarrow

# Install Apache Arrow for Node.js (optional, for decoding)
npm install apache-arrow
```

Auto path (when apache-arrow is installed):

```typescript
import { autoRegisterArrowDecoder } from 'tywrap';

await autoRegisterArrowDecoder();
```

Manual path (customize decoding outside NodeBridge):

```typescript
import { registerArrowDecoder } from 'tywrap';
import { tableFromIPC } from 'apache-arrow';

registerArrowDecoder(bytes => tableFromIPC(bytes));
```

### JSON Fallback

For environments without Arrow support, set the environment variable:

```bash
export TYWRAP_CODEC_FALLBACK=json
```

### Payload Size Limit

The subprocess bridge writes a single JSONL response per call. To prevent
oversized payloads:

```bash
export TYWRAP_CODEC_MAX_BYTES=10485760  # 10 MB cap
```

If a response exceeds `TYWRAP_CODEC_MAX_BYTES`, the call fails with an explicit
error. Use this instead of older line-length knobs.

### Request Size Limit

To cap incoming request payloads (JSONL request size in bytes):

```bash
export TYWRAP_REQUEST_MAX_BYTES=1048576  # 1 MB cap
```

If a request exceeds `TYWRAP_REQUEST_MAX_BYTES`, the call fails with an explicit
error.

### Torch Tensor Copy Opt-in

For GPU tensors or non-contiguous tensors, enable explicit CPU/copy conversion:

```bash
export TYWRAP_TORCH_ALLOW_COPY=1
```

## Error Handling and Debugging

### Error Types

```typescript
try {
  const result = await math.sqrt(-1);
} catch (error) {
  console.error('Error type:', error.name); // ValueError
  console.error('Error message:', error.message); // math domain error
  console.error('Python traceback:', error.traceback);
}
```

### Debugging Configuration

Use the CLI's debug flag when you are troubleshooting wrapper generation:

```bash
npx tywrap generate --debug
```

Use runtime log env vars for subprocess diagnostics:

```bash
export TYWRAP_LOG_LEVEL=DEBUG
export TYWRAP_LOG_JSON=1
```

If you need to disable timeouts or pass extra Python env vars while debugging,
do it on the bridge instance:

```typescript
const bridge = new NodeBridge({
  pythonPath: 'python3',
  timeoutMs: 0,
  env: {
    PYTHONUNBUFFERED: '1',
  },
});
```

### Common Error Scenarios

**Module Import Error**:

```typescript
// Error: ModuleNotFoundError: No module named 'numpy'
// Solution: Install module or check PYTHONPATH
```

**Timeout Error**:

```typescript
// Error: Python call timed out
// Solution: Increase timeoutMs or optimize Python code
```

**Process Exit Error**:

```typescript
// Error: Python process exited
// Solution: Check Python path and permissions
```

## Performance Optimization

### Process Reuse

tywrap automatically reuses Python processes for better performance:

```typescript
// These calls will reuse the same Python process
const a1 = await numpy.array([1, 2, 3]);
const a2 = await numpy.array([4, 5, 6]);
const result = await numpy.add(a1, a2);
```

### Batching Operations

```typescript
// Instead of multiple round trips
const sin1 = await math.sin(1);
const sin2 = await math.sin(2);
const sin3 = await math.sin(3);

// Use Promise.all for concurrent execution
const [sin1, sin2, sin3] = await Promise.all([
  math.sin(1),
  math.sin(2),
  math.sin(3),
]);
```

### Memory Management

Pass Python-specific tuning through `env` on the bridge:

```typescript
const bridge = new NodeBridge({
  pythonPath: 'python3',
  env: {
    PYTHONMALLOC: 'malloc',
    OMP_NUM_THREADS: '4',
  },
});
```

## Production Deployment

### Process Management

```typescript
// Graceful shutdown
process.on('SIGTERM', async () => {
  // tywrap automatically cleans up Python processes
  process.exit(0);
});
```

### Resource Monitoring

```typescript
import { NodeBridge } from 'tywrap/node';

const bridge = new NodeBridge({
  pythonPath: 'python3',
  timeoutMs: 30000,
});

// Monitor process health
setInterval(async () => {
  try {
    await bridge.call('math', 'sqrt', [4]); // Health check
  } catch (error) {
    console.error('Python process unhealthy:', error);
    // Restart or alert
  }
}, 60000);
```

### Docker Configuration

```dockerfile
# Dockerfile
FROM node:20-slim

# Install Python and dependencies
RUN apt-get update && apt-get install -y python3 python3-pip
COPY requirements.txt .
RUN pip3 install -r requirements.txt

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

# Generate wrappers at build time
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    environment:
      - TYWRAP_CODEC_FALLBACK=json # For smaller containers
      - TYWRAP_LOG_LEVEL=INFO
    ports:
      - '3000:3000'
```

### Environment Variables

```bash
# Production environment
export NODE_ENV=production
export TYWRAP_CODEC_MAX_BYTES=10485760
export TYWRAP_REQUEST_MAX_BYTES=1048576
export TYWRAP_LOG_LEVEL=INFO

# Security
export PYTHONDONTWRITEBYTECODE=1
export PYTHONUNBUFFERED=1
```

Set the Python executable in config or when you construct the bridge:

```typescript
const bridge = new NodeBridge({
  pythonPath: '/usr/local/bin/python3',
});
```

## Security Considerations

### Subprocess Security

```typescript
const bridge = new NodeBridge({
  cwd: '/safe/directory',
  timeoutMs: 10000,
  env: {
    PATH: '/usr/bin:/bin',
    PYTHONPATH: '/safe/python/libs',
  },
});
```

### Input Validation

```typescript
// Validate inputs before passing to Python
function validateInput(value: unknown): boolean {
  // Add your validation logic
  return typeof value === 'number' && isFinite(value);
}

async function safeSqrt(value: number) {
  if (!validateInput(value) || value < 0) {
    throw new Error('Invalid input for sqrt');
  }
  return await math.sqrt(value);
}
```

## Troubleshooting

### Common Issues

**"Python not found"**:

```bash
# Check Python installation
which python3
python3 --version

# Update configuration
{
  "runtime": {
    "node": {
      "pythonPath": "/usr/local/bin/python3"
    }
  }
}
```

**"Module not found"**:

```bash
# Check module installation
python3 -c "import numpy; print(numpy.__version__)"

# Check PYTHONPATH
python3 -c "import sys; print(sys.path)"
```

**"Permission denied"**:

```bash
# Check executable permissions
ls -la /usr/local/bin/python3

# Fix permissions if needed
chmod +x /usr/local/bin/python3
```

**"Process timeout"**:

```typescript
const bridge = new NodeBridge({
  pythonPath: 'python3',
  timeoutMs: 60000,
  env: {
    OMP_NUM_THREADS: '1',
  },
});
```

### Debug Mode

```bash
# Wrapper-generation diagnostics
npx tywrap generate --debug

# Runtime bridge diagnostics
export TYWRAP_LOG_LEVEL=DEBUG
export TYWRAP_LOG_JSON=1

# Run with debug output
node --trace-warnings your-app.js
```

## Advanced Usage

### Custom Bridge Script

Create your own Python bridge for specialized needs:

```python
# custom_bridge.py
import sys
import json
import traceback

def handle_request(request):
    try:
        # Your custom handling logic
        result = process_request(request)
        return {'result': result}
    except Exception as e:
        return {
            'error': {
                'type': type(e).__name__,
                'message': str(e),
                'traceback': traceback.format_exc()
            }
        }

if __name__ == '__main__':
    # Bridge implementation
    pass
```

```typescript
const bridge = new NodeBridge({
  pythonPath: 'python3',
  scriptPath: './custom_bridge.py',
});
```

### Process Pooling

```typescript
import { NodeBridge } from 'tywrap/node';

// Create multiple bridges for load balancing
const bridges = Array.from(
  { length: 4 },
  () => new NodeBridge({ pythonPath: 'python3' })
);

let currentBridge = 0;
function getNextBridge() {
  const bridge = bridges[currentBridge];
  currentBridge = (currentBridge + 1) % bridges.length;
  return bridge;
}
```

## Next Steps

- [Configuration Guide](/guide/configuration) - Complete configuration reference
- [Examples](/examples/) - Usage examples and patterns
- [Troubleshooting](/troubleshooting/) - Common issues and solutions
- [API Reference](/reference/api/) - Complete API documentation
