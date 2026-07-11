import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate } from '../../src/tywrap.js';
import { processUtils, fsUtils } from '../../src/utils/runtime.js';
import { getDefaultPythonPath } from '../../src/utils/python.js';
import { TIER_ONE_MODULES } from './manifest.js';

const defaultPythonPath = getDefaultPythonPath();
const fixtureImportPath = 'test/menagerie';

async function compileGeneratedFile(generatedPath: string): Promise<void> {
  const tscPath = join(process.cwd(), 'node_modules', 'typescript', 'lib', 'tsc.js');
  const compile = await processUtils.exec(
    process.execPath,
    [
      tscPath,
      '--ignoreConfig',
      '--noEmit',
      '--pretty',
      'false',
      '--target',
      'ES2022',
      '--lib',
      'ES2022,DOM,DOM.Iterable',
      '--module',
      'ESNext',
      '--moduleResolution',
      'bundler',
      '--skipLibCheck',
      generatedPath,
    ],
    { cwd: process.cwd(), timeoutMs: 30_000 }
  );

  expect(compile.code).toBe(0);
  expect(compile.stderr).toBe('');
}

describe('menagerie generation gate', () => {
  it.each(TIER_ONE_MODULES)(
    'generates and typechecks %s',
    async moduleName => {
      // Generated modules import `tywrap/runtime`; keep output below this package
      // so TypeScript resolves the self-reference through package.json exports.
      const tempDir = await mkdtemp(join(process.cwd(), '.tmp-menagerie-generate-'));
      try {
        const outputDir = join(tempDir, 'generated');
        const result = await generate({
          pythonModules: { [moduleName]: { runtime: 'node', typeHints: 'strict' } },
          pythonImportPath: [fixtureImportPath],
          output: { dir: outputDir, format: 'esm', declaration: true, sourceMap: false },
          runtime: { node: { pythonPath: defaultPythonPath } },
          performance: { caching: false, batching: false, compression: 'none' },
        } as never);

        expect(result.failures).toEqual([]);
        const generatedTs = result.written.find(path => path.endsWith('.generated.ts'));
        const generatedDeclaration = result.written.find(path => path.endsWith('.generated.d.ts'));
        expect(generatedTs).toBeDefined();
        expect(generatedDeclaration).toBeDefined();

        await expect(
          Promise.all([
            fsUtils.readFile(generatedTs as string),
            fsUtils.readFile(generatedDeclaration as string),
          ])
        ).resolves.toMatchSnapshot();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    30_000
  );

  // FIXME(#267): map Decimal and complex to declared TypeScript types.
  it.fails(
    'typechecks the generated plain-values fixture',
    async () => {
      const tempDir = await mkdtemp(join(process.cwd(), '.tmp-menagerie-values-'));
      try {
        const outputDir = join(tempDir, 'generated');
        const result = await generate({
          pythonModules: { 'fixtures.values_torture': { runtime: 'node', typeHints: 'strict' } },
          pythonImportPath: [fixtureImportPath],
          output: { dir: outputDir, format: 'esm', declaration: true, sourceMap: false },
          runtime: { node: { pythonPath: defaultPythonPath } },
          performance: { caching: false, batching: false, compression: 'none' },
        } as never);
        const generatedTs = result.written.find(path => path.endsWith('.generated.ts'));
        expect(generatedTs).toBeDefined();
        await compileGeneratedFile(generatedTs as string);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    30_000
  );

  // FIXME(#267): preserve NewType declarations or map their use-sites to a declared TS alias.
  it.fails(
    'typechecks the generated NewType fixture',
    async () => {
      const tempDir = await mkdtemp(join(process.cwd(), '.tmp-menagerie-newtype-'));
      try {
        const outputDir = join(tempDir, 'generated');
        const result = await generate({
          pythonModules: { 'fixtures.typing_torture': { runtime: 'node', typeHints: 'strict' } },
          pythonImportPath: [fixtureImportPath],
          output: { dir: outputDir, format: 'esm', declaration: true, sourceMap: false },
          runtime: { node: { pythonPath: defaultPythonPath } },
          performance: { caching: false, batching: false, compression: 'none' },
        } as never);
        const generatedTs = result.written.find(path => path.endsWith('.generated.ts'));
        expect(generatedTs).toBeDefined();
        await compileGeneratedFile(generatedTs as string);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    30_000
  );
});
