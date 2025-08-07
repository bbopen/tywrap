# Browser Runtime Guide

Run Python code directly in the browser using Pyodide WebAssembly. Perfect for interactive web applications, data visualization, and client-side scientific computing.

## Overview

The browser runtime powered by Pyodide:
- **WebAssembly Python** - Full Python interpreter in the browser
- **No Server Required** - Execute Python entirely client-side  
- **Rich Ecosystem** - NumPy, SciPy, Matplotlib, Pandas support
- **Interactive** - Perfect for notebooks, dashboards, and demos
- **Offline Capable** - Works without network after initial load

## Quick Start

### Installation
```bash
npm install tywrap pyodide
```

### Configuration
```json
{
  "pythonModules": {
    "numpy": { "runtime": "pyodide" },
    "matplotlib": { "runtime": "pyodide" }
  },
  "runtime": {
    "pyodide": {
      "indexURL": "https://cdn.jsdelivr.net/pyodide/",
      "packages": ["numpy", "matplotlib", "scipy"]
    }
  }
}
```

### Basic Usage
```typescript
import { array, zeros } from './generated/numpy.generated.js';
import { PyodideBridge } from 'tywrap/pyodide';

// Initialize Pyodide
const bridge = new PyodideBridge({
  indexURL: 'https://cdn.jsdelivr.net/pyodide/'
});

await bridge.init();

// Use Python libraries
const arr = await array([1, 2, 3, 4, 5]);
const result = await zeros([3, 3]);
console.log('Array:', arr);
```

## Configuration Options

### Basic Configuration
```json
{
  "runtime": {
    "pyodide": {
      "indexURL": "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/",
      "packages": ["numpy", "scipy", "matplotlib"],
      "micropip": ["requests", "beautifulsoup4"]
    }
  }
}
```

### Advanced Configuration
```typescript
// tywrap.config.ts
export default defineConfig({
  pythonModules: {
    numpy: { runtime: 'pyodide' },
    matplotlib: { runtime: 'pyodide' },
    pandas: { runtime: 'pyodide' }
  },
  runtime: {
    pyodide: {
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
      packages: ['numpy', 'scipy', 'matplotlib', 'pandas'],
      micropip: [
        'plotly==5.17.0',
        'seaborn==0.12.2'
      ]
    }
  }
});
```

### Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `indexURL` | `string` | CDN URL | Pyodide package index URL |
| `packages` | `string[]` | `[]` | Pre-built packages to install |
| `micropip` | `string[]` | `[]` | Packages to install via micropip |

## Pyodide Setup and Installation

### CDN Usage (Recommended)
```html
<!DOCTYPE html>
<html>
<head>
  <title>tywrap + Pyodide</title>
</head>
<body>
  <script type="module">
    import { PyodideBridge } from 'tywrap/pyodide';
    
    const bridge = new PyodideBridge({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/'
    });
    
    await bridge.init();
    // Ready to use Python!
  </script>
</body>
</html>
```

### Self-Hosted Pyodide
```bash
# Download Pyodide
wget https://github.com/pyodide/pyodide/releases/download/0.24.1/pyodide-0.24.1.tar.bz2
tar -xjf pyodide-0.24.1.tar.bz2

# Serve from your domain
cp -r pyodide/ public/pyodide/
```

```json
{
  "runtime": {
    "pyodide": {
      "indexURL": "/pyodide/"
    }
  }
}
```

### Package Installation

**Pre-built packages** (fastest):
```json
{
  "runtime": {
    "pyodide": {
      "packages": [
        "numpy",        // Scientific computing
        "scipy",        // Scientific algorithms  
        "matplotlib",   // Plotting
        "pandas",       // Data analysis
        "scikit-learn", // Machine learning
        "sympy",        // Symbolic math
        "networkx"      // Graph analysis
      ]
    }
  }
}
```

**Micropip packages** (pure Python):
```json
{
  "runtime": {
    "pyodide": {
      "micropip": [
        "requests",           // HTTP client
        "beautifulsoup4",     // HTML parsing
        "plotly",            // Interactive plots
        "seaborn",           // Statistical visualization
        "jupyter-widgets"    // Interactive widgets
      ]
    }
  }
}
```

## Data Visualization Examples

### Matplotlib Integration
```typescript
import { PyodideBridge } from 'tywrap/pyodide';
import { figure, plot, show } from './generated/matplotlib.generated.js';

const bridge = new PyodideBridge();
await bridge.init();

// Create a plot
const fig = await figure({ figsize: [10, 6] });
await plot([1, 2, 3, 4], [1, 4, 2, 3], 'ro-');
await show();

// Display in DOM element
const canvas = document.getElementById('plot-canvas');
// Matplotlib output will be rendered to canvas
```

