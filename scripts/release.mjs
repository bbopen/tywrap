#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const version = args.find(arg => !arg.startsWith('--'));

if (help || !version) {
  process.stdout.write(`Usage: node scripts/release.mjs <version> [--commit] [--tag] [--publish] [--dry-run] [--allow-dirty]

Options:
  --commit       Create a release commit with updated versions
  --tag          Create a git tag (v<version>)
  --publish      Run npm publish (requires --tag/--commit for clean history)
  --dry-run      Skip git and npm publish side effects
  --allow-dirty  Allow running with uncommitted changes
`);
  process.exit(help ? 0 : 1);
}

if (!/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  process.stderr.write(`Invalid version string: ${version}\n`);
  process.exit(1);
}

const shouldCommit = args.includes('--commit');
const shouldTag = args.includes('--tag');
const shouldPublish = args.includes('--publish');
const dryRun = args.includes('--dry-run');
const allowDirty = args.includes('--allow-dirty');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function gitStatus() {
  return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
}

async function updateVersion(nextVersion) {
  const pkgPath = resolve(root, 'package.json');
  const indexPath = resolve(root, 'src/index.ts');
  const pkgRaw = await readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgRaw);
  pkg.version = nextVersion;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');

  const indexRaw = await readFile(indexPath, 'utf-8');
  const updated = indexRaw.replace(
    /export const VERSION = ['"][^'"]+['"];/,
    `export const VERSION = '${nextVersion}';`
  );
  if (updated === indexRaw) {
    throw new Error('VERSION constant not found in src/index.ts');
  }
  await writeFile(indexPath, updated, 'utf-8');
}

if (!allowDirty) {
  const dirty = gitStatus();
  if (dirty) {
    process.stderr.write('Working tree is not clean. Commit or stash changes, or pass --allow-dirty.\n');
    process.exit(1);
  }
}

await updateVersion(version);
run('npm', ['run', 'check:all']);

if (dryRun) {
  process.stdout.write('Dry run complete; skipping git/npm publish steps.\n');
  process.exit(0);
}

if (shouldCommit) {
  run('git', ['add', 'package.json', 'src/index.ts']);
  run('git', ['commit', '-m', `release: v${version}`]);
}

if (shouldTag) {
  run('git', ['tag', `v${version}`]);
}

if (shouldPublish) {
  run('npm', ['publish']);
}

process.stdout.write('Release steps complete.\n');
if (shouldTag) {
  process.stdout.write('Remember to push tags: git push --tags\n');
}
