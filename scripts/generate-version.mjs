#!/usr/bin/env node
/**
 * Generate src/version.ts from package.json.
 *
 * Why: the public API re-exports a VERSION constant, but src/ cannot import
 * package.json directly (it lives outside `rootDir`, so tsc would reject it).
 * Single-sourcing the version here keeps the exported constant in lockstep with
 * package.json without a forbidden cross-rootDir import.
 *
 * This runs as part of `npm run build` (before tsc) so a fresh checkout builds.
 * Regenerate with: node scripts/generate-version.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const pkgPath = resolve(repoRoot, 'package.json');
const outPath = resolve(repoRoot, 'src/version.ts');

const { version } = JSON.parse(readFileSync(pkgPath, 'utf-8'));

// JSON.stringify produces a safe, fully-escaped double-quoted JS string literal.
const literal = JSON.stringify(version);

const banner = `/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Source: package.json (version field)
 * Generator: scripts/generate-version.mjs (runs in \`npm run build\`)
 *
 * Single-sources the package version so the public API can re-export it without
 * importing package.json from outside tsconfig \`rootDir\`.
 * Regenerate with: node scripts/generate-version.mjs
 */

export const VERSION: string = ${literal};
`;

// Skip the write when the content is unchanged so we don't churn the file's mtime
// (which would invalidate incremental-build caches on every run).
const existing = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : null;
// Write progress to stderr, not stdout: this script runs inside `npm run build`,
// which runs as the npm `prepare` lifecycle during `npm pack --json`. Anything on
// stdout would corrupt the JSON that tooling (and packaging.test.ts) parses.
if (existing === banner) {
  process.stderr.write(`src/version.ts already current (version ${version})\n`);
} else {
  writeFileSync(outPath, banner, 'utf-8');
  process.stderr.write(`Wrote ${outPath} (version ${version})\n`);
}