### Interactive Data Analysis
```typescript
import { DataFrame, read_csv } from './generated/pandas.generated.js';
import { array, linspace, sin } from './generated/numpy.generated.js';

// Generate sample data
const x = await linspace(0, 10, 100);
const y = await sin(x);

// Create DataFrame
const df = await DataFrame({ x, y });
console.log(await df.head());

// Statistical analysis
console.log(await df.describe());
```

## Performance Considerations

### Loading Strategy
```typescript
// Lazy load Pyodide
const loadPyodide = async () => {
  if (!window.pyodideReady) {
    const bridge = new PyodideBridge();
    await bridge.init();
    window.pyodideReady = true;
  }
};

// Load on user interaction
document.getElementById('analyze-btn').addEventListener('click', async () => {
  await loadPyodide();
  // Now use Python libraries
});
```

### Package Bundling
```typescript
// Bundle commonly used packages
const essentialPackages = ['numpy', 'pandas', 'matplotlib'];
const advancedPackages = ['scipy', 'scikit-learn'];

// Load essential packages immediately
await bridge.loadPackages(essentialPackages);

// Load advanced packages on demand
const useAdvancedFeatures = async () => {
  await bridge.loadPackages(advancedPackages);
  // Advanced features now available
};
```

### Memory Management
```typescript
// Clean up large objects
await python.runCode(`
import gc
del large_dataframe
gc.collect()
`);

// Monitor memory usage
const memoryUsage = await python.runCode(`
import psutil
process = psutil.Process()
process.memory_info().rss / 1024 / 1024  # MB
`);
console.log(`Memory usage: ${memoryUsage} MB`);
```

## Build Integration

### Vite Configuration
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { tywrap } from 'tywrap/vite';

export default defineConfig({
  plugins: [
    tywrap({
      configFile: './tywrap.config.ts'
    })
  ],
  optimizeDeps: {
    exclude: ['pyodide']  // Don't bundle Pyodide
  },
  server: {
    headers: {
      // Enable SharedArrayBuffer for better performance
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
```

### Webpack Configuration
```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      "path": false,
      "fs": false,
      "crypto": false
    }
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.PYODIDE_BASE_URL': JSON.stringify('https://cdn.jsdelivr.net/pyodide/')
    })
  ]
};
```

## Interactive Applications

### Jupyter-like Notebook
```typescript
class NotebookCell {
  constructor(private bridge: PyodideBridge) {}
  
  async execute(code: string) {
    try {
      const result = await this.bridge.runCode(code);
      this.displayResult(result);
    } catch (error) {
      this.displayError(error);
    }
  }
  
  private displayResult(result: any) {
    const output = document.createElement('div');
    output.className = 'cell-output';
    output.textContent = JSON.stringify(result, null, 2);
    this.container.appendChild(output);
  }
}
```

### Real-time Data Dashboard
```typescript
class DataDashboard {
  constructor() {
    this.bridge = new PyodideBridge();
  }
  
  async init() {
    await this.bridge.init();
    await this.setupPlotting();
  }
  
  async updateChart(data: number[]) {
    // Use matplotlib to create chart
    await this.bridge.runCode(`
import matplotlib.pyplot as plt
import numpy as np

data = ${JSON.stringify(data)}
plt.figure(figsize=(10, 6))
plt.plot(data)
plt.title('Real-time Data')
plt.show()
    `);
  }
}
```

### Interactive Machine Learning
```typescript
import { train_test_split, LinearRegression } from './generated/sklearn.generated.js';
import { array } from './generated/numpy.generated.js';

