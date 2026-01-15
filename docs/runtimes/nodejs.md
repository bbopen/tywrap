# Node.js Runtime Guide

The Node.js runtime is tywrap's default and most feature-complete runtime environment. It uses child processes to execute Python code, providing excellent performance and compatibility.

## Overview

The Node.js runtime:
- **Executes Python via subprocess** - Spawns Python processes for code execution
- **High Performance** - Direct process communication with minimal overhead
- **Full Feature Support** - Supports all tywrap features and Python libraries
- **Development Friendly** - Excellent debugging and error reporting
- **Production Ready** - Battle-tested with proper error handling and timeouts

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

### Basic Options
```json
{
  "runtime": {
    "node": {
      "pythonPath": "/usr/local/bin/python3",
      "scriptPath": "./runtime/python_bridge.py",
      "cwd": "./",
      "timeoutMs": 30000
    }
  }
}
```

### Advanced Options
```json
{
  "runtime": {
    "node": {
      "pythonPath": "/usr/local/bin/python3.11",
      "virtualEnv": "./venv",
      "scriptPath": "./custom_bridge.py",
      "cwd": "./python_src",
      "timeoutMs": 60000,
      "enableJsonFallback": true,
      "env": {
        "PYTHONPATH": "./additional_modules",
        "OMP_NUM_THREADS": "4"
      }
    }
  }
}
```

### Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pythonPath` | `string` | `'python3'` | Path to Python executable |
| `virtualEnv` | `string` | - | Virtual environment directory |
| `scriptPath` | `string` | Built-in bridge | Custom Python bridge script |
| `cwd` | `string` | `process.cwd()` | Working directory for Python |
| `timeoutMs` | `number` | `30000` | Subprocess timeout in milliseconds |
| `enableJsonFallback` | `boolean` | `false` | Use JSON for data transport fallback |
| `env` | `Record<string, string>` | `{}` | Additional environment variables |

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
      "pythonPath": "python3"  // pyenv will provide the right version
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

```typescript
import { createRequire } from 'node:module';
import { registerArrowDecoder } from 'tywrap';

// Register Arrow decoder for optimal performance
const require = createRequire(import.meta.url);
const { tableFromIPC } = require('apache-arrow');
registerArrowDecoder(bytes => tableFromIPC(bytes));

// If you don't register a decoder, Arrow-encoded payloads will throw.
// To accept raw bytes, register a passthrough decoder:
// registerArrowDecoder(bytes => bytes);
```

### JSON Fallback
For environments without Arrow support:

```json
{
  "runtime": {
    "node": {
      "enableJsonFallback": true
    }
  }
}
```

Or set environment variable:
```bash
export TYWRAP_CODEC_FALLBACK=json
```

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
  console.error('Error type:', error.name);        // ValueError
  console.error('Error message:', error.message);  // math domain error
  console.error('Python traceback:', error.traceback);
}
```

### Debugging Configuration
```json
{
  "runtime": {
    "node": {
      "timeoutMs": 0,  // Disable timeout for debugging
      "env": {
        "PYTHONUNBUFFERED": "1",     // Immediate stdout/stderr
        "TYWRAP_DEBUG": "1"          // Enable debug logging
      }
    }
  },
  "debug": true
}
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
  math.sin(3)
]);
```

### Memory Management
```json
{
  "runtime": {
    "node": {
      "env": {
        "PYTHONMALLOC": "malloc",    // Use system malloc
        "OMP_NUM_THREADS": "4"       // Limit OpenMP threads
      }
    }
  }
}
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
  timeoutMs: 30000
});

// Monitor process health
setInterval(async () => {
  try {
    await bridge.call('math', 'sqrt', [4]);  // Health check
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
      - TYWRAP_PYTHON_PATH=/usr/bin/python3
      - TYWRAP_CODEC_FALLBACK=json  # For smaller containers
    ports:
      - "3000:3000"
```

### Environment Variables
```bash
# Production environment
export NODE_ENV=production
export TYWRAP_PYTHON_PATH="/usr/local/bin/python3"
export TYWRAP_CACHE_DIR="/tmp/tywrap-cache"
export TYWRAP_MEMORY_LIMIT="2048"

# Security
export PYTHONDONTWRITEBYTECODE=1
export PYTHONUNBUFFERED=1
```

## Security Considerations

### Subprocess Security
```json
{
  "runtime": {
    "node": {
      "cwd": "/safe/directory",     // Restrict working directory
      "env": {
        "PATH": "/usr/bin:/bin",    // Limit PATH
        "PYTHONPATH": "/safe/python/libs"
      },
      "timeoutMs": 10000            // Prevent hanging processes
    }
  }
}
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
```json
{
  "runtime": {
    "node": {
      "timeoutMs": 60000,  // Increase timeout
      "env": {
        "OMP_NUM_THREADS": "1"  // Reduce parallelism
      }
    }
  }
}
```

### Debug Mode
```bash
# Enable debug logging
export TYWRAP_DEBUG=1
export TYWRAP_VERBOSE=1

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

```json
{
  "runtime": {
    "node": {
      "scriptPath": "./custom_bridge.py"
    }
  }
}
```

### Process Pooling
```typescript
import { NodeBridge } from 'tywrap/node';

// Create multiple bridges for load balancing
const bridges = Array.from({ length: 4 }, () => 
  new NodeBridge({ pythonPath: 'python3' })
);

let currentBridge = 0;
function getNextBridge() {
  const bridge = bridges[currentBridge];
  currentBridge = (currentBridge + 1) % bridges.length;
  return bridge;
}
```

## Next Steps

- [Configuration Guide](../configuration.md) - Complete configuration reference
- [Examples](../examples/README.md) - Usage examples and patterns
- [Troubleshooting](../troubleshooting/README.md) - Common issues and solutions
- [API Reference](../api/README.md) - Complete API documentation
