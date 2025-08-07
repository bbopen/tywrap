import { describe, it, expect } from 'vitest';
import { processUtils } from '../src/utils/runtime.js';

function sanitizeIr(ir: any) {
  return {
    module: ir.module,
    functionNames: (ir.functions ?? [])
      .map((f: any) => f.name)
      .sort()
      .slice(0, 30),
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
