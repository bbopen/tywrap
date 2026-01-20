import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { NodeBridge } from '../src/runtime/node.js';
// OptimizedNodeBridge is now an alias for NodeBridge with pool configuration
import { NodeBridge as OptimizedNodeBridge } from '../src/runtime/node.js';
import { BridgeDisposedError } from '../src/runtime/errors.js';
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

  // Protocol error fixtures - both bridges should reject with similar error patterns
  const errorFixtures = [
    {
      script: 'invalid_json_bridge.py',
      pattern: /Invalid JSON/,
      description: 'truncated JSON response',
    },
    {
      script: 'oversized_line_bridge.py',
      pattern: /Response line exceeded/,
      description: 'line exceeding maxLineLength',
    },
    {
      script: 'noisy_bridge.py',
      pattern: /Invalid JSON/,
      description: 'non-JSON noise on stdout',
    },
  ];

  for (const fixture of errorFixtures) {
    it(`NodeBridge handles ${fixture.description} (${fixture.script})`, async () => {
      if (!pythonPath) return;
      const scriptPath = join(process.cwd(), 'test', 'fixtures', fixture.script);
      if (!existsSync(scriptPath)) return;

      nodeBridge = new NodeBridge({ scriptPath, timeoutMs: 2000, pythonPath });
      await expect(nodeBridge.call('math', 'sqrt', [4])).rejects.toThrow(fixture.pattern);
    });

    it(`OptimizedNodeBridge handles ${fixture.description} (${fixture.script})`, async () => {
      if (!pythonPath) return;
      const scriptPath = join(process.cwd(), 'test', 'fixtures', fixture.script);
      if (!existsSync(scriptPath)) return;

      optimizedBridge = new OptimizedNodeBridge({
        scriptPath,
        minProcesses: 1,
        maxProcesses: 1,
        timeoutMs: 2000,
        pythonPath,
      });
      // Note: don't call init() explicitly - let call() trigger it, matching NodeBridge behavior
      await expect(optimizedBridge.call('math', 'sqrt', [4])).rejects.toThrow(fixture.pattern);
    });
  }

  // Fixtures that should work correctly (fragmented writes should reassemble)
  const workingFixtures = [
    {
      script: 'fragmented_bridge.py',
      description: 'fragmented JSON writes',
      expected: 42,
    },
  ];

  for (const fixture of workingFixtures) {
    it(`NodeBridge handles ${fixture.description} (${fixture.script})`, async () => {
      if (!pythonPath) return;
      const scriptPath = join(process.cwd(), 'test', 'fixtures', fixture.script);
      if (!existsSync(scriptPath)) return;

      nodeBridge = new NodeBridge({ scriptPath, timeoutMs: 2000, pythonPath });
      const result = await nodeBridge.call('math', 'sqrt', [4]);
      expect(result).toBe(fixture.expected);
    });

    it(`OptimizedNodeBridge handles ${fixture.description} (${fixture.script})`, async () => {
      if (!pythonPath) return;
      const scriptPath = join(process.cwd(), 'test', 'fixtures', fixture.script);
      if (!existsSync(scriptPath)) return;

      optimizedBridge = new OptimizedNodeBridge({
        scriptPath,
        minProcesses: 1,
        maxProcesses: 1,
        timeoutMs: 2000,
        pythonPath,
      });
      const result = await optimizedBridge.call('math', 'sqrt', [4]);
      expect(result).toBe(fixture.expected);
    });
  }
});

