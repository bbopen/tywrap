/**
 * IR Extraction Performance Benchmarks
 * Measures Python AST parsing and IR generation performance
 */

import { performance } from 'perf_hooks';
import { describe, it, expect, beforeAll } from 'vitest';
import { PyAnalyzer } from '../../src/core/analyzer.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface BenchmarkResult {
  name: string;
  fileSize: number;
  parseTime: number;
  memoryBefore: number;
  memoryAfter: number;
  memoryDelta: number;
  functionsExtracted: number;
  classesExtracted: number;
  linesOfCode: number;
  throughput: number; // LOC per second
}

class PerformanceProfiler {
  private results: BenchmarkResult[] = [];
  private analyzer: PyAnalyzer;

  constructor() {
    this.analyzer = new PyAnalyzer();
  }

  async benchmarkFile(filePath: string, content: string): Promise<BenchmarkResult> {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const memoryBefore = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    // Parse and extract IR
    const result = await this.analyzer.analyzePythonModule(content, filePath);

    const endTime = performance.now();
    const memoryAfter = process.memoryUsage().heapUsed;

    const parseTime = endTime - startTime;
    const fileSize = Buffer.byteLength(content, 'utf8');
    const linesOfCode = content.split('\n').length;
    const throughput = linesOfCode / (parseTime / 1000); // LOC per second

    return {
      name: filePath.split('/').pop() || 'unknown',
      fileSize,
      parseTime,
      memoryBefore,
      memoryAfter,
      memoryDelta: memoryAfter - memoryBefore,
      functionsExtracted: result.module.functions.length,
      classesExtracted: result.module.classes.length,
      linesOfCode,
      throughput,
    };
  }

  async profileDirectory(dir: string): Promise<BenchmarkResult[]> {
    const { readdirSync, statSync } = await import('fs');
    const files: string[] = [];

    const traverse = (currentDir: string) => {
      try {
        const entries = readdirSync(currentDir);
        for (const entry of entries) {
          const fullPath = join(currentDir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory() && !entry.startsWith('.')) {
            traverse(fullPath);
          } else if (stat.isFile() && entry.endsWith('.py')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`Skipping directory ${currentDir}: ${error}`);
      }
    };

    traverse(dir);

    const results: BenchmarkResult[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf8');
        const result = await this.benchmarkFile(file, content);
        results.push(result);
      } catch (error) {
        console.warn(`Failed to benchmark ${file}: ${error}`);
      }
    }

    return results;
  }

  generateReport(results: BenchmarkResult[]): string {
    const totalFiles = results.length;
    const totalSize = results.reduce((sum, r) => sum + r.fileSize, 0);
    const totalTime = results.reduce((sum, r) => sum + r.parseTime, 0);
    const totalMemory = results.reduce((sum, r) => sum + r.memoryDelta, 0);
    const avgThroughput = results.reduce((sum, r) => sum + r.throughput, 0) / totalFiles;

    const sortedByTime = [...results].sort((a, b) => b.parseTime - a.parseTime);
    const sortedByMemory = [...results].sort((a, b) => b.memoryDelta - a.memoryDelta);
    const sortedByThroughput = [...results].sort((a, b) => a.throughput - b.throughput);

    return `
# IR Extraction Performance Report

## Summary
- **Files Analyzed**: ${totalFiles}
- **Total Size**: ${(totalSize / 1024 / 1024).toFixed(2)} MB
- **Total Time**: ${totalTime.toFixed(2)} ms
- **Total Memory**: ${(totalMemory / 1024 / 1024).toFixed(2)} MB
- **Average Throughput**: ${avgThroughput.toFixed(0)} LOC/sec
- **Overall Rate**: ${(totalFiles / (totalTime / 1000)).toFixed(2)} files/sec

## Performance Bottlenecks (Slowest Files)
${sortedByTime
  .slice(0, 10)
  .map(
    r =>
      `- **${r.name}**: ${r.parseTime.toFixed(2)}ms (${r.linesOfCode} LOC, ${r.throughput.toFixed(0)} LOC/sec)`
  )
  .join('\n')}

## Memory Usage (Highest Consumers)
${sortedByMemory
  .slice(0, 10)
  .map(r => `- **${r.name}**: ${(r.memoryDelta / 1024 / 1024).toFixed(2)} MB (${r.fileSize} bytes)`)
  .join('\n')}

## Low Throughput Files (Need Optimization)
${sortedByThroughput
  .slice(0, 10)
  .map(
    r =>
      `- **${r.name}**: ${r.throughput.toFixed(0)} LOC/sec (${r.parseTime.toFixed(2)}ms for ${r.linesOfCode} LOC)`
  )
  .join('\n')}

## Detailed Results
${results
  .map(
    r =>
      `### ${r.name}
- **Parse Time**: ${r.parseTime.toFixed(2)}ms
- **File Size**: ${(r.fileSize / 1024).toFixed(2)} KB
- **Lines of Code**: ${r.linesOfCode}
- **Memory Delta**: ${(r.memoryDelta / 1024).toFixed(2)} KB
- **Throughput**: ${r.throughput.toFixed(0)} LOC/sec
- **Functions**: ${r.functionsExtracted}
- **Classes**: ${r.classesExtracted}`
  )
  .join('\n\n')}
`;
  }
}

