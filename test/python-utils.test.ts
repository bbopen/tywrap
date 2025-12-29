import { describe, it, expect } from 'vitest';
import { join as joinPath, resolve as resolvePath } from 'node:path';
import { resolvePythonExecutable } from '../src/utils/python.js';
import { isNodejs, getVenvBinDir, getVenvPythonExe } from '../src/utils/runtime.js';

const describeNodeOnly = isNodejs() ? describe : describe.skip;

describeNodeOnly('Python executable resolution', () => {
  it('prefers explicit pythonPath when provided', async () => {
    const pythonPath = await resolvePythonExecutable({
      pythonPath: 'python3.12',
      virtualEnv: './venv',
    });
    expect(pythonPath).toBe('python3.12');
  });

  it('uses virtualEnv python when no explicit pythonPath is set', async () => {
    const venv = 'test-venv';
    const expectedRoot = resolvePath(process.cwd(), venv);
    const binDir = getVenvBinDir();
    const exe = getVenvPythonExe();
    const expected = joinPath(expectedRoot, binDir, exe);

    const pythonPath = await resolvePythonExecutable({ virtualEnv: venv });
    expect(pythonPath).toBe(expected);
  });
});
