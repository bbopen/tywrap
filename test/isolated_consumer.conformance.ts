import { execFile } from 'node:child_process';
import {
  copyFileSync,
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
const npmRegistry = 'https://registry.npmjs.org/';
const pypiRegistry = 'https://pypi.org/simple';

type ConsumerMode =
  | { kind: 'candidate' }
  | { kind: 'published'; npmVersion: string; pypiVersion: string };

function consumerMode(env: NodeJS.ProcessEnv = process.env): ConsumerMode {
  const mode = env.TYWRAP_CONSUMER_MODE ?? 'candidate';
  const npmVersion = env.TYWRAP_PUBLISHED_NPM_VERSION;
  const pypiVersion = env.TYWRAP_PUBLISHED_PYPI_VERSION;
  if (mode === 'candidate') {
    if (npmVersion !== undefined || pypiVersion !== undefined) {
      throw new Error('Published versions require TYWRAP_CONSUMER_MODE=published');
    }
    return { kind: 'candidate' };
  }
  if (mode !== 'published') {
    throw new Error(`Unknown consumer mode: ${mode}`);
  }
  if (!npmVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(npmVersion)) {
    throw new Error('TYWRAP_PUBLISHED_NPM_VERSION must be an exact npm version');
  }
  if (
    !pypiVersion ||
    !/^\d+\.\d+\.\d+(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?$/.test(pypiVersion)
  ) {
    throw new Error('TYWRAP_PUBLISHED_PYPI_VERSION must be an exact PyPI version');
  }
  return { kind: 'published', npmVersion, pypiVersion };
}

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

  it('uses candidate mode unless both exact published versions are selected', () => {
    expect(consumerMode({})).toEqual({ kind: 'candidate' });
    expect(
      consumerMode({
        TYWRAP_CONSUMER_MODE: 'published',
        TYWRAP_PUBLISHED_NPM_VERSION: '1.2.3',
        TYWRAP_PUBLISHED_PYPI_VERSION: '4.5.6',
      })
    ).toEqual({ kind: 'published', npmVersion: '1.2.3', pypiVersion: '4.5.6' });
  });

  it.each([
    { TYWRAP_CONSUMER_MODE: 'published', TYWRAP_PUBLISHED_PYPI_VERSION: '4.5.6' },
    { TYWRAP_CONSUMER_MODE: 'published', TYWRAP_PUBLISHED_NPM_VERSION: '1.2.3' },
    {
      TYWRAP_CONSUMER_MODE: 'published',
      TYWRAP_PUBLISHED_NPM_VERSION: 'latest',
      TYWRAP_PUBLISHED_PYPI_VERSION: '4.5.6',
    },
    {
      TYWRAP_CONSUMER_MODE: 'published',
      TYWRAP_PUBLISHED_NPM_VERSION: '1.2.3',
      TYWRAP_PUBLISHED_PYPI_VERSION: '>=4.5',
    },
    { TYWRAP_PUBLISHED_NPM_VERSION: '1.2.3' },
  ])('rejects an incomplete or floating published version pair', env => {
    expect(() => consumerMode(env)).toThrow();
  });

  it('installs, generates, compiles, and executes without repository Python imports', async () => {
    const mode = consumerMode();
    const artifacts = join(tempRoot, 'artifacts');
    const consumer = join(tempRoot, 'consumer');
    const fixtures = join(consumer, 'fixtures');
    const venv = join(tempRoot, 'venv');
    const wheelDir = join(artifacts, 'wheels');
    mkdirSync(fixtures, { recursive: true });

    let packageSpec: string;
    if (mode.kind === 'candidate') {
      mkdirSync(artifacts, { recursive: true });
      const packOutput = await run('npm', ['pack', '--json', '--pack-destination', artifacts], {
        cwd: repoRoot,
        timeout: 180_000,
      });
      const pack = JSON.parse(packOutput) as Array<{ filename?: string }>;
      const filename = pack[0]?.filename;
      if (!filename) {
        throw new Error('npm pack did not return a package filename');
      }
      packageSpec = join(artifacts, filename);
      expect(existsSync(packageSpec)).toBe(true);
    } else {
      packageSpec = `tywrap@${mode.npmVersion}`;
    }

    await run(python, ['-m', 'venv', venv], { cwd: tempRoot });
    const isolatedPython = venvPython(venv);
    expect(existsSync(isolatedPython)).toBe(true);
    await run(
      isolatedPython,
      [
        '-c',
        'import sys\nif sys.version_info < (3, 11): raise SystemExit("Python 3.11 is required for overload extraction")',
      ],
      { cwd: consumer }
    );

    if (mode.kind === 'candidate') {
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
        ['-m', 'pip', 'install', '--disable-pip-version-check', 'numpy==2.3.5', 'pyarrow==24.0.0'],
        { cwd: tempRoot, timeout: 180_000 }
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
    } else {
      const reportPath = join(tempRoot, 'pypi-install-report.json');
      await run(
        isolatedPython,
        [
          '-m',
          'pip',
          '--isolated',
          'install',
          '--disable-pip-version-check',
          '--no-cache-dir',
          '--only-binary=:all:',
          '--index-url',
          pypiRegistry,
          '--report',
          reportPath,
          `tywrap-ir==${mode.pypiVersion}`,
          'numpy==2.3.5',
          'pyarrow==24.0.0',
        ],
        { cwd: tempRoot, timeout: 180_000 }
      );
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        install?: Array<{
          metadata?: { name?: string; version?: string };
          download_info?: { url?: string };
        }>;
      };
      const irInstall = report.install?.find(
        item => item.metadata?.name?.toLowerCase().replace(/[-_.]+/g, '-') === 'tywrap-ir'
      );
      expect(irInstall?.metadata?.version).toBe(mode.pypiVersion);
      expect(new URL(irInstall?.download_info?.url ?? '').hostname).toBe('files.pythonhosted.org');
    }

    writeFileSync(
      join(fixtures, 'consumer_fixture.py'),
      [
        'import numpy as np',
        'from numpy.typing import NDArray',
        '',
        'def add(left: int, right: int) -> int:',
        '    return left + right',
        '',
        'def safe_max() -> int:',
        '    return 2**53 - 1',
        '',
        'def safe_min() -> int:',
        '    return -(2**53 - 1)',
        '',
        'def unsafe_positive() -> int:',
        '    return 2**53',
        '',
        'def unsafe_negative() -> int:',
        '    return -(2**53)',
        '',
        'def float16_values() -> NDArray[np.float16]:',
        '    return np.array([1.5, -2.25, -0.0], dtype=np.float16)',
        '',
        'def wrong_return() -> int:',
        '    return "not an integer"',
        '',
      ].join('\n'),
      'utf8'
    );
    copyFileSync(
      join(repoRoot, 'test', 'fixtures', 'architecture_callable_fixture.py'),
      join(fixtures, 'architecture_callable_fixture.py')
    );
    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify({ name: 'tywrap-consumer-check', private: true, type: 'module' }, null, 2)}\n`,
      'utf8'
    );
    const npmArgs = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
    if (mode.kind === 'published') {
      npmArgs.push(
        '--registry',
        npmRegistry,
        '--cache',
        join(tempRoot, 'npm-registry-cache'),
        '--prefer-online'
      );
    }
    npmArgs.push(packageSpec, 'apache-arrow@21.1.0');
    await run('npm', npmArgs, { cwd: consumer, timeout: 180_000 });

    const installedPackage = realpathSync(join(consumer, 'node_modules', 'tywrap'));
    expect(isInside(installedPackage, consumer)).toBe(true);
    expect(isInside(installedPackage, repoRoot)).toBe(false);
    if (mode.kind === 'published') {
      const packageJson = JSON.parse(
        readFileSync(join(installedPackage, 'package.json'), 'utf8')
      ) as {
        version?: string;
      };
      expect(packageJson.version).toBe(mode.npmVersion);
      const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8')) as {
        packages?: Record<string, { resolved?: string }>;
      };
      expect(lock.packages?.['node_modules/tywrap']?.resolved).toBe(
        `${npmRegistry}tywrap/-/tywrap-${mode.npmVersion}.tgz`
      );
    }
    expect(existsSync(join(installedPackage, 'dist', 'cli.js'))).toBe(true);
    expect(existsSync(join(installedPackage, 'runtime', 'python_bridge.py'))).toBe(true);
    expect(isInside(realpathSync(join(consumer, 'node_modules', 'apache-arrow')), consumer)).toBe(
      true
    );

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
    if (mode.kind === 'published') {
      const installedIr = JSON.parse(
        await run(
          isolatedPython,
          [
            '-c',
            'import importlib.metadata as m, json; d=m.distribution("tywrap-ir"); print(json.dumps({"version": d.version, "direct_url": d.read_text("direct_url.json")}))',
          ],
          { cwd: consumer, env: isolatedPythonEnv }
        )
      ) as { version?: string; direct_url?: string | null };
      expect(installedIr.version).toBe(mode.pypiVersion);
      expect(installedIr.direct_url).toBeNull();
    }

    const generated = join(consumer, 'generated');
    expect(existsSync(generated)).toBe(false);
    writeFileSync(
      join(consumer, 'tywrap.config.json'),
      `${JSON.stringify(
        {
          pythonModules: {
            consumer_fixture: { typeHints: 'strict' },
            architecture_callable_fixture: { typeHints: 'strict' },
          },
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
    const architectureSource = join(generated, 'architecture_callable_fixture.generated.ts');
    expect(existsSync(architectureSource)).toBe(true);
    expect(readFileSync(architectureSource, 'utf8')).not.toContain(repoRoot);
    copyFileSync(
      join(repoRoot, 'test', 'fixtures', 'architecture-overload.typecheck.ts.txt'),
      join(consumer, 'architecture-overload.typecheck.ts')
    );
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
          include: ['generated/**/*.ts', 'architecture-overload.typecheck.ts'],
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
      `import { BridgeValidationError } from 'tywrap';
import { NodeBridge } from 'tywrap/node';
import { clearRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';
import * as fixture from './built/generated/consumer_fixture.generated.js';
import * as architecture from './built/generated/architecture_callable_fixture.generated.js';

const [pythonPath, fixtures] = process.argv.slice(2);
const bridge = new NodeBridge({
  pythonPath,
  cwd: process.cwd(),
  env: {
    PYTHONNOUSERSITE: '1',
    PYTHONPATH: fixtures,
    TYWRAP_ALLOWED_MODULES: 'consumer_fixture,architecture_callable_fixture',
  },
});

try {
  setRuntimeBridge({ call: bridge.call.bind(bridge), dispose: bridge.dispose.bind(bridge) });
  const add = await fixture.add(2, 3);
  const safeMax = await fixture.safeMax();
  const safeMin = await fixture.safeMin();
  const float16Values = await fixture.float16Values();
  if (!Array.isArray(float16Values) || float16Values.length !== 3) {
    throw new Error('float16_values did not decode to a three-element array');
  }
  const negativeZero = Object.is(float16Values[2], -0);
  for (const call of [fixture.unsafePositive, fixture.unsafeNegative]) {
    let unsafeError;
    try {
      await call();
    } catch (error) {
      unsafeError = error;
    }
    if (
      unsafeError?.name !== 'BridgeExecutionError' ||
      !unsafeError.message.includes('result') ||
      !unsafeError.message.includes('safe integer range') ||
      !unsafeError.message.includes('explicit string')
    ) {
      throw new Error('unsafe integer did not fail with a located conversion error');
    }
  }
  let validationError;
  try {
    await fixture.wrongReturn();
  } catch (error) {
    validationError = error;
  }
  if (!(validationError instanceof BridgeValidationError)) {
    throw new Error('wrong_return did not throw BridgeValidationError');
  }
  const textRecord = await architecture.selectRecord('label');
  const integerRecord = await architecture.selectRecord(42);
  for (const key of ['label', 42]) {
    let wrongOverloadError;
    try {
      await architecture.selectRecordWrong(key);
    } catch (error) {
      wrongOverloadError = error;
    }
    if (
      !(wrongOverloadError instanceof BridgeValidationError) ||
      wrongOverloadError.callSite !== 'architecture_callable_fixture.select_record_wrong'
    ) {
      throw new Error('selected overload accepted a wrong nested return');
    }
  }
  let wrongIntegerError;
  try {
    await architecture.wrongIntegerReturn();
  } catch (error) {
    wrongIntegerError = error;
  }
  if (
    !(wrongIntegerError instanceof BridgeValidationError) ||
    wrongIntegerError.callSite !== 'architecture_callable_fixture.wrong_integer_return'
  ) {
    throw new Error('wrong_integer_return did not throw BridgeValidationError');
  }
  process.stdout.write(JSON.stringify({
    add, safeMax, safeMin, float16Values, negativeZero, textRecord, integerRecord,
  }));
} finally {
  clearRuntimeBridge();
  await bridge.dispose();
}
`,
      'utf8'
    );
    const execution = await run(process.execPath, [runner, isolatedPython, fixtures], {
      cwd: consumer,
      env: isolatedPythonEnv,
      timeout: 60_000,
    });
    expect(JSON.parse(execution)).toEqual({
      add: 5,
      safeMax: Number.MAX_SAFE_INTEGER,
      safeMin: Number.MIN_SAFE_INTEGER,
      float16Values: [1.5, -2.25, 0],
      negativeZero: true,
      textRecord: { outer: { value: 'label' } },
      integerRecord: { outer: { value: 42 } },
    });
  }, 240_000);
});
