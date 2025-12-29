import { describe, it, expect } from 'vitest';
import { processUtils } from '../src/utils/runtime.js';

function sanitizeIr(ir: any) {
  // Filter to only stable math functions that exist across Python versions
  const stableMathFunctions = [
    'acos',
    'asin',
    'atan',
    'atan2',
    'ceil',
    'cos',
    'degrees',
    'exp',
    'fabs',
    'floor',
    'fmod',
    'frexp',
    'log',
    'log10',
    'pow',
    'radians',
    'sin',
    'sqrt',
    'tan',
    'trunc',
  ];

  const functionNames = (ir.functions ?? [])
    .map((f: any) => f.name)
    .filter((name: string) => stableMathFunctions.includes(name))
    .sort();

  return {
    module: ir.module,
    functionNames,
    classNames: (ir.classes ?? []).map((c: any) => c.name).sort(),
    // Omit metadata and docstrings from snapshot for stability
  };
}

describe('IR golden snapshot - math', () => {
  it('matches sanitized snapshot', async () => {
    const result = await processUtils.exec('python3', [
      '-m',
      'tywrap_ir',
      '--module',
      'math',
      '--no-pretty',
    ]);
    expect(result.code).toBe(0);
    const ir = JSON.parse(result.stdout);
    expect(sanitizeIr(ir)).toMatchSnapshot();
  });
});
