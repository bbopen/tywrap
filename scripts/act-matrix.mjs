#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = resolve(root, '.github', 'workflows', 'ci.yml');
const rawArgs = process.argv.slice(2);

let jobName = 'test';
let eventName = 'workflow_dispatch';
const passthrough = [];

const argsToParse = [...rawArgs];
if (argsToParse[0] && !argsToParse[0].startsWith('-')) {
  eventName = argsToParse.shift() ?? eventName;
}

for (let i = 0; i < argsToParse.length; i += 1) {
  const arg = argsToParse[i];
  if (arg === '--job' || arg === '-j') {
    jobName = argsToParse[i + 1] ?? jobName;
    i += 1;
    continue;
  }
  if (arg === '--event') {
    eventName = argsToParse[i + 1] ?? eventName;
    i += 1;
    continue;
  }
  passthrough.push(arg);
}

const workflow = readFileSync(workflowPath, 'utf8');

function extractJobBlock(contents, job) {
  const needle = `\n  ${job}:`;
  const start = contents.indexOf(needle);
  if (start === -1) return '';
  const rest = contents.slice(start + needle.length);
  const next = rest.search(/\n  [a-zA-Z0-9_-]+:\n/);
  if (next === -1) return contents.slice(start);
  return contents.slice(start, start + needle.length + next);
}

function parseArray(block, key) {
  const match = block.match(new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`));
  if (!match) return [];
  return match[1]
    .split(',')
    .map(value => value.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

const jobBlock = extractJobBlock(workflow, jobName) || workflow;
const nodeVersions = parseArray(jobBlock, 'node-version');
const pythonVersions = parseArray(jobBlock, 'python-version');

if (nodeVersions.length === 0 || pythonVersions.length === 0) {
  process.stderr.write(
    `Unable to find node-version or python-version matrix entries for job "${jobName}".\n`
  );
  process.exit(1);
}

const hasRm = passthrough.includes('--rm');
const extraArgs = hasRm ? passthrough : [...passthrough, '--rm'];

let exitCode = 0;
for (const nodeVersion of nodeVersions) {
  for (const pythonVersion of pythonVersions) {
    const args = [
      resolve(root, 'scripts', 'act.mjs'),
      eventName,
      '-j',
      jobName,
      '--matrix',
      `node-version:${nodeVersion}`,
      '--matrix',
      `python-version:${pythonVersion}`,
      ...extraArgs,
    ];
    const result = spawnSync('node', args, { stdio: 'inherit', cwd: root });
    if (result.error) {
      process.stderr.write(`Failed to run act: ${result.error.message}\n`);
      exitCode = 1;
      break;
    }
    if ((result.status ?? 0) !== 0) {
      exitCode = result.status ?? 1;
      break;
    }
  }
  if (exitCode !== 0) break;
}

process.exit(exitCode);
