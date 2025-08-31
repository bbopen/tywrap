import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI_PATH = join(__dirname, '../dist/cli.js');

describe('CLI', () => {
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
});

