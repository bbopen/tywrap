#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import yargs, { type Argv, type ArgumentsCamelCase } from 'yargs';
import { hideBin } from 'yargs/helpers';

import { resolveConfig, type ResolveConfigOptions } from './config/index.js';
import type { RuntimeStrategy, TywrapOptions } from './types/index.js';
import { getComponentLogger } from './utils/logger.js';

const log = getComponentLogger('CLI');

const DEFAULT_CONFIG_FILES = [
  'tywrap.config.ts',
  'tywrap.config.mts',
  'tywrap.config.js',
  'tywrap.config.mjs',
  'tywrap.config.cjs',
  'tywrap.config.json',
];

function resolveConfigPath(explicitPath?: string): { configPath?: string; explicit: boolean } {
  const cwd = process.cwd();
  if (explicitPath) {
    const resolved = resolve(cwd, explicitPath);
    return { configPath: resolved, explicit: true };
  }
  for (const name of DEFAULT_CONFIG_FILES) {
    const candidate = resolve(cwd, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- config discovery uses user-controlled paths
    if (existsSync(candidate)) {
      return { configPath: candidate, explicit: false };
    }
  }
  return { configPath: undefined, explicit: false };
}

function parseModules(modulesList?: string): string[] {
  if (!modulesList) {
    return [];
  }
  return modulesList
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
}

function buildModulesConfig(
  modules: string[],
  runtime: RuntimeStrategy
): TywrapOptions['pythonModules'] {
  return Object.fromEntries(modules.map(name => [name, { runtime, typeHints: 'strict' }]));
}

function renderConfigTemplate(options: {
  format: 'ts' | 'json';
  modules: string[];
  runtime: RuntimeStrategy;
  outputDir: string;
}): string {
  const modules = options.modules.length > 0 ? options.modules : ['math'];
  if (options.format === 'json') {
    const config = {
      pythonModules: buildModulesConfig(modules, options.runtime),
      output: { dir: options.outputDir, format: 'esm', declaration: false, sourceMap: false },
      runtime: { node: { pythonPath: 'python3' } },
      types: { presets: ['stdlib'] },
    };
    return `${JSON.stringify(config, null, 2)}\n`;
  }

  const moduleLines = modules
    .map(
      name => `    ${JSON.stringify(name)}: { runtime: '${options.runtime}', typeHints: 'strict' },`
    )
    .join('\n');
  return `import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
${moduleLines}
  },
  output: {
    dir: '${options.outputDir}',
    format: 'esm',
    declaration: false,
    sourceMap: false
  },
  runtime: {
    node: {
      pythonPath: 'python3'
    }
  },
  types: {
    presets: ['stdlib']
  }
});
`;
}

async function addRecommendedScriptsToPackageJson(cwd: string): Promise<void> {
  const packageJsonPath = resolve(cwd, 'package.json');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from cwd
  if (!existsSync(packageJsonPath)) {
    return;
  }
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from cwd
    const raw = await readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const scripts =
      typeof pkg.scripts === 'object' && pkg.scripts !== null && !Array.isArray(pkg.scripts)
        ? (pkg.scripts as Record<string, unknown>)
        : {};
    const nextScripts: Record<string, unknown> = { ...scripts };
    let changed = false;

    if (nextScripts['tywrap:generate'] === undefined) {
      nextScripts['tywrap:generate'] = 'tywrap generate';
      changed = true;
    }
    if (nextScripts['tywrap:check'] === undefined) {
      nextScripts['tywrap:check'] = 'tywrap generate --check';
      changed = true;
    }

    if (!changed) {
      return;
    }

    pkg.scripts = nextScripts;
    const out = `${JSON.stringify(pkg, null, 2)}\n`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is derived from cwd
    await writeFile(packageJsonPath, out, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Failed to update package.json scripts', { error: message });
  }
}

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .scriptName('tywrap')
    .command(
      'generate',
      'Generate TypeScript wrappers',
      (y: Argv) =>
        y
          .option('config', {
            alias: 'c',
            type: 'string',
            describe: 'Path to config file (defaults to tywrap.config.* if present)',
          })
          .option('modules', {
            type: 'string',
            describe: 'Comma-separated list of Python modules to wrap',
          })
          .option('runtime', {
            type: 'string',
            choices: ['node', 'pyodide', 'http', 'auto'],
            default: 'node',
            describe: 'Runtime to use when --modules is provided',
          })
          .option('python', {
            type: 'string',
            describe: 'Path to Python executable',
          })
          .option('output-dir', {
            type: 'string',
            describe: 'Directory for generated wrappers',
          })
          .option('format', {
            type: 'string',
            choices: ['esm', 'cjs', 'both'],
            describe: 'Output module format',
          })
          .option('declaration', {
            type: 'boolean',
            describe: 'Emit TypeScript declaration files',
          })
          .option('source-map', {
            type: 'boolean',
            describe: 'Emit source maps for generated files',
          })
          .option('use-cache', {
            alias: 'cache',
            type: 'boolean',
            describe: 'Enable on-disk caching (use --no-cache to disable)',
          })
          .option('debug', {
            type: 'boolean',
            describe: 'Enable debug logging',
          })
          .option('fail-on-warn', {
            type: 'boolean',
            default: false,
            describe: 'Exit with code 2 if generation emits warnings',
          })
          .option('check', {
            type: 'boolean',
            default: false,
            describe: 'Check whether generated wrappers are up to date without writing files',
          })
          .strict(),
      async (
        argv: ArgumentsCamelCase<{
          config?: string;
          modules?: string;
          runtime: RuntimeStrategy;
          python?: string;
          outputDir?: string;
          format?: 'esm' | 'cjs' | 'both';
          declaration?: boolean;
          sourceMap?: boolean;
          useCache?: boolean;
          debug?: boolean;
          failOnWarn: boolean;
          check: boolean;
        }>
      ) => {
        const { configPath, explicit } = resolveConfigPath(argv.config);
        const modules = parseModules(argv.modules);

        const overrides: NonNullable<ResolveConfigOptions['overrides']> = {};
        if (modules.length > 0) {
          overrides.pythonModules = buildModulesConfig(modules, argv.runtime);
        }

        if (
          argv.outputDir ||
          argv.format ||
          typeof argv.declaration === 'boolean' ||
          typeof argv.sourceMap === 'boolean'
        ) {
          overrides.output = {
            ...(argv.outputDir ? { dir: argv.outputDir } : {}),
            ...(argv.format ? { format: argv.format } : {}),
            ...(typeof argv.declaration === 'boolean' ? { declaration: argv.declaration } : {}),
            ...(typeof argv.sourceMap === 'boolean' ? { sourceMap: argv.sourceMap } : {}),
          };
        }

        if (typeof argv.useCache === 'boolean') {
          overrides.performance = {
            caching: argv.useCache,
          };
        }

        if (argv.python) {
          overrides.runtime = {
            node: { pythonPath: argv.python },
          };
        }

        if (typeof argv.debug === 'boolean') {
          overrides.debug = argv.debug;
        }

        if (!configPath && modules.length === 0) {
          log.error(
            'No config file found and no modules provided. Create a config with `tywrap init` or pass --modules.'
          );
          process.exit(1);
        }

        const { generate } = await import('./tywrap.js');

        try {
          const options = await resolveConfig({
            configFile: configPath,
            overrides,
            requireConfig: explicit,
          });

          if (!options.pythonModules || Object.keys(options.pythonModules).length === 0) {
            log.error('No pythonModules configured. Use --modules or update your config.');
            process.exit(1);
          }

          const res = await generate(options, { check: argv.check });
          if (argv.check) {
            const outOfDate = res.outOfDate ?? [];
            if (outOfDate.length === 0) {
              process.stdout.write('Generated wrappers are up to date.\n');
            } else {
              process.stderr.write('Generated wrappers are out of date:\n');
              for (const file of outOfDate) {
                process.stderr.write(`- ${file}\n`);
              }
              process.stderr.write('\nRun `tywrap generate` to update.\n');
              if (!(argv.failOnWarn && res.warnings.length > 0)) {
                process.exit(3);
              }
            }
          } else {
            process.stdout.write(`Generated: ${res.written.join(', ')}\n`);
          }
          if (argv.failOnWarn && res.warnings.length > 0) {
            log.error(
              `Warnings encountered (count ${res.warnings.length}). Failing due to --fail-on-warn.`
            );
            process.exit(2);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log.error('Generation failed', { error: message });
          process.exit(1);
        }
      }
    )
    .command(
      'init',
      'Create a starter tywrap.config file',
      (y: Argv) =>
        y
          .option('config', {
            alias: 'c',
            type: 'string',
            describe: 'Path for the new config file',
          })
          .option('format', {
            type: 'string',
            choices: ['ts', 'json'],
            default: 'ts',
            describe: 'Config file format',
          })
          .option('modules', {
            type: 'string',
            describe: 'Comma-separated list of Python modules to wrap',
          })
          .option('runtime', {
            type: 'string',
            choices: ['node', 'pyodide', 'http', 'auto'],
            default: 'node',
            describe: 'Runtime for generated module entries',
          })
          .option('output-dir', {
            type: 'string',
            default: './generated',
            describe: 'Output directory for generated wrappers',
          })
          .option('force', {
            type: 'boolean',
            default: false,
            describe: 'Overwrite existing config file',
          })
          .option('scripts', {
            type: 'boolean',
            default: true,
            describe:
              'Add recommended tywrap scripts to package.json (use --no-scripts to disable)',
          })
          .strict(),
      async (
        argv: ArgumentsCamelCase<{
          config?: string;
          format: 'ts' | 'json';
          modules?: string;
          runtime: RuntimeStrategy;
          outputDir: string;
          force: boolean;
          scripts: boolean;
        }>
      ) => {
        const modules = parseModules(argv.modules);
        const defaultName = argv.format === 'json' ? 'tywrap.config.json' : 'tywrap.config.ts';
        const targetPath = resolve(process.cwd(), argv.config ?? defaultName);

        // eslint-disable-next-line security/detect-non-literal-fs-filename -- config path is user-controlled
        if (!argv.force && existsSync(targetPath)) {
          log.error('Config file already exists. Use --force to overwrite.', { path: targetPath });
          process.exit(1);
        }

        const content = renderConfigTemplate({
          format: argv.format,
          modules,
          runtime: argv.runtime,
          outputDir: argv.outputDir,
        });

        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- config path is user-controlled
          await writeFile(targetPath, content, 'utf-8');
          process.stdout.write(`Created ${targetPath}\n`);
          if (argv.scripts) {
            await addRecommendedScriptsToPackageJson(process.cwd());
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log.error('Failed to write config', { error: message });
          process.exit(1);
        }
      }
    )
    .demandCommand(1, 'Please specify a command')
    .strict()
    .help()
    .version()
    .parse();
}

main().catch(err => {
  log.error('Unexpected error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
