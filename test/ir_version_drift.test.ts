import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against IR_VERSION drift between the Python and TypeScript sources.
 *
 * Both values are read statically (regex over source text) rather than imported,
 * so this test runs without a Python interpreter and without pulling tywrap.ts'
 * dependency graph into the test process. The single sources are:
 *   - Python: tywrap_ir/tywrap_ir/__init__.py  (IR_VERSION = "...")
 *   - TypeScript: src/tywrap.ts                (const TYWRAP_IR_VERSION = '...')
 */

const repoRoot = process.cwd();

function readVersion(relPath: string, pattern: RegExp, label: string): string {
  const filePath = join(repoRoot, relPath);
  const content = readFileSync(filePath, 'utf8');
  const match = pattern.exec(content);
  if (!match?.[1]) {
    throw new Error(`Could not find ${label} in ${relPath}`);
  }
  return match[1];
}

describe('IR_VERSION drift', () => {
  it('matches between the Python source of truth and the TypeScript constant', () => {
    const pythonVersion = readVersion(
      join('tywrap_ir', 'tywrap_ir', '__init__.py'),
      /^IR_VERSION\s*=\s*["']([^"']+)["']/m,
      'IR_VERSION'
    );
    const tsVersion = readVersion(
      join('src', 'tywrap.ts'),
      /\bTYWRAP_IR_VERSION\s*=\s*["']([^"']+)["']/,
      'TYWRAP_IR_VERSION'
    );

    expect(tsVersion).toBe(pythonVersion);
  });
});
