#!/usr/bin/env node
import yargs, { type Argv, type ArgumentsCamelCase } from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { TywrapOptions } from './types/index.js';

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .command(
      'generate',
      'Generate TypeScript wrappers',
      (y: Argv) =>
        y
          .option('config', {
            alias: 'c',
            type: 'string',
            default: './tywrap.config.json',
            describe: 'Path to config file',
          })
          .option('modules', {
            type: 'string',
            describe: 'Comma-separated list of Python modules to wrap',
          })
          .option('python', {
            type: 'string',
            describe: 'Path to Python executable',
          })
          .option('output-dir', {
            type: 'string',
            describe: 'Directory for generated wrappers',
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
          .option('fail-on-warn', {
            type: 'boolean',
            default: false,
            describe: 'Exit with code 2 if generation emits warnings',
          })
          .strict(),
      async (
        argv: ArgumentsCamelCase<{
          config: string;
          modules?: string;
          python?: string;
          outputDir?: string;
          declaration?: boolean;
          sourceMap?: boolean;
          useCache?: boolean;
          failOnWarn: boolean;
        }>
      ) => {
        const configPath = argv.config;
        const modulesList = argv.modules;
        const pythonPath = argv.python;
        const outputDir = argv.outputDir;
        const declarationFlag = argv.declaration;
        const sourceMapFlag = argv.sourceMap;
        const useCache = argv.useCache;
        const failOnWarn = argv.failOnWarn;

        const { generate } = await import('./tywrap.js');

        try {
          // Support JS/TS/JSON configs via dynamic import; Node with ts-node/transpiled preferred for TS
          let options: Partial<TywrapOptions>;
          if (configPath.endsWith('.json')) {
            const { readFile } = await import('fs/promises');
            const txt = await readFile(configPath, 'utf-8');
            options = JSON.parse(txt) as Partial<TywrapOptions>;
          } else {
            const mod = await import(configPath);
            const loaded = (mod as Record<string, unknown>).default ?? mod;
            options = (loaded ?? {}) as Partial<TywrapOptions>;
          }

          // Override options via flags
          if (modulesList) {
            const names = modulesList
              .split(',')
              .map(s => s.trim())
              .filter(Boolean);
            options.pythonModules = Object.fromEntries(
              names.map(n => [n, { runtime: 'node', typeHints: 'strict' }])
            );
          }
          if (outputDir || typeof declarationFlag === 'boolean' || typeof sourceMapFlag === 'boolean') {
            options.output = {
              ...(options.output ?? {
                dir: './generated',
                format: 'esm',
                declaration: false,
                sourceMap: false,
              }),
              ...(outputDir ? { dir: outputDir } : {}),
              declaration:
                declarationFlag ?? options.output?.declaration ?? false,
              sourceMap: sourceMapFlag ?? options.output?.sourceMap ?? false,
            };
          }
          if (typeof useCache === 'boolean') {
            options.performance = {
              ...(options.performance ?? {}),
              caching: useCache,
              batching: options.performance?.batching ?? false,
              compression: options.performance?.compression ?? 'none',
            };
          }
          if (pythonPath) {
            options.runtime = {
              ...(options.runtime ?? {}),
              node: { ...(options.runtime?.node ?? {}), pythonPath },
            };
          }

          const res = await generate(options);
          process.stdout.write(`Generated: ${res.written.join(', ')}\n`);
          if (failOnWarn && res.warnings.length > 0) {
            console.error(
              `Warnings encountered (count ${res.warnings.length}). Failing due to --fail-on-warn.`
            );
            process.exit(2);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('Generation failed:', message);
          process.exit(1);
        }
      }
    )
    .demandCommand(1, 'Please specify a command')
    .strict()
    .help().argv;
}

main();

