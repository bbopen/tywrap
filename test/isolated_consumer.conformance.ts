import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd());
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const tempRoot = mkdtempSync(join(tmpdir(), 'tywrap-isolated-consumer-'));

interface CommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

function isInside(child: string, parent: string): boolean {
  const relation = relative(resolve(parent), resolve(child));
  return (
    relation === '' ||
    (!isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`))
  );
}

async function run(command: string, args: string[], options: CommandOptions): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout ?? 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error: unknown) {
    const result = error as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.stderr ?? result.stdout ?? result.message ?? 'unknown error'}`
    );
  }
}

function venvPython(venv: string): string {
  return process.platform === 'win32'
    ? join(venv, 'Scripts', 'python.exe')
    : join(venv, 'bin', 'python');
}

describe('isolated npm consumer', () => {
  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('packs, installs, generates, compiles, and executes without repository Python imports', async () => {
    const artifacts = join(tempRoot, 'artifacts');
    const consumer = join(tempRoot, 'consumer');
    const fixtures = join(consumer, 'fixtures');
    const venv = join(tempRoot, 'venv');
    const wheelDir = join(artifacts, 'wheels');
    mkdirSync(artifacts, { recursive: true });
    mkdirSync(fixtures, { recursive: true });

    const packOutput = await run('npm', ['pack', '--json', '--pack-destination', artifacts], {
      cwd: repoRoot,
      timeout: 180_000,
    });
    const pack = JSON.parse(packOutput) as Array<{ filename?: string }>;
    const filename = pack[0]?.filename;
    if (!filename) {
      throw new Error('npm pack did not return a package filename');
    }
    const tarball = join(artifacts, filename);
    expect(existsSync(tarball)).toBe(true);

    await run(python, ['-m', 'venv', venv], { cwd: tempRoot });
    const isolatedPython = venvPython(venv);
    expect(existsSync(isolatedPython)).toBe(true);

    mkdirSync(wheelDir, { recursive: true });
    await run(
      isolatedPython,
      [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--upgrade',
        'setuptools>=68',
        'wheel',
      ],
      { cwd: tempRoot, timeout: 120_000 }
    );
    await run(
      isolatedPython,
      [
        '-m',
        'pip',
        'wheel',
        '--no-deps',
        '--no-build-isolation',
        '--wheel-dir',
        wheelDir,
        join(repoRoot, 'tywrap_ir'),
      ],
      { cwd: tempRoot, timeout: 120_000 }
    );
    const wheels = (
      await run(isolatedPython, ['-c', 'import glob; print(*glob.glob("*.whl"))'], {
        cwd: wheelDir,
      })
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    expect(wheels).toHaveLength(1);
    await run(
      isolatedPython,
      [
        '-m',
        'pip',
        'install',
        '--no-index',
        '--find-links',
        wheelDir,
        join(wheelDir, wheels[0] as string),
      ],
      { cwd: tempRoot, timeout: 120_000 }
    );

    writeFileSync(
      join(fixtures, 'consumer_fixture.py'),
      [
        'def add(left: int, right: int) -> int:',
        '    return left + right',
        '',
        'def safe_max() -> int:',
        '    return 2**53 - 1',
        '',
        'def wrong_return() -> int:',
        '    return "not an integer"',
        '',
      ].join('\n'),
      'utf8'
    );
    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify({ name: 'tywrap-consumer-check', private: true, type: 'module' }, null, 2)}\n`,
      'utf8'
    );
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], {
      cwd: consumer,
      timeout: 180_000,
    });

    const installedPackage = realpathSync(join(consumer, 'node_modules', 'tywrap'));
    expect(isInside(installedPackage, consumer)).toBe(true);
    expect(isInside(installedPackage, repoRoot)).toBe(false);
    expect(existsSync(join(installedPackage, 'dist', 'cli.js'))).toBe(true);
    expect(existsSync(join(installedPackage, 'runtime', 'python_bridge.py'))).toBe(true);

    const isolatedPythonEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONNOUSERSITE: '1',
      PYTHONPATH: fixtures,
    };
    const importedIrPath = (
      await run(
        isolatedPython,
        ['-c', 'import pathlib, tywrap_ir; print(pathlib.Path(tywrap_ir.__file__).resolve())'],
        { cwd: consumer, env: isolatedPythonEnv }
      )
    ).trim();
    expect(isInside(importedIrPath, venv)).toBe(true);
    expect(isInside(importedIrPath, repoRoot)).toBe(false);

    const generated = join(consumer, 'generated');
    writeFileSync(
      join(consumer, 'tywrap.config.json'),
      `${JSON.stringify(
        {
          pythonModules: { consumer_fixture: { typeHints: 'strict' } },
          pythonImportPath: [fixtures],
          output: { dir: generated, format: 'esm', declaration: false, sourceMap: false },
          runtime: { node: { pythonPath: isolatedPython } },
          performance: { caching: false, batching: false, compression: 'none' },
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    await run(
      process.execPath,
      [
        join(installedPackage, 'dist', 'cli.js'),
        'generate',
        '--config',
        'tywrap.config.json',
        '--fail-on-warn',
      ],
      { cwd: consumer, env: isolatedPythonEnv, timeout: 60_000 }
    );

    const generatedSource = join(generated, 'consumer_fixture.generated.ts');
    expect(existsSync(generatedSource)).toBe(true);
    expect(readFileSync(generatedSource, 'utf8')).not.toContain(repoRoot);
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            rootDir: '.',
            outDir: 'built',
            strict: true,
            skipLibCheck: true,
          },
          include: ['generated/**/*.ts'],
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    await run(
      process.execPath,
      [join(consumer, 'node_modules', 'typescript', 'lib', 'tsc.js'), '--project', 'tsconfig.json'],
      {
        cwd: consumer,
      }
    );

    const runner = join(consumer, 'run-generated-wrapper.mjs');
    writeFileSync(
      runner,
      `import { NodeBridge } from 'tywrap/node';
import { clearRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';
import * as fixture from './built/generated/consumer_fixture.generated.js';

const [pythonPath, scriptPath, fixtures] = process.argv.slice(2);
const bridge = new NodeBridge({
  pythonPath,
  scriptPath,
  cwd: process.cwd(),
  env: {
    PYTHONNOUSERSITE: '1',
    PYTHONPATH: fixtures,
    TYWRAP_ALLOWED_MODULES: 'consumer_fixture',
  },
});

setRuntimeBridge({ call: bridge.call.bind(bridge), dispose: bridge.dispose.bind(bridge) });
try {
  const add = await fixture.add(2, 3);
  const safeMax = await fixture.safeMax();
  let validationError;
  try {
    await fixture.wrongReturn();
  } catch (error) {
    validationError = error;
  }
  if (validationError?.name !== 'BridgeValidationError') {
    throw new Error('wrong_return did not throw BridgeValidationError');
  }
  process.stdout.write(JSON.stringify({ add, safeMax }));
} finally {
  clearRuntimeBridge();
  await bridge.dispose();
}
`,
      'utf8'
    );
    const execution = await run(
      process.execPath,
      [runner, isolatedPython, join(installedPackage, 'runtime', 'python_bridge.py'), fixtures],
      { cwd: consumer, env: isolatedPythonEnv, timeout: 60_000 }
    );
    expect(JSON.parse(execution)).toEqual({ add: 5, safeMax: Number.MAX_SAFE_INTEGER });
  }, 240_000);
});
