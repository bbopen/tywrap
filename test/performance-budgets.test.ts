import { describe, it, expect } from 'vitest';
import { CodeGenerator } from '../src/core/generator.js';
import type {
  PythonClass,
  PythonFunction,
  PythonModule,
  Parameter,
  PythonType,
} from '../src/types/index.js';
import { isNodejs } from '../src/utils/runtime.js';

const shouldRun = isNodejs() && (process.env.CI || process.env.TYWRAP_PERF_BUDGETS === '1');
const describeBudget = shouldRun ? describe : describe.skip;

function primitiveType(name: 'int' | 'str' | 'bool' | 'float' | 'bytes' | 'None'): PythonType {
  return { kind: 'primitive', name };
}

function makeParam(name: string, type: PythonType): Parameter {
  return {
    name,
    type,
    optional: false,
    varArgs: false,
    kwArgs: false,
  };
}

function makeFunction(name: string): PythonFunction {
  const params = [makeParam('a', primitiveType('int')), makeParam('b', primitiveType('int'))];
  return {
    name,
    signature: {
      parameters: params,
      returnType: primitiveType('int'),
      isAsync: false,
      isGenerator: false,
    },
    docstring: undefined,
    decorators: [],
    isAsync: false,
    isGenerator: false,
    returnType: primitiveType('int'),
    parameters: params,
  };
}

function makeClass(name: string, methodCount: number): PythonClass {
  const methods = Array.from({ length: methodCount }, (_, idx) => makeFunction(`method_${idx}`));
  return {
    name,
    bases: [],
    methods,
    properties: [],
    docstring: undefined,
    decorators: [],
    kind: 'class',
  };
}

function buildModule(): PythonModule {
  const functions = Array.from({ length: 25 }, (_, idx) => makeFunction(`func_${idx}`));
  const classes = Array.from({ length: 5 }, (_, idx) => makeClass(`Class${idx}`, 5));
  return {
    name: 'perf_module',
    path: undefined,
    version: undefined,
    functions,
    classes,
    imports: [],
    exports: [],
  };
}

describeBudget('Performance budgets', () => {
  it('generates a medium module within time and memory budgets', () => {
    const timeBudgetMs = Number(process.env.TYWRAP_PERF_TIME_BUDGET_MS ?? '2000');
    const memoryBudgetMb = Number(process.env.TYWRAP_PERF_MEMORY_BUDGET_MB ?? '64');

    if (global.gc) {
      global.gc();
    }

    const generator = new CodeGenerator();
    const module = buildModule();
    const startMem = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    const result = generator.generateModuleDefinition(module, false);

    const duration = performance.now() - startTime;
    if (global.gc) {
      global.gc();
    }
    const endMem = process.memoryUsage().heapUsed;
    const deltaMem = endMem - startMem;

    expect(result.typescript.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(timeBudgetMs);
    expect(deltaMem).toBeLessThan(memoryBudgetMb * 1024 * 1024);
  });
});
