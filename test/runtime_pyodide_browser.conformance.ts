import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { chromium } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd());
const tempRoot = mkdtempSync(join(tmpdir(), 'tywrap-pyodide-browser-'));

function isInside(child: string, parent: string): boolean {
  const relation = relative(resolve(parent), resolve(child));
  return (
    relation === '' ||
    (!isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`))
  );
}

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.wasm')) return 'application/wasm';
  if (path.endsWith('.data')) return 'application/octet-stream';
  return 'application/octet-stream';
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  try {
    await execFileAsync(command, args, { cwd, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
  } catch (error: unknown) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number | string };
    throw new Error(
      `${command} ${args.join(' ')} failed (${String(failure.code ?? 'unknown')}):\n` +
        `stdout:\n${failure.stdout ?? ''}\nstderr:\n${failure.stderr ?? ''}`,
      { cause: error }
    );
  }
}

function createStaticServer(compiled: string): Promise<{ server: Server; origin: string }> {
  return new Promise((resolveServer, reject) => {
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html>
<script type="importmap">{"imports":{"pyodide":"/pyodide/pyodide.mjs","tywrap/runtime":"/dist/runtime/index.js"}}</script>`);
        return;
      }

      const roots: Array<[prefix: string, root: string]> = [
        ['/dist/', join(repoRoot, 'dist')],
        ['/pyodide/', join(repoRoot, 'node_modules', 'pyodide')],
        ['/generated/', compiled],
      ];
      const route = roots.find(([prefix]) => path.startsWith(prefix));
      if (!route) {
        response.writeHead(404).end();
        return;
      }
      const [prefix, root] = route;
      const target = resolve(root, decodeURIComponent(path.slice(prefix.length)));
      if (!isInside(target, root)) {
        response.writeHead(403).end();
        return;
      }
      try {
        response.writeHead(200, { 'content-type': contentType(target) });
        response.end(readFileSync(target));
      } catch {
        response.writeHead(404).end();
      }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('browser smoke server has no TCP address'));
        return;
      }
      resolveServer({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe('real browser PyodideBridge', () => {
  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('loads the pinned local runtime and executes an actual generated wrapper in Chromium', async () => {
    const generated = join(tempRoot, 'source');
    const compiled = join(tempRoot, 'compiled');
    symlinkSync(join(repoRoot, 'node_modules'), join(tempRoot, 'node_modules'), 'dir');
    await run(
      process.execPath,
      [
        join(repoRoot, 'dist', 'cli.js'),
        'generate',
        '--modules',
        'math',
        '--runtime',
        'pyodide',
        '--output-dir',
        generated,
      ],
      repoRoot
    );
    await run(
      process.execPath,
      [
        join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js'),
        '--ignoreConfig',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'bundler',
        '--skipLibCheck',
        '--outDir',
        compiled,
        join(generated, 'math.generated.ts'),
      ],
      repoRoot
    );

    const { server, origin } = await createStaticServer(compiled);
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(origin);
      const result = await page.evaluate(async pyodideURL => {
        const { PyodideBridge } = await import('/dist/runtime/pyodide.js');
        const { clearRuntimeBridge, setRuntimeBridge } = await import('/dist/runtime/index.js');
        const math = await import('/generated/math.generated.js');
        const bridge = new PyodideBridge({ indexURL: `${pyodideURL}/pyodide/` });
        setRuntimeBridge({
          call: bridge.call.bind(bridge),
          dispose: bridge.dispose.bind(bridge),
        });
        try {
          return {
            result: await math.sqrt(81),
            pythonVersion: await bridge.call('sys', 'version', []),
          };
        } finally {
          clearRuntimeBridge();
          await bridge.dispose();
        }
      }, origin);
      expect(result).toMatchObject({ result: 9 });
      expect(result.pythonVersion).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await browser?.close();
      await new Promise<void>((resolveClose, reject) =>
        server.close(error => (error ? reject(error) : resolveClose()))
      );
    }
  }, 240_000);
});
