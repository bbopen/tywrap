# Troubleshooting Guide

Common issues and solutions when using tywrap. This guide helps you diagnose and fix problems quickly.

## Diagnostics

### Health Check Script
Create a `tywrap-health.js` file to quickly diagnose your setup:

```javascript
#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync } from 'fs';

console.log('tywrap Health Check\n');

// Check Node.js version
const nodeVersion = process.version;
console.log(`Node.js: ${nodeVersion}`);

// Check Python installation
try {
  const pythonVersion = execSync('python3 --version', { encoding: 'utf8' });
  console.log(`Python: ${pythonVersion.trim()}`);
} catch {
  console.log('Python: Not found or not accessible');
}

// Check tywrap installation
try {
  const tywrapVersion = execSync('npx tywrap --version', { encoding: 'utf8' });
  console.log(`tywrap: ${tywrapVersion.trim()}`);
} catch {
  console.log('tywrap: Not installed or not working');
}

// Check configuration
const configCandidates = [
  'tywrap.config.ts',
  'tywrap.config.mts',
  'tywrap.config.js',
  'tywrap.config.mjs',
  'tywrap.config.cjs',
  'tywrap.config.json',
];
const configFile = configCandidates.find((name) => existsSync(name));
console.log(
  configFile ? `Configuration: Found ${configFile}` : 'Configuration: No config file found'
);

console.log('\nRun this script with: node tywrap-health.js');
```

```bash
# Run health check
node tywrap-health.js
```

## Common Error Categories

