import { describe, it, expect } from 'vitest';
import { processUtils } from '../src/utils/runtime.js';

describe('processUtils.exec limits', () => {
  it('should terminate processes that exceed timeout', async () => {
    await expect(
      processUtils.exec('node', ['-e', 'setTimeout(()=>{},1000)'], { timeout: 100 })
    ).rejects.toThrow('Process execution timed out');
  });

  it('should terminate processes when output exceeds maxBuffer', async () => {
    const script = "process.stdout.write('A'.repeat(2 * 1024 * 1024))";
    await expect(
      processUtils.exec('node', ['-e', script], { maxBuffer: 1024 })
    ).rejects.toThrow('Process output exceeded maxBuffer');
  });
});
