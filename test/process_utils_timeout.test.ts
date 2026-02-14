import { describe, it, expect } from 'vitest';

import { processUtils } from '../src/utils/runtime.js';
import { getDefaultPythonPath } from '../src/utils/python.js';

describe('processUtils.exec', () => {
  it('rejects with a clear timeout error when the subprocess hangs', async () => {
    const pythonPath = getDefaultPythonPath();
    const timeoutMs = 200;

    await expect(
      processUtils.exec(pythonPath, ['-c', 'import time; time.sleep(999)'], { timeoutMs })
    ).rejects.toThrow(`timed out after ${timeoutMs}ms`);
  }, 10_000);
});
