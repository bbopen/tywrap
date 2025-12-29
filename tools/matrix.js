/*
  Library generation matrix harness
  - Creates an isolated Python venv under .tywrap/venv
  - Installs a curated set of Python packages
  - Invokes tywrap generation per package using the venv's python
*/

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { fsUtils, pathUtils, processUtils } from '../dist/utils/runtime.js';

/**
 * @typedef {{ name: string; importName?: string; version?: string }} MatrixPackage
 */

/** @type {readonly MatrixPackage[]} */
const PACKAGES = [
  { name: 'typing_extensions' },
  { name: 'pydantic', version: '^2' },
  { name: 'numpy' },
  { name: 'pandas' },
  { name: 'requests' },
  { name: 'dataclasses_json', importName: 'dataclasses_json' },
  { name: 'attrs', importName: 'attr' },
  { name: 'types-requests' },
];

const isWindows = process.platform === 'win32';

function venvPythonPath(venvDir) {
  const binDir = pathUtils.join(venvDir, isWindows ? 'Scripts' : 'bin');
  return pathUtils.join(binDir, isWindows ? 'python.exe' : 'python');
}

async function resolvePythonBin() {
  const envPython = process.env.PYTHON_BIN?.trim();
  const candidates = envPython
    ? [envPython]
    : ['python3.12', 'python3.11', 'python3.10', 'python3', 'python'];

  for (const candidate of candidates) {
    try {
      const res = await processUtils.exec(candidate, ['-V']);
      if (res.code === 0) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  throw new Error(
    'No Python interpreter found (tried PYTHON_BIN, python3.12, python3.11, python3.10, python3, python).'
  );
}

function toPipSpecifier(version) {
  const raw = version.trim();
  if (!raw) {
    return '';
  }

  if (raw.startsWith('^')) {
    const base = raw.slice(1);
    const majorRaw = base.split('.')[0];
    const major = Number(majorRaw);
    if (!Number.isInteger(major) || major < 0) {
      throw new Error(`Unsupported caret version: ${version}`);
    }
    return `>=${base},<${major + 1}`;
  }

  if (/^[<>!=~]/.test(raw) || raw.includes(',')) {
    return raw;
  }

  return `==${raw}`;
}

async function ensureVenv(venvDir) {
  const python = await resolvePythonBin();
  const pythonBin = venvPythonPath(venvDir);
  try {
    const res = await processUtils.exec(pythonBin, ['-V']);
    if (res.code === 0) {
      return pythonBin;
    }
  } catch {
    // ignore
  }

  await fsUtils.writeFile(pathUtils.join(venvDir, '.placeholder'), '');
  const create = await processUtils.exec(python, ['-m', 'venv', venvDir]);
  if (create.code !== 0) {
    throw new Error(`Failed to create venv: ${create.stderr}`);
  }
  return pythonBin;
}

async function pipInstall(pythonBin, specs) {
  const pip = await processUtils.exec(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  if (pip.code !== 0) {
    throw new Error(`pip upgrade failed: ${pip.stderr}`);
  }
  if (specs.length === 0) {
    return;
  }
  const res = await processUtils.exec(pythonBin, ['-m', 'pip', 'install', ...specs]);
  if (res.code !== 0) {
    throw new Error(`pip install failed: ${res.stderr}`);
  }
}

async function generateForPackage(pkg, pythonBin) {
  const name = pkg.importName ?? pkg.name;
  const requirement = pkg.version ? `${pkg.name}${toPipSpecifier(pkg.version)}` : pkg.name;
  await pipInstall(pythonBin, [requirement]);

  const config = {
    pythonModules: {
      [name]: { runtime: 'node', typeHints: 'strict' },
    },
    output: { dir: './generated', format: 'esm', declaration: true, sourceMap: true },
    performance: { caching: true },
    runtime: { node: { pythonPath: pythonBin } },
  };

  const tmpConfigPath = pathUtils.join('.tywrap', `matrix.${name}.json`);
  await fsUtils.writeFile(tmpConfigPath, JSON.stringify(config, null, 2));

  const cli = pathUtils.join(process.cwd(), 'dist', 'cli.js');
  if (!existsSync(cli)) {
    throw new Error('dist/cli.js not found; run `npm run build` before `npm run matrix`.');
  }

  const res = await processUtils.exec('node', [
    './dist/cli.js',
    'generate',
    '--config',
    tmpConfigPath,
    '--fail-on-warn',
  ]);
  if (res.code !== 0) {
    throw new Error(`generate failed for ${name}: ${res.stderr || res.stdout}`);
  }
}

export async function run() {
  const venvDir = pathUtils.join('.tywrap', 'venv');
  const pythonBin = await ensureVenv(venvDir);

  for (const pkg of PACKAGES) {
    try {
      // eslint-disable-next-line no-console
      console.log(`Processing ${pkg.name}...`);
      await generateForPackage(pkg, pythonBin);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Package ${pkg.name} failed:`, error);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
