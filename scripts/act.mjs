#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const cleanOnly = rawArgs.includes('--clean');
const noProject = rawArgs.includes('--no-project');
const baseName = basename(root);
const envProject = process.env.TYWRAP_ACT_PROJECT ?? process.env.ACT_PROJECT_NAME ?? '';
let projectName = envProject || baseName;
const args = rawArgs.filter(arg => arg !== '--clean' && arg !== '--no-project');
const actArgs = [];
const defaultArch =
  process.env.TYWRAP_ACT_ARCH ??
  process.env.ACT_CONTAINER_ARCHITECTURE ??
  (process.platform === 'darwin' && process.arch === 'arm64' ? 'linux/amd64' : '');

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--project') {
    projectName = args[i + 1] ?? projectName;
    i += 1;
    continue;
  }
  if (arg.startsWith('--project=')) {
    projectName = arg.slice('--project='.length) || projectName;
    continue;
  }
  actArgs.push(arg);
}

const hasContainerArch = actArgs.some(
  arg => arg === '--container-architecture' || arg.startsWith('--container-architecture=')
);
if (defaultArch && !hasContainerArch) {
  actArgs.push('--container-architecture', defaultArch);
}

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: root, ...options });
  if (result.error) {
    process.stderr.write(`Failed to run ${cmd}: ${result.error.message}\n`);
    return result.status ?? 1;
  }
  return result.status ?? 0;
}

function capture(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { encoding: 'utf8', cwd: root });
  if (result.error) {
    return { ok: false, output: '', error: result.error.message };
  }
  if (result.status !== 0) {
    const err = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    return { ok: false, output: '', error: err || `Exit code ${result.status}` };
  }
  const output = typeof result.stdout === 'string' ? result.stdout : '';
  return { ok: true, output, error: '' };
}

function splitLines(value) {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function cleanupActArtifacts(currentProject) {
  const containerIds = new Set();
  if (currentProject) {
    const byLabel = capture('docker', [
      'ps',
      '-aq',
      '--filter',
      `label=com.tywrap.act.project=${currentProject}`,
    ]);
    if (byLabel.ok) {
      for (const id of splitLines(byLabel.output)) {
        containerIds.add(id);
      }
    }
  }
  const byName = capture('docker', ['ps', '-aq', '--filter', 'name=act-']);
  if (!byName.ok) {
    process.stderr.write(`Skipping act cleanup: ${byName.error}\n`);
    return;
  }
  for (const id of splitLines(byName.output)) {
    containerIds.add(id);
  }
  if (containerIds.size > 0) {
    run('docker', ['rm', '-f', ...containerIds]);
  }

  const volumes = capture('docker', ['volume', 'ls', '-q']);
  if (!volumes.ok) {
    process.stderr.write(`Skipping act volume cleanup: ${volumes.error}\n`);
    return;
  }
  const volumeNames = splitLines(volumes.output).filter(
    name => name.startsWith('act-') && name !== 'act-toolcache'
  );
  if (volumeNames.length > 0) {
    run('docker', ['volume', 'rm', ...volumeNames]);
  }

  const networks = capture('docker', ['network', 'ls', '-q', '--filter', 'name=act-']);
  if (!networks.ok) {
    process.stderr.write(`Skipping act network cleanup: ${networks.error}\n`);
    return;
  }
  const networkIds = splitLines(networks.output);
  if (networkIds.length > 0) {
    run('docker', ['network', 'rm', ...networkIds]);
  }
}

if (!noProject && projectName) {
  const projectLabelArgs = [
    `--label com.docker.compose.project=${projectName}`,
    '--label com.docker.compose.service=act',
    `--label com.tywrap.act.project=${projectName}`,
  ].join(' ');
  const optionIndex = actArgs.findIndex(
    arg => arg === '--container-options' || arg.startsWith('--container-options=')
  );
  if (optionIndex >= 0) {
    if (actArgs[optionIndex].startsWith('--container-options=')) {
      actArgs[optionIndex] = `${actArgs[optionIndex]} ${projectLabelArgs}`;
    } else if (actArgs[optionIndex + 1]) {
      actArgs[optionIndex + 1] = `${actArgs[optionIndex + 1]} ${projectLabelArgs}`;
    } else {
      actArgs.push(projectLabelArgs);
    }
  } else {
    actArgs.push('--container-options', projectLabelArgs);
  }
}

let exitCode = 0;
if (!cleanOnly) {
  exitCode = run('act', actArgs);
}
cleanupActArtifacts(noProject ? '' : projectName);
process.exit(exitCode);
