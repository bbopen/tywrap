import { describe, expect, it } from 'vitest';

import { BridgeCore, normalizeEnv } from '../src/runtime/bridge-core.js';
import { BridgeProtocolError } from '../src/runtime/errors.js';

class TestTransport {
  writes: string[] = [];

  write(data: string): void {
    this.writes.push(data);
  }
}

describe('BridgeCore env normalization', () => {
  it('normalizes PATH casing and drops undefined values', () => {
    const baseEnv = {
      Path: 'C:\\Windows',
      TYWRAP_SAFE: '1',
      EMPTY: undefined,
    };
    const overrides = {
      PATH: 'C:\\Custom',
      EXTRA: 'ok',
      REMOVE_ME: undefined,
    };

    const result = normalizeEnv(baseEnv, overrides);

    expect(result.Path).toBe('C:\\Custom');
    expect(result).not.toHaveProperty('PATH');
    expect(result).not.toHaveProperty('EMPTY');
    expect(result).not.toHaveProperty('REMOVE_ME');
    expect(result.EXTRA).toBe('ok');
    expect(result.TYWRAP_SAFE).toBe('1');
  });
});

describe('BridgeCore request encoding', () => {
  it('fails fast on non-serializable payloads', async () => {
    const transport = new TestTransport();
    const core = new BridgeCore(transport, { timeoutMs: 50, maxLineLength: 128 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      core.send({
        method: 'call',
        params: { module: 'math', functionName: 'sqrt', args: [circular] },
      })
    ).rejects.toBeInstanceOf(BridgeProtocolError);
  });
});

describe('BridgeCore line buffering', () => {
  it('rejects oversized stdout lines', async () => {
    const transport = new TestTransport();
    const core = new BridgeCore(transport, { timeoutMs: 50, maxLineLength: 32 });

    const pending = core.send({
      method: 'call',
      params: { module: 'math', functionName: 'sqrt', args: [4] },
    });

    core.handleStdoutData('x'.repeat(64));

    await expect(pending).rejects.toBeInstanceOf(BridgeProtocolError);
  });
});
