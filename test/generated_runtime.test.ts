import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { NodeBridge } from '../src/runtime/node.js';
import { clearRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';

// The generated module may not exist in clean clones; skip opportunistically
const generatedMathPath = join(process.cwd(), 'generated', 'math.generated.ts');
const hasGeneratedMath = existsSync(generatedMathPath);

interface MathModule {
  sqrt: (value: number) => Promise<number>;
}

let math: MathModule;

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
    setRuntimeBridge({
      call: bridge.call.bind(bridge),
      instantiate: bridge.instantiate.bind(bridge),
      callMethod: bridge.callMethod.bind(bridge),
      disposeInstance: bridge.disposeInstance.bind(bridge),
      dispose: bridge.dispose.bind(bridge),
    });
  });

  afterAll(async () => {
    await bridge.dispose();
    clearRuntimeBridge();
  });

  it('calls math.sqrt via generated wrapper', async () => {
    const result = await math.sqrt(9);
    expect(result).toBe(3);
  });
});
