/**
 * Code Generation Performance Benchmarks
 * Measures TypeScript wrapper generation performance and memory usage
 */

import { performance } from 'perf_hooks';
import { describe, it, expect, beforeAll } from 'vitest';
import { CodeGenerator } from '../../src/core/generator.js';
import { PyAnalyzer } from '../../src/core/analyzer.js';
import { writeFileSync } from 'fs';
import type { PythonModule, AnalysisResult } from '../../src/types/index.js';

interface CodegenBenchmarkResult {
  name: string;
  inputSize: {
    functions: number;
    classes: number;
    linesOfCode: number;
    complexity: number;
  };
  performance: {
    analysisTime: number;
    generationTime: number;
    totalTime: number;
    memoryBefore: number;
    memoryAfter: number;
    memoryDelta: number;
  };
  output: {
    generatedLines: number;
    generatedSize: number;
    compressionRatio: number; // output size / input size
  };
  throughput: {
    functionsPerSecond: number;
    classesPerSecond: number;
    linesPerSecond: number;
  };
}

class CodegenProfiler {
  private analyzer: PyAnalyzer;
  private generator: CodeGenerator;
  private results: CodegenBenchmarkResult[] = [];

  constructor() {
    this.analyzer = new PyAnalyzer();
    this.generator = new CodeGenerator();
  }

  async benchmarkCodeGeneration(
    pythonCode: string,
    moduleName: string
  ): Promise<CodegenBenchmarkResult> {
    // Force garbage collection
    if (global.gc) {
      global.gc();
    }

    const memoryBefore = process.memoryUsage().heapUsed;

    // Phase 1: Analysis
    const analysisStart = performance.now();
    const analysisResult: AnalysisResult = await this.analyzer.analyzePythonModule(
      pythonCode,
      `${moduleName}.py`
    );
    const analysisTime = performance.now() - analysisStart;

    // Phase 2: Code Generation
    const generationStart = performance.now();
    const generated = await this.generator.generateModule(
      analysisResult.module,
      { moduleName, exportAll: true }
    );
    const generationTime = performance.now() - generationStart;

    const memoryAfter = process.memoryUsage().heapUsed;
    const totalTime = analysisTime + generationTime;

    // Calculate metrics
    const inputLines = pythonCode.split('\n').length;
    const outputLines = generated.code.split('\n').length;
    const outputSize = Buffer.byteLength(generated.code, 'utf8');
    const inputSize = Buffer.byteLength(pythonCode, 'utf8');

    const functions = analysisResult.module.functions.length;
    const classes = analysisResult.module.classes.length;
    const complexity = analysisResult.statistics?.estimatedComplexity || 0;

    return {
      name: moduleName,
      inputSize: {
        functions,
        classes,
        linesOfCode: inputLines,
        complexity
      },
      performance: {
        analysisTime,
        generationTime,
        totalTime,
        memoryBefore,
        memoryAfter,
        memoryDelta: memoryAfter - memoryBefore
      },
      output: {
        generatedLines: outputLines,
        generatedSize: outputSize,
        compressionRatio: outputSize / inputSize
      },
      throughput: {
        functionsPerSecond: functions / (totalTime / 1000),
        classesPerSecond: classes / (totalTime / 1000),
        linesPerSecond: inputLines / (totalTime / 1000)
      }
    };
  }