### Installation Issues
- [Module not found errors](#module-not-found)
- [Python path issues](#python-path-issues)
- [Permission problems](#permission-problems)

### Configuration Issues  
- [Invalid configuration](#invalid-configuration)
- [Module resolution failures](#module-resolution)
- [Type generation errors](#type-generation-errors)

### Runtime Issues
- [Process timeout errors](#process-timeouts)
- [Memory issues](#memory-issues)
- [Import errors](#import-errors)

### Build Issues
- [Generation failures](#generation-failures)
- [TypeScript compilation errors](#typescript-errors)
- [Build tool integration](#build-tool-issues)

---

## Installation Issues

### Module Not Found
**Error**: `Error: Cannot find module 'tywrap'`

**Solutions**:
```bash
# Verify installation
npm list tywrap

# Reinstall if missing
npm install tywrap

# Clear cache if corrupted
npm cache clean --force
npm install tywrap

# Check in different package manager
yarn list tywrap
pnpm list tywrap
```

### Python Path Issues
**Error**: `Error: spawn python3 ENOENT` or `Python not found`

**Solutions**:
```bash
# Check Python installation
which python3
python3 --version

# Common Python locations
/usr/bin/python3
/usr/local/bin/python3
/opt/homebrew/bin/python3
~/.pyenv/shims/python3

# Update configuration
{
  "runtime": {
    "node": {
      "pythonPath": "/usr/local/bin/python3"
    }
  }
}

# macOS with Homebrew
brew install python3

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install python3

# Windows
# Download from python.org or use Windows Store
```

### Permission Problems
**Error**: `Error: spawn EACCES` or `Permission denied`

**Solutions**:
```bash
# Check executable permissions
ls -la $(which python3)

# Fix permissions
chmod +x /usr/local/bin/python3

# Check directory permissions
ls -la ~/.npm
ls -la node_modules

# Fix npm permissions (if needed)
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH
```

---

## Configuration Issues

### Invalid Configuration
**Error**: `Invalid configuration` or schema validation errors

**Solution**:
```typescript
// Use TypeScript config for validation
// tywrap.config.ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    numpy: { 
      runtime: 'node' as const,  // Correct type
      typeHints: 'strict' as const
    }
  },
  output: {
    dir: './generated',
    format: 'esm' as const
  }
});
```

```bash
# Validate configuration
npx tywrap validate-config
```

### Module Resolution
**Error**: `ModuleNotFoundError: No module named 'xyz'`

**Solutions**:
```bash
# Check Python module installation
python3 -c "import sys; print(sys.path)"
python3 -c "import numpy; print(numpy.__file__)"

# Install missing module
pip3 install numpy

# Check virtual environment
source venv/bin/activate
pip list

# Update configuration with correct path
{
  "runtime": {
    "node": {
      "pythonPath": "./venv/bin/python",
      "virtualEnv": "./venv"
    }
  }
}
```

### Type Generation Errors
**Error**: Type analysis failures or incorrect types generated

**Solutions**:
```json
// Relax type checking for problematic modules
{
  "pythonModules": {
    "problematic_module": {
      "typeHints": "loose",
      "functions": ["specific_function"],  // Limit scope
      "classes": []  // Skip classes if problematic
    }
  }
}
```

```bash
# Enable debug logging
export TYWRAP_DEBUG=1
npx tywrap generate
```

---

## Runtime Issues

### Process Timeouts
**Error**: `Python call timed out` or hanging operations

**Solutions**:
```json
{
  "runtime": {
    "node": {
      "timeoutMs": 60000,  // Increase timeout
      "env": {
        "OMP_NUM_THREADS": "1",  // Reduce parallelism
        "MKL_NUM_THREADS": "1"
      }
    }
  }
}
```

```typescript
// Implement timeout handling
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
}

// Usage
try {
  const result = await withTimeout(math.complicated_calculation(), 10000);
} catch (error) {
  console.error('Operation timed out:', error);
}
```

### Protocol Errors
**Error**: `Protocol error from Python bridge`

**Cause**: The Python process printed to stdout or returned malformed JSON.

**Solutions**:
- Remove `print()` statements or logging to stdout in Python code.
- Ensure any debugging output goes to stderr.
- Verify custom bridge scripts follow the JSON line protocol.

### Memory Issues
**Error**: Out of memory errors or process crashes

**Solutions**:
```json
{
  "runtime": {
    "node": {
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=4096"
      }
    }
  }
}
```

```bash
# Monitor memory usage
node --max-old-space-size=4096 your-app.js

# Check system memory
free -h  # Linux
top      # General
```

### Import Errors
**Error**: Import failures in generated TypeScript code

**Solutions**:
```typescript
// Check generated code structure
// generated/module.generated.ts should exist

// Verify import paths
import { function_name } from './generated/module.generated.js';
//                                                        ^^^ Note .js extension

// For TypeScript module resolution issues
{
  "compilerOptions": {
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  }
}
```

---

## Build Issues

### Generation Failures
**Error**: `Failed to generate wrappers` or empty output

**Solutions**:
```bash
# Clean and regenerate
rm -rf generated/
rm -rf .tywrap/
npx tywrap generate

# Enable debug mode
export TYWRAP_DEBUG=1
export TYWRAP_VERBOSE=1
npx tywrap generate

# Check Python module structure
python3 -c "
import inspect
import your_module
print(dir(your_module))
for name, obj in inspect.getmembers(your_module):
    print(f'{name}: {type(obj)}')
"
```

### TypeScript Errors
**Error**: TypeScript compilation errors in generated code

**Solutions**:
```bash
# Check TypeScript version compatibility
npx tsc --version
npm install typescript@latest

# Update tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext", 
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "skipLibCheck": true
  }
}

# Regenerate with correct output format
{
  "output": {
    "format": "esm",
    "declaration": true
  }
}
```

### Build Tool Issues
**Error**: Vite, Webpack, or other bundler integration problems

**Vite Solutions**:
```typescript
// vite.config.ts
export default defineConfig({
  optimizeDeps: {
    exclude: ['tywrap']
  },
  build: {
    commonjsOptions: {
      include: [/tywrap/, /node_modules/]
    }
  }
});
```

**Webpack Solutions**:
```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      "child_process": false,
      "fs": false,
      "path": require.resolve("path-browserify")
    }
  }
};
```

---

## Platform-Specific Issues

### macOS Issues
```bash
# Xcode Command Line Tools required
xcode-select --install

# Homebrew Python issues
brew install python3
brew link python3

# Fix PATH issues
echo 'export PATH="/opt/homebrew/bin:$PATH"' >> ~/.zshrc
```

### Windows Issues
```powershell
# Install Python from Microsoft Store or python.org
# Add Python to PATH

# PowerShell execution policy
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Use forward slashes in configuration
{
  "runtime": {
    "node": {
      "pythonPath": "C:/Python39/python.exe"
    }
  }
}
```

### Linux Issues
```bash
# Install Python development headers
sudo apt-get install python3-dev python3-pip

# Fix library linking issues  
sudo apt-get install build-essential

# SELinux issues (if applicable)
setsebool -P httpd_exec_mem 1
```

### Docker Issues
```dockerfile
# Dockerfile fixes
FROM node:18-slim

# Install Python
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Set Python path
ENV TYWRAP_PYTHON_PATH=/usr/bin/python3
```

---

## Debug Mode and Logging

### Enable Debug Mode
```bash
# Environment variables
export TYWRAP_DEBUG=1
export TYWRAP_VERBOSE=1
export NODE_DEBUG=tywrap

# Run with debug output
npx tywrap generate 2>&1 | tee debug.log
```

### Custom Logging
```typescript
// Add logging to your application
import { createLogger } from 'tywrap/utils';

const logger = createLogger({
  level: 'debug',
  output: './logs/tywrap.log'
});

// Monitor bridge communication
bridge.on('request', (req) => logger.debug('Request:', req));
bridge.on('response', (res) => logger.debug('Response:', res));
```

---

## Performance Debugging

### Profile Generation Time
```bash
# Time the generation process
time npx tywrap generate

# Profile Node.js execution
node --prof your-script.js
node --prof-process isolate-*.log > profile.txt
```

### Monitor Runtime Performance
```typescript
// Monitor Python call performance
const originalCall = bridge.call;
bridge.call = async function(module, fn, args) {
  const start = Date.now();
  try {
    const result = await originalCall.call(this, module, fn, args);
    console.log(`${module}.${fn} took ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    console.error(`${module}.${fn} failed after ${Date.now() - start}ms`);
    throw error;
  }
};
```

---

## Getting Help

### Information to Include
When reporting issues, please include:

```bash
# System information
node --version
python3 --version
npm list tywrap

# Configuration
cat tywrap.config.ts

# Error logs
npx tywrap generate 2>&1 | tee error.log

# Environment
env | grep -E "(TYWRAP|PYTHON|NODE)"
```

### Create Minimal Reproduction
```bash
# Create minimal test case
mkdir tywrap-issue
cd tywrap-issue
npm init -y
npm install tywrap

# Create minimal config
cat <<'EOF' > tywrap.config.ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    math: { runtime: 'node', typeHints: 'strict' }
  },
  output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false }
});
EOF

# Test generation
npx tywrap generate
```

### Community Resources
- **GitHub Issues**: [Report bugs](https://github.com/tywrap/tywrap/issues)
- **Discussions**: [Ask questions](https://github.com/tywrap/tywrap/discussions)
- **Discord**: [Real-time help](https://discord.gg/tywrap)
- **Stack Overflow**: Tag your questions with `tywrap`

---

## Advanced Debugging

### Python Bridge Debug
```python
# Add to custom Python bridge
import logging
logging.basicConfig(level=logging.DEBUG)

import sys
import traceback

def debug_request(request):
    print(f"DEBUG: Processing request: {request}", file=sys.stderr)
    try:
        # Process request
        result = handle_request(request)
        print(f"DEBUG: Request successful: {result}", file=sys.stderr)
        return result
    except Exception as e:
        print(f"DEBUG: Request failed: {e}", file=sys.stderr)
        print(f"DEBUG: Traceback: {traceback.format_exc()}", file=sys.stderr)
        raise
```

### TypeScript Debug
```typescript
// Enable TypeScript compiler debugging
{
  "compilerOptions": {
    "traceResolution": true,
    "listFiles": true,
    "extendedDiagnostics": true
  }
}

// Run TypeScript compiler directly
npx tsc --noEmit --traceResolution
```

This troubleshooting guide covers the most common issues. For runtime-specific detail, see:
- [Node.js Runtime](../runtimes/nodejs.md)
- [Browser Runtime (Pyodide)](../runtimes/browser.md)
- [Build Tool Issues](#build-tool-issues)
