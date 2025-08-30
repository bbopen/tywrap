/*
  Library generation matrix harness
  - Creates an isolated Python venv under .tywrap/venv
  - Installs a curated set of Python packages
  - Invokes tywrap generation per package using the venv's python
*/

import { processUtils, fsUtils, pathUtils } from '../src/utils/runtime.js';

type MatrixPackage = {
  name: string;
  importName?: string; // if import name differs
  version?: string;
};

const PACKAGES: readonly MatrixPackage[] = [
  { name: 'typing_extensions' },
  { name: 'pydantic', version: '^2' },
  { name: 'numpy' },
  { name: 'pandas' },
  { name: 'requests' },
  { name: 'dataclasses_json', importName: 'dataclasses_json' },
  { name: 'attrs', importName: 'attr' },
  { name: 'types-requests' },
];

async function ensureVenv(venvDir: string): Promise<string> {
  const python = 'python3';
  const binDir = await pathUtils.join(venvDir, 'bin');
  const pythonBin = await pathUtils.join(binDir, 'python');
  try {
    // Try a quick version check to see if venv exists
    const res = await processUtils.exec(pythonBin, ['-V']);
    if (res.code === 0) {
      return pythonBin;
    }
  } catch {}

  await fsUtils.writeFile(await pathUtils.join(venvDir, '.placeholder'), '');
  const create = await processUtils.exec(python, ['-m', 'venv', venvDir]);
  if (create.code !== 0) {
    throw new Error(`Failed to create venv: ${create.stderr}`);
  }
  return pythonBin;
}

async function pipInstall(pythonBin: string, specs: string[]): Promise<void> {
  const pip = await processUtils.exec(pythonBin, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  if (pip.code !== 0) {
    throw new Error(`pip upgrade failed: ${pip.stderr}`);
  }
  if (specs.length === 0) return;
  const res = await processUtils.exec(pythonBin, ['-m', 'pip', 'install', ...specs]);
  if (res.code !== 0) {
    throw new Error(`pip install failed: ${res.stderr}`);
  }
}

async function generateForPackage(pkg: MatrixPackage, pythonBin: string): Promise<void> {
  const name = pkg.importName ?? pkg.name;
  const versionSuffix = pkg.version ? `==${pkg.version.replace('^', '')}` : '';
  await pipInstall(pythonBin, [`${pkg.name}${versionSuffix}`]);

  const config = {
    pythonModules: {
      [name]: { runtime: 'node', typeHints: 'strict' },
    },
    output: { dir: './generated', format: 'esm', declaration: true, sourceMap: true },
    performance: { caching: true },
    runtime: { node: { pythonPath: pythonBin } },
  } as const;

  const tmpConfigPath = await pathUtils.join('.tywrap', `matrix.${name}.json`);
  const configText = JSON.stringify(config, null, 2);
  await fsUtils.writeFile(tmpConfigPath, configText);

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

export async function run(): Promise<void> {
  const venvDir = await pathUtils.join('.tywrap', 'venv');
  const pythonBin = await ensureVenv(venvDir);
  // Ensure tywrap_ir is available in the venv environment via PYTHONPATH set by processUtils

  for (const pkg of PACKAGES) {
    try {
      // eslint-disable-next-line no-console
      console.log(`Processing ${pkg.name}...`);
      await generateForPackage(pkg, pythonBin);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Package ${pkg.name} failed:`, e);
    }
  }
}

// Allow CLI execution: node tools/matrix.js
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}


