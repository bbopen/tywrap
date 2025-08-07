import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { NodeBridge } from '../src/runtime/node.js';

// The generated module may not exist in clean clones; skip opportunistically
const generatedMathPath = join(process.cwd(), 'generated', 'math.generated.ts');
const hasGeneratedMath = existsSync(generatedMathPath);

interface MathModule {
  sqrt: (value: number) => Promise<number>;
}

let math: MathModule;

declare global {
  // Minimal bridge shape expected by generated code

  var __bridge: {
    call<T = unknown>(qualified: string, args: unknown[]): Promise<T>;
    instantiate<T = unknown>(qualified: string, args: unknown[]): Promise<T>;
  };
}

const suite = hasGeneratedMath ? describe : describe.skip;

suite('Generated runtime wiring - math', () => {
  let bridge: NodeBridge;

  beforeAll(async () => {
    bridge = new NodeBridge({ scriptPath: 'runtime/python_bridge.py' });
    if (hasGeneratedMath) {
      // Dynamic import to avoid hard dependency when file is absent
      const mod = (await import('../generated/math.generated')) as unknown;
      math = mod as MathModule;
    }
    // Adapter from generated global shape to NodeBridge API
    globalThis.__bridge = {
      async call<T = unknown>(qualified: string, args: unknown[]): Promise<T> {
        const dot = qualified.indexOf('.');
        const module = dot >= 0 ? qualified.slice(0, dot) : qualified;
        const name = dot >= 0 ? qualified.slice(dot + 1) : qualified;
        return bridge.call<T>(module, name, args);
      },
      async instantiate<T = unknown>(qualified: string, args: unknown[]): Promise<T> {
        const dot = qualified.indexOf('.');
        const module = dot >= 0 ? qualified.slice(0, dot) : qualified;
        const name = dot >= 0 ? qualified.slice(dot + 1) : qualified;
        return bridge.instantiate<T>(module, name, args);
      },
    };
  });

  afterAll(async () => {
    await bridge.dispose();
  });

  it('calls math.sqrt via generated wrapper', async () => {
    const result = await math.sqrt(9);
    expect(result).toBe(3);
  });
});
