/*
  Python library integration suite runner
  - Creates an isolated venv under .tywrap/python-suite/<suite>/.venv
  - Installs pinned requirements for the selected suite
  - Runs test/python/library_integration.py against that venv
*/

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isWindows = process.platform === 'win32';

type SuiteName = 'core' | 'data' | 'ml' | 'all';

interface SuiteRequirements {
  suite: SuiteName;
  pipArgs: string[];
  hashFiles: string[];
}

function usage(): void {
  // eslint-disable-next-line no-console
  console.error('Usage: node dist/tools/python_suite.js <core|data|ml|all>');
}

function runCapture(
  command: string,
  args: string[],
  options: SpawnSyncOptions = {}
): SpawnSyncReturns<string> {
  const { encoding: _encoding, ...rest } = options;
  const res = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...rest,
  });
  if (res.error) {
    throw res.error;
  }
  return res as SpawnSyncReturns<string>;
}

function runInherit(command: string, args: string[], options: SpawnSyncOptions = {}): void {
  const res = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${res.status}`);
  }
}

function resolvePythonBin(): { python: string; argsPrefix: string[] } {
  const envPython = process.env.PYTHON_BIN?.trim();
  const candidates = envPython
    ? [envPython]
    : isWindows
      ? ['python', 'py']
      : ['python3.12', 'python3.11', 'python3.10', 'python3', 'python'];

  for (const candidate of candidates) {
    try {
      const args = candidate === 'py' ? ['-3', '-V'] : ['-V'];
      const res = runCapture(candidate, args);
      if (res.status === 0) {
        return { python: candidate, argsPrefix: candidate === 'py' ? ['-3'] : [] };
      }
    } catch {
      // ignore
    }
  }

  throw new Error(
    `No Python interpreter found (tried ${candidates.join(', ')}${envPython ? '' : ' and PYTHON_BIN'}).`
  );
}

function venvPythonPath(venvDir: string): string {
  const binDir = path.join(venvDir, isWindows ? 'Scripts' : 'bin');
  return path.join(binDir, isWindows ? 'python.exe' : 'python');
}

function requirementsForSuite(rootDir: string, suite: string): SuiteRequirements {
  const baseDir = path.join(rootDir, 'test', 'python');
  const core = path.join(baseDir, 'requirements-suite-core.txt');
  const data = path.join(baseDir, 'requirements-suite-data.txt');
  const ml = path.join(baseDir, 'requirements-suite-ml.txt');

  if (suite === 'core') {
    return { suite: 'core', pipArgs: ['-r', core], hashFiles: [core] };
  }
  if (suite === 'data') {
    return { suite: 'data', pipArgs: ['-r', data], hashFiles: [data] };
  }
  if (suite === 'ml') {
    return { suite: 'ml', pipArgs: ['-r', ml], hashFiles: [ml] };
  }
  if (suite === 'all') {
    return { suite: 'all', pipArgs: ['-r', core, '-r', data, '-r', ml], hashFiles: [core, data, ml] };
  }

  throw new Error(`Unknown suite: ${suite}`);
}

function computeRequirementsHash(files: string[]): string {
  const hash = createHash('sha256');
  for (const filePath of files) {
    hash.update(`${path.basename(filePath)}\0`);
    hash.update(readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function ensureVenv(venvDir: string, python: string, argsPrefix: string[]): string {
  const pythonBin = venvPythonPath(venvDir);
  try {
    const res = runCapture(pythonBin, ['-V']);
    if (res.status === 0) {
      return pythonBin;
    }
  } catch {
    // ignore
  }

  ensureDir(path.dirname(venvDir));
  ensureDir(venvDir);
  runInherit(python, [...argsPrefix, '-m', 'venv', venvDir]);
  return pythonBin;
}

function ensureRequirementsInstalled(
  pythonBin: string,
  suiteDir: string,
  requirements: SuiteRequirements
): void {
  const markerPath = path.join(suiteDir, 'requirements.sha256');
  const currentHash = computeRequirementsHash(requirements.hashFiles);
  const existingHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';

  if (existingHash === currentHash) {
    return;
  }

  const pipEnv = {
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_PROGRESS_BAR: 'off',
  };

  runInherit(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
    env: { ...process.env, ...pipEnv },
  });
  runInherit(pythonBin, ['-m', 'pip', 'install', ...requirements.pipArgs], {
    env: { ...process.env, ...pipEnv },
  });

  writeFileSync(markerPath, `${currentHash}\n`, 'utf8');
}

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

export function run(argv: string[] = process.argv.slice(2)): void {
  const suite = String(argv[0] ?? '').trim();
  if (!suite) {
    usage();
    process.exitCode = 2;
    return;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = findRepoRoot(here);

  const requirements = requirementsForSuite(rootDir, suite);
  const suiteDir = path.join(rootDir, '.tywrap', 'python-suite', suite);
  const venvDir = path.join(suiteDir, '.venv');

  ensureDir(suiteDir);

  const { python, argsPrefix } = resolvePythonBin();
  const pythonBin = ensureVenv(venvDir, python, argsPrefix);
  ensureRequirementsInstalled(pythonBin, suiteDir, requirements);

  runInherit(
    pythonBin,
    [path.join(rootDir, 'test', 'python', 'library_integration.py'), '--suite', suite],
    { cwd: rootDir }
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  }
}
