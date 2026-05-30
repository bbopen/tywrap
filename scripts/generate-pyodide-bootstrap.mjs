#!/usr/bin/env node
/**
 * Generate src/runtime/pyodide-bootstrap-core.generated.ts from the shared
 * Python core module runtime/tywrap_bridge_core.py.
 *
 * Why: the in-WASM Pyodide server must run the EXACT same protocol/serialization
 * code as the reference subprocess server, but Pyodide cannot read the .py file
 * from disk (PyodideInstance exposes no filesystem). So we embed the source as a
 * TypeScript string constant at build time and exec it into a sys.modules-
 * registered module inside Pyodide. A conformance drift guard asserts this
 * generated constant stays in sync with the source file.
 *
 * This runs as part of `npm run build`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const sourcePath = resolve(repoRoot, 'runtime/tywrap_bridge_core.py');
const outPath = resolve(repoRoot, 'src/runtime/pyodide-bootstrap-core.generated.ts');

const source = readFileSync(sourcePath, 'utf-8');

// JSON.stringify produces a safe, fully-escaped double-quoted JS string literal.
// The drift-guard test relies on JSON.stringify(source) appearing verbatim.
const literal = JSON.stringify(source);

const banner = `/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Source: runtime/tywrap_bridge_core.py
 * Generator: scripts/generate-pyodide-bootstrap.mjs (runs in \`npm run build\`)
 *
 * This is the shared Python bridge core embedded as a string so the Pyodide
 * (in-WASM) server can exec the identical code the subprocess server imports.
 * Regenerate with: node scripts/generate-pyodide-bootstrap.mjs
 */

export const PYODIDE_BRIDGE_CORE_SOURCE: string = ${literal};
`;

writeFileSync(outPath, banner, 'utf-8');
// Write progress to stderr, not stdout: this script runs inside `npm run build`,
// which runs as the npm `prepare` lifecycle during `npm pack --json`. Anything on
// stdout would corrupt the JSON that tooling (and packaging.test.ts) parses.
process.stderr.write(`Wrote ${outPath} (${source.length} source bytes)\n`);
