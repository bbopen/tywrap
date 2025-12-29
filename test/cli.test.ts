import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CLI_PATH = join(__dirname, '../dist/cli.js');
const ensureCliBuild = (): void => {
  const srcPath = join(__dirname, '../src/cli.ts');
  if (existsSync(CLI_PATH)) {
    try {
      const distStat = statSync(CLI_PATH);
      const srcStat = statSync(srcPath);
      if (srcStat.mtimeMs <= distStat.mtimeMs) {
        return;
      }
    } catch {
      // fall through to rebuild
    }
  }
  const res = spawnSync('npm', ['run', 'build'], { encoding: 'utf-8' });
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || 'Failed to build CLI');
  }
};

describe('CLI', () => {
  beforeAll(() => {
    ensureCliBuild();
  });

  it('shows help when no command is provided', () => {
    const res = spawnSync('node', [CLI_PATH], { encoding: 'utf-8' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('Commands:');
  });

  it('errors on unknown options', () => {
    const res = spawnSync('node', [CLI_PATH, 'generate', '--unknown'], {
      encoding: 'utf-8',
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('Unknown argument: unknown');
  });

  it('initializes a config file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
    try {
      const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json', '--modules', 'math'], {
        encoding: 'utf-8',
        cwd: tempDir,
      });
      expect(res.status).toBe(0);

      const configPath = join(tempDir, 'tywrap.config.json');
      const content = readFileSync(configPath, 'utf-8');
      expect(content).toContain('"pythonModules"');
      expect(content).toContain('"math"');
      expect(content).toContain('"types"');
      expect(content).toContain('"presets"');
      expect(content).toContain('"stdlib"');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
