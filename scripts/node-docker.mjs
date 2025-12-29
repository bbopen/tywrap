#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

if (args.length === 0) {
  process.stderr.write('Usage: node scripts/node-docker.mjs <command> [args...]\n');
  process.exit(1);
}

const image = process.env.TYWRAP_NODE_DOCKER_IMAGE ?? 'node:22-bookworm';
const dockerArgs = ['run', '--rm'];
const useTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

if (useTty) {
  dockerArgs.push('-it');
}

dockerArgs.push('-v', `${root}:/work`, '-w', '/work', '-e', 'HOME=/tmp');

if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
  dockerArgs.push('--user', `${process.getuid()}:${process.getgid()}`);
}

const envKeys = new Set(['CI', 'NODE_OPTIONS']);
for (const key of Object.keys(process.env)) {
  if (key.startsWith('TYWRAP_') || key.startsWith('NPM_CONFIG_')) {
    envKeys.add(key);
  }
}

for (const key of envKeys) {
  if (process.env[key] !== undefined) {
    dockerArgs.push('-e', key);
  }
}

dockerArgs.push(image, ...args);

const result = spawnSync('docker', dockerArgs, { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