describeNodeOnly('Bridge behavior parity', () => {
  let pythonPath: string | null;
  const defaultScriptPath = join(process.cwd(), 'runtime', 'python_bridge.py');

  beforeAll(() => {
    pythonPath = checkPythonAvailable();
  });

  describe('dispose behavior', () => {
    it('NodeBridge throws BridgeDisposedError after dispose', async () => {
      if (!pythonPath) return;
      const bridge = new NodeBridge({ scriptPath: defaultScriptPath, pythonPath });

      // Initialize and verify it works
      const result = await bridge.call('math', 'sqrt', [4]);
      expect(result).toBe(2);

      // Dispose
      await bridge.dispose();

      // Should throw BridgeDisposedError
      await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow(BridgeDisposedError);
    });

    it('OptimizedNodeBridge throws BridgeDisposedError after dispose', async () => {
      if (!pythonPath) return;
      const bridge = new OptimizedNodeBridge({
        scriptPath: defaultScriptPath,
        minProcesses: 1,
        maxProcesses: 1,
        pythonPath,
      });

      // Initialize and verify it works
      const result = await bridge.call('math', 'sqrt', [4]);
      expect(result).toBe(2);

      // Dispose
      await bridge.dispose();

      // Should throw BridgeDisposedError
      await expect(bridge.call('math', 'sqrt', [4])).rejects.toThrow(BridgeDisposedError);
    });

    it('Both bridges are safe to dispose multiple times', async () => {
      if (!pythonPath) return;

      const nodeBridge = new NodeBridge({ scriptPath: defaultScriptPath, pythonPath });
      await nodeBridge.call('math', 'sqrt', [4]);
      await nodeBridge.dispose();
      await expect(nodeBridge.dispose()).resolves.toBeUndefined();

      const optimizedBridge = new OptimizedNodeBridge({
        scriptPath: defaultScriptPath,
        minProcesses: 1,
        maxProcesses: 1,
        pythonPath,
      });
      await optimizedBridge.call('math', 'sqrt', [4]);
      await optimizedBridge.dispose();
      await expect(optimizedBridge.dispose()).resolves.toBeUndefined();
    });
  });

  describe('getBridgeInfo parity', () => {
    it('Both bridges return consistent BridgeInfo structure', async () => {
      if (!pythonPath) return;

      const nodeBridge = new NodeBridge({ scriptPath: defaultScriptPath, pythonPath });
      const optimizedBridge = new OptimizedNodeBridge({
        scriptPath: defaultScriptPath,
        minProcesses: 1,
        maxProcesses: 1,
        pythonPath,
      });

      try {
        const nodeInfo = await nodeBridge.getBridgeInfo();
        const optimizedInfo = await optimizedBridge.getBridgeInfo();

        // Both should have the same protocol structure
        expect(nodeInfo.protocol).toBe(optimizedInfo.protocol);
        expect(nodeInfo.protocolVersion).toBe(optimizedInfo.protocolVersion);
        expect(nodeInfo.bridge).toBe(optimizedInfo.bridge);

        // Both should have Python version info
        expect(typeof nodeInfo.pythonVersion).toBe('string');
        expect(typeof optimizedInfo.pythonVersion).toBe('string');

        // Both should have PID (positive integer)
        expect(nodeInfo.pid).toBeGreaterThan(0);
        expect(optimizedInfo.pid).toBeGreaterThan(0);
      } finally {
        await nodeBridge.dispose();
        await optimizedBridge.dispose();
      }
    });

    it('getBridgeInfo refresh option works for both bridges', async () => {
      if (!pythonPath) return;

      const nodeBridge = new NodeBridge({ scriptPath: defaultScriptPath, pythonPath });
      const optimizedBridge = new OptimizedNodeBridge({
        scriptPath: defaultScriptPath,
        minProcesses: 1,
        maxProcesses: 1,
        pythonPath,
      });

      try {
        // Get initial info
        const nodeInfo1 = await nodeBridge.getBridgeInfo();
        const optimizedInfo1 = await optimizedBridge.getBridgeInfo();

        // Get cached info (should be same)
        const nodeInfo2 = await nodeBridge.getBridgeInfo();
        const optimizedInfo2 = await optimizedBridge.getBridgeInfo();

        expect(nodeInfo1.pid).toBe(nodeInfo2.pid);
        expect(optimizedInfo1.pid).toBe(optimizedInfo2.pid);

        // Refresh should still work (same process, same info)
        const nodeInfo3 = await nodeBridge.getBridgeInfo({ refresh: true });
        const optimizedInfo3 = await optimizedBridge.getBridgeInfo({ refresh: true });

        expect(nodeInfo3.protocol).toBe(nodeInfo1.protocol);
        expect(optimizedInfo3.protocol).toBe(optimizedInfo1.protocol);
      } finally {
        await nodeBridge.dispose();
        await optimizedBridge.dispose();
      }
    });
  });

  describe('script path validation parity', () => {
    it('Both bridges throw on nonexistent script path', async () => {
      if (!pythonPath) return;

      const invalidPath = '/nonexistent/path/to/bridge.py';

      const nodeBridge = new NodeBridge({ scriptPath: invalidPath, pythonPath });
      const optimizedBridge = new OptimizedNodeBridge({
        scriptPath: invalidPath,
        minProcesses: 1,
        maxProcesses: 1,
        pythonPath,
      });

      try {
        await expect(nodeBridge.call('math', 'sqrt', [4])).rejects.toThrow(/not found/);
        await expect(optimizedBridge.call('math', 'sqrt', [4])).rejects.toThrow(/not found/);
      } finally {
        await nodeBridge.dispose();
        await optimizedBridge.dispose();
      }
    });
  });

  describe('basic functionality parity', () => {
    it('Both bridges handle simple function calls identically', async () => {
      if (!pythonPath) return;

      const nodeBridge = new NodeBridge({ scriptPath: defaultScriptPath, pythonPath });
      const optimizedBridge = new OptimizedNodeBridge({
        scriptPath: defaultScriptPath,
        minProcesses: 1,
        maxProcesses: 1,
        pythonPath,
      });

      try {
        const nodeResult = await nodeBridge.call('math', 'sqrt', [16]);
        const optimizedResult = await optimizedBridge.call('math', 'sqrt', [16]);

        expect(nodeResult).toBe(4);
        expect(optimizedResult).toBe(4);
        expect(nodeResult).toBe(optimizedResult);
      } finally {
        await nodeBridge.dispose();
        await optimizedBridge.dispose();
      }
    });

    it('Both bridges handle multiple sequential calls', async () => {
      if (!pythonPath) return;

      const nodeBridge = new NodeBridge({ scriptPath: defaultScriptPath, pythonPath });
      const optimizedBridge = new OptimizedNodeBridge({
        scriptPath: defaultScriptPath,
        minProcesses: 1,
        maxProcesses: 1,
        pythonPath,
      });

      try {
        for (let i = 1; i <= 5; i++) {
          const nodeResult = await nodeBridge.call('math', 'sqrt', [i * i]);
          const optimizedResult = await optimizedBridge.call('math', 'sqrt', [i * i]);
          expect(nodeResult).toBe(i);
          expect(optimizedResult).toBe(i);
        }
      } finally {
        await nodeBridge.dispose();
        await optimizedBridge.dispose();
      }
    });
  });
});
