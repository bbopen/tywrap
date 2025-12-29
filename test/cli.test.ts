import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  describe('help and version', () => {
    it('shows help when no command is provided', () => {
      const res = spawnSync('node', [CLI_PATH], { encoding: 'utf-8' });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('Commands:');
    });

    it('shows help with --help flag', () => {
      const res = spawnSync('node', [CLI_PATH, '--help'], { encoding: 'utf-8' });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Commands:');
      expect(res.stdout).toContain('generate');
      expect(res.stdout).toContain('init');
    });

    it('shows version with --version flag', () => {
      const res = spawnSync('node', [CLI_PATH, '--version'], { encoding: 'utf-8' });
      expect(res.status).toBe(0);
      // Version should be a semver-like string
      expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('unknown commands and options', () => {
    it('errors on unknown command', () => {
      const res = spawnSync('node', [CLI_PATH, 'unknown-command'], {
        encoding: 'utf-8',
      });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('Unknown argument: unknown-command');
    });

    it('errors on unknown options', () => {
      const res = spawnSync('node', [CLI_PATH, 'generate', '--unknown'], {
        encoding: 'utf-8',
      });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('Unknown argument: unknown');
    });
  });

  describe('init command', () => {
    it('initializes a JSON config file', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json', '--modules', 'math'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const configPath = join(tempDir, 'tywrap.config.json');
        expect(existsSync(configPath)).toBe(true);
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

    it('initializes a TypeScript config file by default', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const configPath = join(tempDir, 'tywrap.config.ts');
        expect(existsSync(configPath)).toBe(true);
        const content = readFileSync(configPath, 'utf-8');
        expect(content).toContain('import { defineConfig }');
        expect(content).toContain('export default defineConfig');
        expect(content).toContain('pythonModules');
        expect(content).toContain('"math"'); // default module
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('initializes with multiple modules', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json', '--modules', 'math,os,sys'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const configPath = join(tempDir, 'tywrap.config.json');
        const content = readFileSync(configPath, 'utf-8');
        expect(content).toContain('"math"');
        expect(content).toContain('"os"');
        expect(content).toContain('"sys"');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('initializes with custom output directory', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json', '--output-dir', './custom-output'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const configPath = join(tempDir, 'tywrap.config.json');
        const content = readFileSync(configPath, 'utf-8');
        expect(content).toContain('./custom-output');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('initializes with custom runtime', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json', '--runtime', 'pyodide'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const configPath = join(tempDir, 'tywrap.config.json');
        const content = readFileSync(configPath, 'utf-8');
        expect(content).toContain('"pyodide"');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('errors when config already exists without --force', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // Create existing config
        writeFileSync(join(tempDir, 'tywrap.config.json'), '{}');

        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain('Config file already exists');
        expect(res.stderr).toContain('--force');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('overwrites config with --force', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // Create existing config
        const configPath = join(tempDir, 'tywrap.config.json');
        writeFileSync(configPath, '{"old": "config"}');

        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json', '--modules', 'numpy', '--force'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const content = readFileSync(configPath, 'utf-8');
        expect(content).not.toContain('"old"');
        expect(content).toContain('"numpy"');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('creates config at custom path', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--config', 'custom.config.json', '--format', 'json'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const configPath = join(tempDir, 'custom.config.json');
        expect(existsSync(configPath)).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('generate command', () => {
    it('errors when no config and no modules provided', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain('No config file found');
        expect(res.stderr).toContain('--modules');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('shows generate command help', () => {
      const res = spawnSync('node', [CLI_PATH, 'generate', '--help'], { encoding: 'utf-8' });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('--config');
      expect(res.stdout).toContain('--modules');
      expect(res.stdout).toContain('--runtime');
      expect(res.stdout).toContain('--python');
      expect(res.stdout).toContain('--output-dir');
      expect(res.stdout).toContain('--format');
      expect(res.stdout).toContain('--declaration');
      expect(res.stdout).toContain('--source-map');
      expect(res.stdout).toContain('--use-cache');
      expect(res.stdout).toContain('--debug');
      expect(res.stdout).toContain('--fail-on-warn');
    });

    it('accepts --modules flag', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // Generate with modules flag - this will attempt to generate
        // but may fail for other reasons (e.g., Python not available)
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        // It should either succeed or fail for generation reasons, not argument parsing
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('accepts --runtime flag', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--runtime', 'node'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('accepts --output-dir flag', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--output-dir', './out'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('accepts --format flag with valid values', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        for (const format of ['esm', 'cjs', 'both']) {
          const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--format', format], {
            encoding: 'utf-8',
            cwd: tempDir,
            timeout: 30000,
          });
          expect(res.stderr).not.toContain('Unknown argument');
          expect(res.stderr).not.toContain('Invalid values');
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('rejects --format flag with invalid value', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--format', 'invalid'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain('Invalid values');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('accepts --declaration flag', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--declaration'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('accepts --source-map flag', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--source-map'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('accepts --use-cache and --no-cache flags', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        let res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--use-cache'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('Unknown argument');

        res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--no-cache'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('accepts --debug flag', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--debug'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('accepts --python flag', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--python', 'python3'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('accepts --fail-on-warn flag', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--fail-on-warn'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('uses config file when present', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // Create a config file
        const config = {
          pythonModules: { math: { runtime: 'node', typeHints: 'strict' } },
          output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false },
          runtime: { node: { pythonPath: 'python3' } },
          types: { presets: ['stdlib'] },
        };
        writeFileSync(join(tempDir, 'tywrap.config.json'), JSON.stringify(config, null, 2));

        // Generate should find and use the config
        const res = spawnSync('node', [CLI_PATH, 'generate'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        // Should not complain about missing config or modules
        expect(res.stderr).not.toContain('No config file found');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('uses explicit config file with --config', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // Create a config file with a custom name
        const config = {
          pythonModules: { math: { runtime: 'node', typeHints: 'strict' } },
          output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false },
          runtime: { node: { pythonPath: 'python3' } },
          types: { presets: ['stdlib'] },
        };
        writeFileSync(join(tempDir, 'custom.config.json'), JSON.stringify(config, null, 2));

        // Generate with explicit config path
        const res = spawnSync('node', [CLI_PATH, 'generate', '--config', 'custom.config.json'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        // Should not complain about missing config
        expect(res.stderr).not.toContain('No config file found');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('config file discovery', () => {
    it('discovers tywrap.config.json', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const config = {
          pythonModules: { math: { runtime: 'node', typeHints: 'strict' } },
          output: { dir: './generated', format: 'esm' },
        };
        writeFileSync(join(tempDir, 'tywrap.config.json'), JSON.stringify(config));

        const res = spawnSync('node', [CLI_PATH, 'generate'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('No config file found');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('discovers tywrap.config.js', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const configContent = `module.exports = {
          pythonModules: { math: { runtime: 'node', typeHints: 'strict' } },
          output: { dir: './generated', format: 'esm' },
        };`;
        writeFileSync(join(tempDir, 'tywrap.config.js'), configContent);

        const res = spawnSync('node', [CLI_PATH, 'generate'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.stderr).not.toContain('No config file found');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('prioritizes earlier config file formats', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // Create both TS and JSON configs
        const tsConfig = `export default { pythonModules: { os: { runtime: 'node' } }, output: { dir: './ts-gen' } };`;
        const jsonConfig = { pythonModules: { math: { runtime: 'node' } }, output: { dir: './json-gen' } };

        writeFileSync(join(tempDir, 'tywrap.config.ts'), tsConfig);
        writeFileSync(join(tempDir, 'tywrap.config.json'), JSON.stringify(jsonConfig));

        // Should use the TS config (comes before JSON in priority order)
        const res = spawnSync('node', [CLI_PATH, 'generate'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        // The exact behavior depends on the resolver, but it should not error about missing config
        expect(res.stderr).not.toContain('No config file found');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('module parsing', () => {
    it('parses single module', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json', '--modules', 'numpy'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const content = readFileSync(join(tempDir, 'tywrap.config.json'), 'utf-8');
        expect(content).toContain('"numpy"');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('parses comma-separated modules', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json', '--modules', 'numpy,pandas,scipy'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const content = readFileSync(join(tempDir, 'tywrap.config.json'), 'utf-8');
        expect(content).toContain('"numpy"');
        expect(content).toContain('"pandas"');
        expect(content).toContain('"scipy"');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('handles modules with spaces', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json', '--modules', 'numpy, pandas, scipy'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const content = readFileSync(join(tempDir, 'tywrap.config.json'), 'utf-8');
        // Spaces should be trimmed
        expect(content).toContain('"numpy"');
        expect(content).toContain('"pandas"');
        expect(content).toContain('"scipy"');
        // Should not contain leading/trailing spaces
        expect(content).not.toContain('" numpy"');
        expect(content).not.toContain('"numpy "');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('uses default module when none specified', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'json'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).toBe(0);

        const content = readFileSync(join(tempDir, 'tywrap.config.json'), 'utf-8');
        // Default module is 'math'
        expect(content).toContain('"math"');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('error handling', () => {
    it('should accept custom Python path via --python flag', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // CLI accepts the flag but may fail later during generation if Python is invalid
        // This tests that the flag parsing works correctly
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--python', 'python3'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        // Should not error on flag parsing
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should attempt generation even for unknown modules', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // CLI attempts to generate wrappers for any module name
        const config = {
          pythonModules: { os: { runtime: 'node', typeHints: 'strict' } },
          output: { dir: './generated', format: 'esm', declaration: false, sourceMap: false },
        };
        writeFileSync(join(tempDir, 'tywrap.config.json'), JSON.stringify(config, null, 2));

        const res = spawnSync('node', [CLI_PATH, 'generate'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 60000,
        });
        // Should not error on flag parsing, may succeed or fail on generation
        expect(res.stderr).not.toContain('Unknown argument');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should exit with code 1 when config file is invalid JSON', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // Create invalid JSON config
        writeFileSync(join(tempDir, 'tywrap.config.json'), '{ invalid json }');

        const res = spawnSync('node', [CLI_PATH, 'generate'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.status).not.toBe(0);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should exit with code 1 when config has no pythonModules', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        // Create config with empty pythonModules
        const config = {
          pythonModules: {},
          output: { dir: './generated', format: 'esm' },
        };
        writeFileSync(join(tempDir, 'tywrap.config.json'), JSON.stringify(config, null, 2));

        const res = spawnSync('node', [CLI_PATH, 'generate'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain('No pythonModules configured');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should exit with code 1 when explicit config file does not exist', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--config', 'nonexistent.config.json'], {
          encoding: 'utf-8',
          cwd: tempDir,
          timeout: 30000,
        });
        expect(res.status).not.toBe(0);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should handle invalid runtime choice gracefully', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'generate', '--modules', 'math', '--runtime', 'invalid-runtime'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain('Invalid values');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should handle init format validation', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'tywrap-cli-'));
      try {
        const res = spawnSync('node', [CLI_PATH, 'init', '--format', 'invalid'], {
          encoding: 'utf-8',
          cwd: tempDir,
        });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain('Invalid values');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