  generateReport(results: CodegenBenchmarkResult[]): string {
    const totalResults = results.length;
    const totalTime = results.reduce((sum, r) => sum + r.performance.totalTime, 0);
    const totalMemory = results.reduce((sum, r) => sum + r.performance.memoryDelta, 0);
    const totalFunctions = results.reduce((sum, r) => sum + r.inputSize.functions, 0);
    const totalClasses = results.reduce((sum, r) => sum + r.inputSize.classes, 0);

    const avgThroughput = results.reduce((sum, r) => sum + r.throughput.linesPerSecond, 0) / totalResults;

    const sortedByTime = [...results].sort((a, b) => b.performance.totalTime - a.performance.totalTime);
    const sortedByMemory = [...results].sort((a, b) => b.performance.memoryDelta - a.performance.memoryDelta);

    return `
# Code Generation Performance Report

## Summary
- **Modules Processed**: ${totalResults}
- **Total Functions**: ${totalFunctions}
- **Total Classes**: ${totalClasses}
- **Total Time**: ${totalTime.toFixed(2)} ms
- **Total Memory**: ${(totalMemory / 1024 / 1024).toFixed(2)} MB
- **Average Throughput**: ${avgThroughput.toFixed(0)} lines/sec
- **Overall Rate**: ${(totalResults / (totalTime / 1000)).toFixed(2)} modules/sec

## Performance Bottlenecks (Slowest Modules)
${sortedByTime.slice(0, 5).map(r => 
  `- **${r.name}**: ${r.performance.totalTime.toFixed(2)}ms
    - Analysis: ${r.performance.analysisTime.toFixed(2)}ms
    - Generation: ${r.performance.generationTime.toFixed(2)}ms
    - Throughput: ${r.throughput.linesPerSecond.toFixed(0)} lines/sec`
).join('\n')}

## Memory Usage (Highest Consumers)
${sortedByMemory.slice(0, 5).map(r => 
  `- **${r.name}**: ${(r.performance.memoryDelta / 1024 / 1024).toFixed(2)} MB
    - Input: ${r.inputSize.functions} functions, ${r.inputSize.classes} classes
    - Output: ${(r.output.generatedSize / 1024).toFixed(2)} KB
    - Compression: ${r.output.compressionRatio.toFixed(2)}x`
).join('\n')}

## Detailed Performance Metrics
| Module | Analysis (ms) | Generation (ms) | Total (ms) | Memory (KB) | Lines/sec | Compression |
|--------|---------------|-----------------|------------|-------------|-----------|-------------|
${results.map(r => 
  `| ${r.name} | ${r.performance.analysisTime.toFixed(1)} | ${r.performance.generationTime.toFixed(1)} | ${r.performance.totalTime.toFixed(1)} | ${(r.performance.memoryDelta / 1024).toFixed(1)} | ${r.throughput.linesPerSecond.toFixed(0)} | ${r.output.compressionRatio.toFixed(2)}x |`
).join('\n')}

## Phase Analysis
- **Average Analysis Time**: ${(results.reduce((sum, r) => sum + r.performance.analysisTime, 0) / totalResults).toFixed(2)} ms
- **Average Generation Time**: ${(results.reduce((sum, r) => sum + r.performance.generationTime, 0) / totalResults).toFixed(2)} ms
- **Analysis vs Generation Ratio**: ${(results.reduce((sum, r) => sum + r.performance.analysisTime, 0) / results.reduce((sum, r) => sum + r.performance.generationTime, 0)).toFixed(2)}:1
`;
  }
}

