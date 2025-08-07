#!/usr/bin/env node
import type { TywrapOptions } from './types/index.js';
import { generate } from './tywrap.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Prefer JSON config by default in dist builds to avoid TS loader requirements
  let configPath = './tywrap.config.json';
  let useCache: boolean | undefined;
  let modulesList: string | undefined;
  let pythonPath: string | undefined;
  let outputDir: string | undefined;
  let declarationFlag: boolean | undefined;
  let sourceMapFlag: boolean | undefined;
  let failOnWarn = false;
  // Parse args without index-based access to satisfy security rules
  const queue = [...args];
  while (queue.length > 0) {
    const a = queue.shift() as string;
    if (a === '-c' || a === '--config') {
      const val = queue.shift();
      if (typeof val === 'string') {
        configPath = val;
      }
    } else if (a === '--use-cache') {
      useCache = true;
    } else if (a === '--no-cache') {
      useCache = false;
    } else if (a === '--modules') {
      const val = queue.shift();
      if (typeof val === 'string') {
        modulesList = val;
      }
    } else if (a === '--python') {
      const val = queue.shift();
      if (typeof val === 'string') {
        pythonPath = val;
      }
    } else if (a === '--output-dir') {
      const val = queue.shift();
      if (typeof val === 'string') {
        outputDir = val;
      }
    } else if (a === '--declaration') {
      declarationFlag = true;
    } else if (a === '--no-declaration') {
      declarationFlag = false;
    } else if (a === '--source-map') {
      sourceMapFlag = true;
    } else if (a === '--no-source-map') {
      sourceMapFlag = false;
    } else if (a === '--fail-on-warn') {
      failOnWarn = true;
    }
  }

  if (args[0] !== 'generate') {
    console.error(
      'Usage: tywrap generate [--config <path>] [--modules a,b,c] [--python <path>] [--output-dir <dir>] [--use-cache|--no-cache] [--fail-on-warn]'
    );
    process.exit(1);
  }

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
    if (outputDir) {
      options.output = {
        ...(options.output ?? {}),
        dir: outputDir,
        format: options.output?.format ?? 'esm',
        declaration: declarationFlag ?? options.output?.declaration ?? false,
        sourceMap: sourceMapFlag ?? options.output?.sourceMap ?? false,
      };
    }
    if (typeof declarationFlag === 'boolean' || typeof sourceMapFlag === 'boolean') {
      options.output = {
        ...(options.output ?? {
          dir: './generated',
          format: 'esm',
          declaration: false,
          sourceMap: false,
        }),
        declaration: declarationFlag ?? options.output?.declaration ?? false,
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
    // eslint-disable-next-line no-console
    console.log(`Generated: ${res.written.join(', ')}`);
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

main();
