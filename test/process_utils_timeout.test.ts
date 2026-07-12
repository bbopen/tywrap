import { describe, it, expect } from 'vitest';

import { processUtils } from '../src/utils/runtime.js';
import { getDefaultPythonPath } from '../src/utils/python.js';
import { hasPythonBinary } from './helpers/python-probe.js';

// Gate on the specific interpreter this test drives so a missing Python SKIPS
// loudly instead of silently early-returning (which would report a vacuous pass).
const PYTHON_PATH = getDefaultPythonPath();
const PYTHON_OK = hasPythonBinary(PYTHON_PATH);

describe('processUtils.exec', () => {
  it.skipIf(!PYTHON_OK)(
    'rejects with a clear timeout error when the subprocess hangs',
    async () => {
      const timeoutMs = 200;

      await expect(
        processUtils.exec(PYTHON_PATH, ['-c', 'import time; time.sleep(999)'], { timeoutMs })
      ).rejects.toThrow(`timed out after ${timeoutMs}ms`);
    },
    10_000
  );
});