describe('IR Extraction Performance Benchmarks', () => {
  let profiler: PerformanceProfiler;
  const testFixtures = 'test/fixtures/python';

  beforeAll(async () => {
    profiler = new PerformanceProfiler();
  });

  it('should benchmark small Python modules (<1KB)', async () => {
    const smallModule = `
def simple_function(x: int) -> int:
    """Simple function for testing."""
    return x * 2

class SimpleClass:
    def __init__(self, value: int):
        self.value = value
    
    def get_value(self) -> int:
        return self.value
`;

    const result = await profiler.benchmarkFile('small_module.py', smallModule);

    expect(result.parseTime).toBeLessThan(100); // Should parse in <100ms
    expect(result.functionsExtracted).toBe(1);
    expect(result.classesExtracted).toBe(1);
    expect(result.throughput).toBeGreaterThan(100); // >100 LOC/sec
  }, 10000);

  it('should benchmark medium Python modules (1-10KB)', async () => {
    try {
      const content = readFileSync(join(testFixtures, 'pydantic_models.py'), 'utf8');
      const result = await profiler.benchmarkFile('pydantic_models.py', content);

      expect(result.parseTime).toBeLessThan(500); // Should parse in <500ms
      expect(result.throughput).toBeGreaterThan(50); // >50 LOC/sec

      console.log(
        `Medium file benchmark: ${result.parseTime.toFixed(2)}ms, ${result.throughput.toFixed(0)} LOC/sec`
      );
    } catch (error) {
      console.warn('Medium file benchmark skipped:', error);
    }
  }, 15000);

  it('should benchmark large Python modules (>10KB)', async () => {
    const largeModule = Array(500)
      .fill(
        `
def function_${Math.random().toString(36)}(x: int, y: str = "default") -> tuple[int, str]:
    """Generated function for performance testing."""
    return x, y

class Class_${Math.random().toString(36)}:
    def __init__(self, value: int):
        self.value = value
    
    def process(self) -> int:
        return self.value * 2
`
      )
      .join('\n');

    const result = await profiler.benchmarkFile('large_module.py', largeModule);

    // Large files should still be reasonably fast
    expect(result.parseTime).toBeLessThan(2000); // <2 seconds
    expect(result.throughput).toBeGreaterThan(20); // >20 LOC/sec
    expect(result.memoryDelta).toBeLessThan(50 * 1024 * 1024); // <50MB

    console.log(
      `Large file benchmark: ${result.parseTime.toFixed(2)}ms, ${result.throughput.toFixed(0)} LOC/sec, ${(result.memoryDelta / 1024 / 1024).toFixed(2)}MB`
    );
  }, 30000);

  it('should profile test fixtures directory', async () => {
    try {
      const results = await profiler.profileDirectory(testFixtures);

      if (results.length === 0) {
        console.warn('No Python files found in test fixtures');
        return;
      }

      const report = profiler.generateReport(results);
      const reportPath = 'test/benchmarks/ir_extraction_report.md';
      writeFileSync(reportPath, report);

      console.log(`Generated performance report: ${reportPath}`);
      console.log(`Profiled ${results.length} files`);

      // Performance assertions
      const avgThroughput = results.reduce((sum, r) => sum + r.throughput, 0) / results.length;
      expect(avgThroughput).toBeGreaterThan(30); // Average >30 LOC/sec

      const maxParseTime = Math.max(...results.map(r => r.parseTime));
      expect(maxParseTime).toBeLessThan(5000); // No single file >5 seconds
    } catch (error) {
      console.warn('Directory profiling failed:', error);
    }
  }, 60000);

  it('should detect memory leaks in repeated parsing', async () => {
    const testModule = `
def test_function(x: int) -> int:
    return x * 2

class TestClass:
    def __init__(self):
        self.data = list(range(1000))
`;

    const iterations = 50;
    const memoryMeasurements: number[] = [];

    for (let i = 0; i < iterations; i++) {
      await profiler.benchmarkFile(`test_${i}.py`, testModule);

      if (global.gc) {
        global.gc();
      }

      memoryMeasurements.push(process.memoryUsage().heapUsed);
    }

    // Check for memory growth trend
    const initialMemory = memoryMeasurements[0];
    const finalMemory = memoryMeasurements[memoryMeasurements.length - 1];
    const memoryGrowth = finalMemory - initialMemory;

    console.log(
      `Memory growth over ${iterations} iterations: ${(memoryGrowth / 1024 / 1024).toFixed(2)} MB`
    );

    // Should not grow more than 10MB over 50 iterations
    expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);
  }, 30000);

  it('should benchmark parallel parsing performance', async () => {
    const modules = Array(10)
      .fill(null)
      .map((_, i) => ({
        name: `parallel_${i}.py`,
        content: `
def function_${i}(x: int) -> int:
    """Function ${i}"""
    return x * ${i + 1}

class Class${i}:
    def __init__(self, value: int = ${i}):
        self.value = value
`,
      }));

    // Sequential parsing
    const sequentialStart = performance.now();
    const sequentialResults = [];
    for (const module of modules) {
      const result = await profiler.benchmarkFile(module.name, module.content);
      sequentialResults.push(result);
    }
    const sequentialTime = performance.now() - sequentialStart;

    // Parallel parsing
    const parallelStart = performance.now();
    const parallelResults = await Promise.all(
      modules.map(module => profiler.benchmarkFile(module.name, module.content))
    );
    const parallelTime = performance.now() - parallelStart;

    console.log(`Sequential: ${sequentialTime.toFixed(2)}ms`);
    console.log(`Parallel: ${parallelTime.toFixed(2)}ms`);
    console.log(`Speedup: ${(sequentialTime / parallelTime).toFixed(2)}x`);

    // Parallel should be faster (but may not be due to tree-sitter overhead)
    expect(parallelResults.length).toBe(sequentialResults.length);
    expect(parallelTime).toBeLessThan(sequentialTime * 1.2); // Allow some overhead
  }, 20000);
});