describe('Code Generation Performance Benchmarks', () => {
  let profiler: CodegenProfiler;

  beforeAll(async () => {
    profiler = new CodegenProfiler();
  });

  it('should benchmark simple module generation', async () => {
    const simpleModule = `
def add(x: int, y: int) -> int:
    """Add two integers."""
    return x + y

def multiply(x: float, y: float) -> float:
    """Multiply two floats."""
    return x * y

class Calculator:
    def __init__(self):
        self.history = []
    
    def calculate(self, operation: str, a: float, b: float) -> float:
        if operation == "add":
            result = a + b
        elif operation == "multiply":
            result = a * b
        else:
            raise ValueError("Unknown operation")
        
        self.history.append((operation, a, b, result))
        return result
`;

    const result = await profiler.benchmarkCodeGeneration(simpleModule, 'simple_calculator');
    
    expect(result.performance.totalTime).toBeLessThan(1000); // <1 second
    expect(result.throughput.linesPerSecond).toBeGreaterThan(20); // >20 lines/sec
    expect(result.inputSize.functions).toBe(2);
    expect(result.inputSize.classes).toBe(1);
    
    console.log(`Simple module: ${result.performance.totalTime.toFixed(2)}ms, ${result.throughput.linesPerSecond.toFixed(0)} lines/sec`);
  });

  it('should benchmark complex module with many functions', async () => {
    const complexModule = Array(50).fill(null).map((_, i) => `
def function_${i}(
    x: int = ${i},
    y: str = "default_${i}",
    z: list[float] = None
) -> dict[str, any]:
    """Function ${i} documentation."""
    if z is None:
        z = []
    return {
        "id": ${i},
        "x": x,
        "y": y,
        "z": z,
        "computed": x * ${i + 1}
    }
`).join('\n');

    const result = await profiler.benchmarkCodeGeneration(complexModule, 'complex_functions');
    
    expect(result.performance.totalTime).toBeLessThan(5000); // <5 seconds
    expect(result.throughput.functionsPerSecond).toBeGreaterThan(10); // >10 functions/sec
    expect(result.inputSize.functions).toBe(50);
    
    console.log(`Complex module: ${result.performance.totalTime.toFixed(2)}ms, ${result.throughput.functionsPerSecond.toFixed(1)} functions/sec`);
  });

  it('should benchmark class-heavy module', async () => {
    const classHeavyModule = Array(20).fill(null).map((_, i) => `
class DataModel${i}:
    """Data model ${i}."""
    
    def __init__(self, id: int = ${i}):
        self.id = id
        self.data: dict[str, any] = {}
    
    def get_data(self) -> dict[str, any]:
        return self.data
    
    def set_data(self, key: str, value: any) -> None:
        self.data[key] = value
    
    def process(self) -> dict[str, any]:
        return {
            "id": self.id,
            "processed": True,
            "data_keys": list(self.data.keys())
        }
    
    @property
    def is_empty(self) -> bool:
        return len(self.data) == 0
`).join('\n');

    const result = await profiler.benchmarkCodeGeneration(classHeavyModule, 'class_heavy');
    
    expect(result.performance.totalTime).toBeLessThan(10000); // <10 seconds
    expect(result.throughput.classesPerSecond).toBeGreaterThan(2); // >2 classes/sec
    expect(result.inputSize.classes).toBe(20);
    
    console.log(`Class-heavy module: ${result.performance.totalTime.toFixed(2)}ms, ${result.throughput.classesPerSecond.toFixed(1)} classes/sec`);
  });

  it('should benchmark generation phase vs analysis phase', async () => {
    const balancedModule = `
# Mixed complexity module
def simple_function(x: int) -> int:
    return x * 2

def complex_function(
    data: dict[str, list[int]],
    callback: callable[[int], str] = None
) -> dict[str, list[str]]:
    """Complex function with nested types."""
    result = {}
    for key, values in data.items():
        if callback:
            result[key] = [callback(v) for v in values]
        else:
            result[key] = [str(v) for v in values]
    return result

class SimpleClass:
    def __init__(self, value: int):
        self.value = value

class ComplexClass:
    """Complex class with various method types."""
    
    def __init__(self, config: dict[str, any] = None):
        self.config = config or {}
        self._cache = {}
    
    def sync_method(self, x: int, y: str) -> tuple[int, str]:
        return x, y
    
    async def async_method(self, data: list[dict[str, any]]) -> list[str]:
        return [str(item) for item in data]
    
    @property
    def cache_size(self) -> int:
        return len(self._cache)
    
    def __str__(self) -> str:
        return f"ComplexClass(config={self.config})"
`;

    const result = await profiler.benchmarkCodeGeneration(balancedModule, 'balanced_complexity');
    
    const analysisRatio = result.performance.analysisTime / result.performance.totalTime;
    const generationRatio = result.performance.generationTime / result.performance.totalTime;
    
    console.log(`Phase breakdown - Analysis: ${(analysisRatio * 100).toFixed(1)}%, Generation: ${(generationRatio * 100).toFixed(1)}%`);
    
    // Neither phase should dominate too heavily
    expect(analysisRatio).toBeGreaterThan(0.1); // Analysis >10%
    expect(analysisRatio).toBeLessThan(0.9); // Analysis <90%
    expect(generationRatio).toBeGreaterThan(0.1); // Generation >10%
    expect(generationRatio).toBeLessThan(0.9); // Generation <90%
  });

  it('should detect memory leaks in repeated generation', async () => {
    const testModule = `
def test_function(x: int) -> int:
    return x * 2

class TestClass:
    def __init__(self, data: list[int] = None):
        self.data = data or list(range(100))
    
    def process(self) -> list[int]:
        return [x * 2 for x in self.data]
`;

    const iterations = 20;
    const memoryMeasurements: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      await profiler.benchmarkCodeGeneration(testModule, `leak_test_${i}`);
      
      if (global.gc) {
        global.gc();
      }
      
      memoryMeasurements.push(process.memoryUsage().heapUsed);
    }
    
    const initialMemory = memoryMeasurements[0];
    const finalMemory = memoryMeasurements[memoryMeasurements.length - 1];
    const memoryGrowth = finalMemory - initialMemory;
    
    console.log(`Memory growth over ${iterations} iterations: ${(memoryGrowth / 1024 / 1024).toFixed(2)} MB`);
    
    // Should not grow more than 20MB over 20 iterations
    expect(memoryGrowth).toBeLessThan(20 * 1024 * 1024);
  });

  it('should benchmark parallel code generation', async () => {
    const modules = Array(8).fill(null).map((_, i) => ({
      name: `parallel_${i}`,
      code: `
def function_${i}_a(x: int) -> int:
    return x + ${i}

def function_${i}_b(x: str) -> str:
    return f"{x}_{i}"

class Class${i}:
    def __init__(self, value: int = ${i}):
        self.value = value
    
    def get_value(self) -> int:
        return self.value + ${i}
`
    }));

    // Sequential generation
    const sequentialStart = performance.now();
    for (const module of modules) {
      await profiler.benchmarkCodeGeneration(module.code, module.name);
    }
    const sequentialTime = performance.now() - sequentialStart;

    // Parallel generation
    const parallelStart = performance.now();
    await Promise.all(
      modules.map(module => 
        profiler.benchmarkCodeGeneration(module.code, `${module.name}_parallel`)
      )
    );
    const parallelTime = performance.now() - parallelStart;

    console.log(`Sequential: ${sequentialTime.toFixed(2)}ms`);
    console.log(`Parallel: ${parallelTime.toFixed(2)}ms`);
    console.log(`Speedup: ${(sequentialTime / parallelTime).toFixed(2)}x`);

    // Parallel should provide some speedup
    expect(parallelTime).toBeLessThan(sequentialTime);
  });

  it('should generate comprehensive performance report', async () => {
    const testCases = [
      { name: 'tiny', code: 'def tiny(): pass' },
      { name: 'small', code: 'def small(x: int) -> int:\n    return x * 2' },
      { 
        name: 'medium', 
        code: Array(10).fill(null).map((_, i) => `def func_${i}(x: int = ${i}) -> int:\n    return x + ${i}`).join('\n')
      },
      {
        name: 'large',
        code: Array(25).fill(null).map((_, i) => `
class Class${i}:
    def __init__(self, x: int = ${i}):
        self.x = x
    
    def method_${i}(self, y: str) -> str:
        return f"{self.x}_{y}_{i}"
`).join('\n')
      }
    ];

    const results: CodegenBenchmarkResult[] = [];
    
    for (const testCase of testCases) {
      const result = await profiler.benchmarkCodeGeneration(testCase.code, testCase.name);
      results.push(result);
    }
    
    const report = profiler.generateReport(results);
    const reportPath = 'test/benchmarks/code_generation_report.md';
    writeFileSync(reportPath, report);
    
    console.log(`Generated performance report: ${reportPath}`);
    
    // Validate performance trends
    expect(results.length).toBe(4);
    
    // Larger modules should take more time but maintain reasonable throughput
    const largeResult = results.find(r => r.name === 'large');
    const tinyResult = results.find(r => r.name === 'tiny');
    
    if (largeResult && tinyResult) {
      expect(largeResult.performance.totalTime).toBeGreaterThan(tinyResult.performance.totalTime);
      expect(largeResult.throughput.linesPerSecond).toBeGreaterThan(5); // Minimum throughput
    }
  });
});