class MLWorkbench {
  async trainModel(X: number[][], y: number[]) {
    // Convert to numpy arrays
    const X_array = await array(X);
    const y_array = await array(y);
    
    // Split data
    const [X_train, X_test, y_train, y_test] = await train_test_split(
      X_array, y_array, { test_size: 0.2, random_state: 42 }
    );
    
    // Train model
    const model = new LinearRegression();
    await model.fit(X_train, y_train);
    
    // Make predictions
    const predictions = await model.predict(X_test);
    return { predictions, y_test };
  }
}
```

## Error Handling

### Pyodide-Specific Errors
```typescript
try {
  await bridge.init();
} catch (error) {
  if (error.message.includes('WebAssembly')) {
    console.error('WebAssembly not supported');
    // Fallback to server-side processing
  } else if (error.message.includes('network')) {
    console.error('Failed to load Pyodide from CDN');
    // Try alternative CDN or show offline message
  }
}
```

### Package Loading Errors
```typescript
try {
  await bridge.loadPackages(['scipy']);
} catch (error) {
  console.error('Failed to load scipy:', error);
  // Disable features that require scipy
}
```

### Memory Errors
```typescript
try {
  const largeArray = await numpy.zeros([10000, 10000]);
} catch (error) {
  if (error.message.includes('memory')) {
    console.error('Out of memory - try smaller arrays');
    // Implement data chunking or streaming
  }
}
```

## Advanced Features

### Custom Python Modules
```python
# my_module.py - Place in your web server's static files
def custom_function(data):
    """Custom processing function"""
    return [x * 2 for x in data]

class CustomClass:
    def __init__(self, value):
        self.value = value
    
    def process(self):
        return self.value ** 2
```

```typescript
// Load custom module
await bridge.runCode(`
import sys
sys.path.append('/static/python/')  # Your static Python files
import my_module
`);

// Use custom functions
const result = await bridge.runCode(`
my_module.custom_function([1, 2, 3, 4])
`);
```

### File System Access
```typescript
// Upload files to Pyodide filesystem
const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  
  // Write to Pyodide filesystem
  await bridge.runCode(`
with open('${file.name}', 'wb') as f:
    f.write(${Array.from(new Uint8Array(arrayBuffer))})
  `);
  
  // Now use the file in Python
  await bridge.runCode(`
import pandas as pd
df = pd.read_csv('${file.name}')
print(df.head())
  `);
});
```

### Worker Integration
```typescript
// main.ts
const worker = new Worker('./pyodide-worker.js');

worker.postMessage({
  type: 'INIT',
  indexURL: 'https://cdn.jsdelivr.net/pyodide/'
});

worker.postMessage({
  type: 'RUN_CODE',
  code: 'import numpy as np; print(np.array([1,2,3]))'
});

// pyodide-worker.js
importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js');

let pyodide;

self.onmessage = async (event) => {
  const { type, ...data } = event.data;
  
  switch (type) {
    case 'INIT':
      pyodide = await loadPyodide({ indexURL: data.indexURL });
      break;
      
    case 'RUN_CODE':
      try {
        const result = await pyodide.runPython(data.code);
        self.postMessage({ type: 'RESULT', result });
      } catch (error) {
        self.postMessage({ type: 'ERROR', error: error.message });
      }
      break;
  }
};
```

## Deployment

### Static Site Deployment
```yaml
# netlify.toml
[build]
  command = "npm run build"
  publish = "dist"

[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
```

### CDN Optimization
```typescript
// Use multiple CDN fallbacks
const CDN_URLS = [
  'https://cdn.jsdelivr.net/pyodide/',
  'https://unpkg.com/pyodide/',
  '/pyodide/'  // Self-hosted fallback
];

async function loadPyodideWithFallback() {
  for (const url of CDN_URLS) {
    try {
      return new PyodideBridge({ indexURL: url });
    } catch (error) {
      console.warn(`Failed to load from ${url}:`, error);
    }
  }
  throw new Error('All Pyodide CDNs failed');
}
```

## Best Practices

### 1. Progressive Loading
```typescript
// Load core functionality first
await bridge.init();
await bridge.loadPackages(['numpy']);

// Load additional packages on demand
const loadVisualization = async () => {
  await bridge.loadPackages(['matplotlib']);
};

const loadMachineLearning = async () => {
  await bridge.loadPackages(['scikit-learn']);
};
```

### 2. Error Boundaries
```typescript
class PyodideErrorBoundary {
  static async safeExecute(fn: () => Promise<any>) {
    try {
      return await fn();
    } catch (error) {
      if (error.message.includes('WebAssembly')) {
        throw new Error('WebAssembly not supported in this browser');
      } else if (error.message.includes('memory')) {
        throw new Error('Insufficient memory for operation');
      }
      throw error;
    }
  }
}
```

### 3. Performance Monitoring
```typescript
class PyodideProfiler {
  static async profile(operation: string, fn: () => Promise<any>) {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      console.log(`${operation} completed in ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`${operation} failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }
}
```

## Next Steps

- [Configuration Guide](../configuration.md) - Complete configuration reference
- [Examples](../examples/README.md) - Usage examples and patterns
- [Troubleshooting](../troubleshooting/README.md) - Common issues and solutions
- [API Reference](../api/README.md) - Complete API documentation