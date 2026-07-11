import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { generate } from '../src/tywrap.js';
import { getDefaultPythonPath } from '../src/utils/python.js';

const pythonPath = getDefaultPythonPath();

function options(outputDir: string) {
  return {
    pythonModules: { math: { typeHints: 'strict' as const } },
    output: { dir: outputDir, format: 'esm' as const, declaration: false, sourceMap: false },
    runtime: { node: { pythonPath } },
    performance: { caching: false, batching: false, compression: 'none' as const },
  };
}

describe('pinned IR contracts', () => {
  it('writes stable sorted contracts and detects contract drift in check mode', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-'));
    try {
      const outputDir = join(tempDir, 'generated');
      const result = await generate(options(outputDir));
      const contractPath = result.written.find(path => path.endsWith('math.contract.json'));
      expect(contractPath).toBeDefined();

      const first = await readFile(contractPath as string, 'utf8');
      const parsed = JSON.parse(first) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(Object.keys(parsed).sort());
      expect(parsed).not.toHaveProperty('metadata');
      await generate(options(outputDir));
      expect(await readFile(contractPath as string, 'utf8')).toBe(first);

      await writeFile(contractPath as string, '{"drift":true}\n', 'utf8');
      const check = await generate(options(outputDir), { check: true });
      expect(check.outOfDate).toContain(contractPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('is byte-identical across Python processes with different hash seeds', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-seeds-'));
    const originalSeed = process.env.PYTHONHASHSEED;
    try {
      const seededOptions = (outputDir: string) => ({
        ...options(outputDir),
        pythonModules: { contract_determinism: { typeHints: 'strict' as const } },
        pythonImportPath: ['test/fixtures/python'],
      });

      process.env.PYTHONHASHSEED = '1';
      await generate(seededOptions(join(tempDir, 'seed-1')));
      process.env.PYTHONHASHSEED = '987654';
      await generate(seededOptions(join(tempDir, 'seed-2')));

      const first = await readFile(
        join(tempDir, 'seed-1', 'contract_determinism.contract.json'),
        'utf8'
      );
      const second = await readFile(
        join(tempDir, 'seed-2', 'contract_determinism.contract.json'),
        'utf8'
      );
      expect(second).toBe(first);
    } finally {
      if (originalSeed === undefined) {
        delete process.env.PYTHONHASHSEED;
      } else {
        process.env.PYTHONHASHSEED = originalSeed;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('generates from contractInput without spawning Python', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-input-'));
    try {
      const outputDir = join(tempDir, 'generated');
      const first = await generate(options(outputDir));
      const contractPath = first.written.find(path =>
        path.endsWith('math.contract.json')
      ) as string;
      const originalOutput = await readFile(join(outputDir, 'math.generated.ts'), 'utf8');

      const fromContract = await generate({
        ...options(outputDir),
        contractInput: contractPath,
        runtime: { node: { pythonPath: join(tempDir, 'python-must-not-run') } },
      });
      expect(fromContract.failures).toEqual([]);
      expect(await readFile(join(outputDir, 'math.generated.ts'), 'utf8')).toBe(originalOutput);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails clearly when Python IR reports a different schema version', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-version-'));
    try {
      const fakePython = join(tempDir, 'fake-python');
      await writeFile(
        fakePython,
        '#!/bin/sh\nprintf \'{"ir_version":"0.3.0","module":"math"}\\n\'\n',
        'utf8'
      );
      await chmod(fakePython, 0o755);

      const result = await generate({
        ...options(join(tempDir, 'generated')),
        runtime: { node: { pythonPath: fakePython } },
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          code: 'ir-version-mismatch',
          message: expect.stringContaining(
            'TypeScript expects 0.4.0, but Python IR for math declares 0.3.0'
          ),
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects same-version contracts with missing collection fields', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-shape-'));
    try {
      const contractPath = join(tempDir, 'malformed.contract.json');
      await writeFile(
        contractPath,
        JSON.stringify({ ir_version: '0.4.0', module: 'math', functions: [] }),
        'utf8'
      );
      const result = await generate({
        ...options(join(tempDir, 'generated')),
        contractInput: contractPath,
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          code: 'contract-invalid',
          message: expect.stringContaining('missing required array field classes'),
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
