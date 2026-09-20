import { execFile } from 'node:child_process';
import { delimiter, basename, join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { generate } from '../../src/tywrap.js';
import { hasPythonModule, PYTHON, PYTHON_AVAILABLE } from '../helpers/python-probe.js';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const fixtureRoot = join(repoRoot, 'test', 'menagerie');
const required = process.env.TYWRAP_REQUIRE_TORCH_CONFORMANCE === '1';
const available = PYTHON_AVAILABLE && hasPythonModule('torch') && hasPythonModule('pyarrow');

async function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  try {
    return await execFileAsync(command, args, {
      cwd,
      env,
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const result = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.stderr ?? result.stdout ?? result.message ?? 'unknown error'}`
    );
  }
}

describe('real Torch generated callable', () => {
  it.skipIf(!required && !available)(
    'analyzes, typechecks, executes, and rejects a wrong CPU float16 return',
    async () => {
      if (!available || !PYTHON) {
        throw new Error('The required scientific CI job needs Python, Torch, and PyArrow');
      }
      const tempRoot = await mkdtemp(join(repoRoot, '.tmp-menagerie-torch-'));
      const pythonEnv = {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${fixtureRoot}${delimiter}${process.env.PYTHONPATH}`
          : fixtureRoot,
      };
      try {
        const analyzed = await run(
          PYTHON,
          [
            '-c',
            'import json; from tywrap_ir.ir import extract_module_ir; ir=extract_module_ir("fixtures.torch_callable"); print(json.dumps({"functions": [{"name": f["name"], "returns": f["returns"]} for f in ir["functions"]], "warnings": ir["warnings"]}))',
          ],
          repoRoot,
          pythonEnv
        );
        const ir = JSON.parse(analyzed.stdout) as {
          functions: { name: string; returns: string }[];
          warnings: string[];
        };
        expect(ir.functions).toEqual([
          { name: 'half_values', returns: 'torch.HalfTensor' },
          { name: 'wrong_half_values', returns: 'torch.HalfTensor' },
        ]);
        expect(ir.warnings).toEqual([
          'Return annotation for fixtures.torch_callable.half_values resolves outside analyzed module: torch.HalfTensor.',
          'Return annotation for fixtures.torch_callable.wrong_half_values resolves outside analyzed module: torch.HalfTensor.',
        ]);

        const generatedDir = join(tempRoot, 'generated');
        const generated = await generate({
          pythonModules: {
            'fixtures.torch_callable': { runtime: 'node', typeHints: 'strict' },
          },
          pythonImportPath: [fixtureRoot],
          output: { dir: generatedDir, format: 'esm', declaration: true, sourceMap: false },
          runtime: { node: { pythonPath: PYTHON } },
          performance: { caching: false, batching: false, compression: 'none' },
        } as never);
        expect(generated.failures).toEqual([]);
        expect(generated.warnings).toEqual([]);
        const generatedTs = generated.written.find(path => path.endsWith('.generated.ts'));
        expect(generatedTs).toBeDefined();
        const source = await readFile(generatedTs as string, 'utf8');
        expect(source).toContain('"marker":"torch.tensor","dtype":"torch.float16"');

        const generatedJs = basename(generatedTs as string).replace(/\.ts$/, '.js');
        const typecheckPath = join(tempRoot, 'torch.typecheck.ts');
        await writeFile(
          typecheckPath,
          `import { halfValues, wrongHalfValues } from './generated/${generatedJs}';
type Float16Value = number | Float16Value[];
type Float16Tensor = { data: Float16Value; shape: number[]; dtype: 'torch.float16'; device?: string };
const good: Promise<Float16Tensor> = halfValues();
const declaredWrong: Promise<Float16Tensor> = wrongHalfValues();
type GeneratedTensor = Awaited<ReturnType<typeof halfValues>>;
const dtype: GeneratedTensor['dtype'] = 'torch.float16';
// @ts-expect-error A float32 dtype cannot satisfy the generated return type.
const wrongDtype: GeneratedTensor['dtype'] = 'torch.float32';
void good;
void declaredWrong;
void dtype;
void wrongDtype;
`,
          'utf8'
        );
        await run(
          process.execPath,
          [
            join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js'),
            '--ignoreConfig',
            '--target',
            'ES2022',
            '--module',
            'NodeNext',
            '--moduleResolution',
            'NodeNext',
            '--strict',
            '--skipLibCheck',
            '--rootDir',
            tempRoot,
            '--outDir',
            join(tempRoot, 'built'),
            generatedTs as string,
            typecheckPath,
          ],
          repoRoot
        );

        const runnerPath = join(tempRoot, 'run-torch.mjs');
        await writeFile(
          runnerPath,
          `import { BridgeValidationError } from 'tywrap';
import { NodeBridge } from 'tywrap/node';
import { clearRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';
import * as fixture from './built/generated/${generatedJs}';

const [pythonPath, fixtureRoot] = process.argv.slice(2);
const bridge = new NodeBridge({
  pythonPath,
  cwd: process.cwd(),
  env: {
    PYTHONNOUSERSITE: '1',
    PYTHONPATH: fixtureRoot,
    TYWRAP_ALLOWED_MODULES: 'fixtures.torch_callable',
  },
});
try {
  setRuntimeBridge({ call: bridge.call.bind(bridge), dispose: bridge.dispose.bind(bridge) });
  const value = await fixture.halfValues();
  if (value.dtype !== 'torch.float16' || value.device !== 'cpu' ||
      JSON.stringify(value.shape) !== '[3]' ||
      JSON.stringify(value.data) !== '[1.5,-2.25,0]' ||
      !Object.is(value.data[2], -0)) {
    throw new Error('The generated Torch wrapper did not return CPU float16 values');
  }
  let wrongError;
  try {
    await fixture.wrongHalfValues();
  } catch (error) {
    wrongError = error;
  }
  if (!(wrongError instanceof BridgeValidationError) ||
      wrongError.callSite !== 'fixtures.torch_callable.wrong_half_values') {
    throw new Error('The generated return validator accepted a float32 tensor');
  }
  process.stdout.write(JSON.stringify({
    dtype: value.dtype,
    shape: value.shape,
    data: value.data,
    device: value.device,
    negativeZero: Object.is(value.data[2], -0),
    wrongError: wrongError.name,
  }));
} finally {
  clearRuntimeBridge();
  await bridge.dispose();
}
`,
          'utf8'
        );
        const execution = await run(process.execPath, [runnerPath, PYTHON, fixtureRoot], repoRoot);
        expect(JSON.parse(execution.stdout)).toEqual({
          dtype: 'torch.float16',
          shape: [3],
          data: [1.5, -2.25, 0],
          device: 'cpu',
          negativeZero: true,
          wrongError: 'BridgeValidationError',
        });
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
    120_000
  );
});
