import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { NodeBridge } from '../src/runtime/node.js';
import { clearRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';
import { resolvePythonExecutable } from '../src/utils/python.js';
import { isNodejs, getPythonExecutableName } from '../src/utils/runtime.js';

const CLI_PATH = join(process.cwd(), 'dist', 'cli.js');
const BRIDGE_SCRIPT = 'runtime/python_bridge.py';
const describeNodeOnly = isNodejs() ? describe : describe.skip;
const isCi =
  ['1', 'true'].includes((process.env.CI ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.GITHUB_ACTIONS ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.ACT ?? '').toLowerCase());
const bridgeTimeoutMs = isCi ? 60000 : 30000;
const e2eTimeoutMs = isCi ? 120000 : 60000;

const resolvePythonForTest = async (): Promise<string | null> => {
  const candidates = new Set<string>();
  try {
    candidates.add(await resolvePythonExecutable());
  } catch {
    // ignore
  }
  candidates.add(getPythonExecutableName());
  candidates.add('python');

  for (const candidate of candidates) {
    if (!candidate) continue;
    const res = spawnSync(candidate, ['--version'], { encoding: 'utf-8' });
    if (res.status === 0) {
      return candidate;
    }
  }
  return null;
};

describeNodeOnly('E2E Smoke - CLI generate + runtime bridge', () => {
  let tempDir: string | undefined;
  let bridge: NodeBridge | undefined;

  beforeAll(() => {
    if (!existsSync(CLI_PATH)) {
      console.warn('dist/cli.js not found; skipping E2E CLI test');
    }
  });

  afterAll(async () => {
    if (bridge) {
      await bridge.dispose();
    }
    clearRuntimeBridge();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it(
    'generates wrappers and calls class methods through the runtime bridge',
    async () => {
      const pythonPath = await resolvePythonForTest();
      if (!pythonPath || !existsSync(BRIDGE_SCRIPT) || !existsSync(CLI_PATH)) return;

      const baseDir = join(process.cwd(), '.tywrap');
      mkdirSync(baseDir, { recursive: true });
      tempDir = mkdtempSync(join(baseDir, 'e2e-'));

      const moduleName = 'smoke_mod';
      const modulePath = join(tempDir, `${moduleName}.py`);
      writeFileSync(
        modulePath,
        [
          'class Greeter:',
          '    def __init__(self, name: str):',
          '        self.name = name',
          '',
          '    def greet(self, suffix: str = "!") -> str:',
          '        return f"Hello, {self.name}{suffix}"',
          '',
          'def add(a: int, b: int) -> int:',
          '    return a + b',
          '',
        ].join('\n'),
        'utf-8'
      );

      const outputDir = join(tempDir, 'generated');
      const configPath = join(tempDir, 'tywrap.config.json');
      const config = {
        pythonModules: {
          [moduleName]: { runtime: 'node', typeHints: 'strict' },
        },
        output: { dir: outputDir, format: 'esm', declaration: false, sourceMap: false },
        runtime: { node: { pythonPath } },
        performance: { caching: false, batching: false, compression: 'none' },
        development: { hotReload: false, sourceMap: false, validation: 'none' },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

      const existingPyPath = process.env.PYTHONPATH;
      const mergedPyPath = existingPyPath
        ? `${tempDir}${delimiter}${existingPyPath}`
        : tempDir;
      const env = { ...process.env, PYTHONPATH: mergedPyPath };

      const res = spawnSync(
        'node',
        [CLI_PATH, 'generate', '--config', configPath, '--fail-on-warn'],
        { encoding: 'utf-8', env }
      );
      if (res.status !== 0) {
        throw new Error(res.stderr || res.stdout || 'CLI generate failed');
      }

      const generatedPath = join(outputDir, `${moduleName}.generated.ts`);
      expect(existsSync(generatedPath)).toBe(true);

      bridge = new NodeBridge({
        scriptPath: BRIDGE_SCRIPT,
        pythonPath,
        env: { PYTHONPATH: mergedPyPath },
        timeoutMs: bridgeTimeoutMs,
      });

      setRuntimeBridge({
        call: bridge.call.bind(bridge),
        instantiate: bridge.instantiate.bind(bridge),
        callMethod: bridge.callMethod.bind(bridge),
        disposeInstance: bridge.disposeInstance.bind(bridge),
        dispose: bridge.dispose.bind(bridge),
      });

      const mod = (await import(pathToFileURL(generatedPath).href)) as {
        add: (a: number, b: number) => Promise<number>;
        Greeter: {
          create: (name: string) => Promise<{
            greet: (suffix?: string) => Promise<string>;
            disposeHandle: () => Promise<void>;
          }>;
        };
      };

      const sum = await mod.add(2, 3);
      expect(sum).toBe(5);

      const greeter = await mod.Greeter.create('Tywrap');
      const greeting = await greeter.greet('!');
      expect(greeting).toBe('Hello, Tywrap!');
      await greeter.disposeHandle();
    },
    e2eTimeoutMs
  );
});
