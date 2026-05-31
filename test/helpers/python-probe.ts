/**
 * Synchronous Python availability probes for test gating.
 *
 * These are intended for use with Vitest's `it.skipIf(...)` / `describe.skipIf(...)`
 * so that tests requiring a real Python interpreter (or specific Python modules)
 * SKIP loudly when the interpreter is absent, instead of silently no-op'ing via an
 * early `return` (which would report a vacuous PASS).
 *
 * The probes are synchronous (spawnSync) and side-effect free, mirroring the idiom
 * established in test/runtime_conformance.test.ts. They are evaluated once at module
 * load so they can feed the `skipIf` predicate, which must be a plain boolean.
 */
import { spawnSync } from 'node:child_process';

/**
 * Resolve a Python interpreter for tests using a synchronous, side-effect-free probe.
 * Honors TYWRAP_CODEC_PYTHON, then falls back to the conventional names.
 * Returns the working interpreter path/name, or null if none responds.
 */
export function resolvePythonForTests(): string | null {
  const explicit = process.env.TYWRAP_CODEC_PYTHON?.trim();
  const candidates = explicit ? [explicit] : ['python3', 'python'];
  for (const candidate of candidates) {
    const res = spawnSync(candidate, ['--version'], { encoding: 'utf-8' });
    if (res.status === 0) {
      return candidate;
    }
  }
  return null;
}

/** The resolved interpreter (or null), computed once at load. */
export const PYTHON: string | null = resolvePythonForTests();

/** True when a usable Python interpreter is available. */
export const PYTHON_AVAILABLE: boolean = PYTHON !== null;

/** True when a specifically-named interpreter binary responds to --version. */
export function hasPythonBinary(binary: string): boolean {
  const res = spawnSync(binary, ['--version'], { encoding: 'utf-8' });
  return res.status === 0;
}

/** True when the named Python module can be imported by the resolved interpreter. */
export function hasPythonModule(moduleName: string): boolean {
  if (PYTHON === null) return false;
  const res = spawnSync(PYTHON, ['-c', `import ${moduleName}`], { encoding: 'utf-8' });
  return res.status === 0;
}

/**
 * True when the named single-line Python expression prints "1".
 * Used for feature gates such as "pydantic v2 has model_dump".
 */
export function pythonExprTruthy(expr: string): boolean {
  if (PYTHON === null) return false;
  const res = spawnSync(PYTHON, ['-c', expr], { encoding: 'utf-8', timeout: 10_000 });
  return res.status === 0 && String(res.stdout).trim() === '1';
}
