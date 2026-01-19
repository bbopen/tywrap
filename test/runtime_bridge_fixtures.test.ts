import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { NodeBridge } from '../src/runtime/node.js';
import { OptimizedNodeBridge } from '../src/runtime/optimized-node.js';
import { isNodejs, getPythonExecutableName } from '../src/utils/runtime.js';

const describeNodeOnly = isNodejs() ? describe : describe.skip;

const checkPythonAvailable = (): string | null => {
  const candidates = [getPythonExecutableName(), 'python3', 'python'];
  for (const candidate of candidates) {
    try {
      const res = spawnSync(candidate, ['--version'], { encoding: 'utf-8' });
      if (res.status === 0) {
        return candidate;
      }
    } catch {
      // continue
    }
  }
  return null;
};

describeNodeOnly('Bridge fixture parity', () => {
  let pythonPath: string | null;
  let nodeBridge: NodeBridge | null = null;
  let optimizedBridge: OptimizedNodeBridge | null = null;

  beforeAll(() => {
    pythonPath = checkPythonAvailable();
  });

  afterEach(async () => {
    if (nodeBridge) {
      await nodeBridge.dispose();
      nodeBridge = null;
    }
    if (optimizedBridge) {
      await optimizedBridge.dispose();
      optimizedBridge = null;
    }
  });

  const fixtures = [
    {
      script: 'invalid_json_bridge.py',
      pattern: /Invalid JSON/,
    },
    {
      script: 'oversized_line_bridge.py',
      pattern: /Response line exceeded/,
    },
  ];

  for (const fixture of fixtures) {
    it(`NodeBridge handles fixture ${fixture.script}`, async () => {
      if (!pythonPath) return;
      const scriptPath = join(process.cwd(), 'test', 'fixtures', fixture.script);
      if (!existsSync(scriptPath)) return;

      nodeBridge = new NodeBridge({ scriptPath, timeoutMs: 2000 });
      await expect(nodeBridge.call('math', 'sqrt', [4])).rejects.toThrow(fixture.pattern);
    });

    it(`OptimizedNodeBridge handles fixture ${fixture.script}`, async () => {
      if (!pythonPath) return;
      const scriptPath = join(process.cwd(), 'test', 'fixtures', fixture.script);
      if (!existsSync(scriptPath)) return;

      optimizedBridge = new OptimizedNodeBridge({
        scriptPath,
        minProcesses: 1,
        maxProcesses: 1,
        timeoutMs: 2000,
      });
      await optimizedBridge.init();
      await expect(optimizedBridge.call('math', 'sqrt', [4])).rejects.toThrow(fixture.pattern);
    });
  }
});
