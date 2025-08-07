// Real-world demo using numpy and pandas via tywrap's NodeBridge
// Usage:
//   node scripts/real_world_demo.js
//   PYTHON_BIN=./.venv/bin/python node scripts/real_world_demo.js
//   ENABLE_JSON_FALLBACK=1 node scripts/real_world_demo.js

import { NodeBridge } from '../dist/runtime/node.js';
import { registerArrowDecoder } from '../dist/index.js';

async function maybeRegisterArrowDecoder() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const arrow = require('apache-arrow');
    const Table = arrow?.Table;
    if (Table && typeof Table.from === 'function') {
      registerArrowDecoder(bytes => {
        try {
          return Table.from(bytes);
        } catch {
          return bytes;
        }
      });
      // eslint-disable-next-line no-console
      console.log('[demo] Registered apache-arrow decoder');
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function main() {
  const pythonPath = process.env.PYTHON_BIN || './.venv/bin/python';
  const wantFallback = process.env.ENABLE_JSON_FALLBACK === '1';
  const haveArrow = await maybeRegisterArrowDecoder();
  const enableJsonFallback = wantFallback || !haveArrow;

  const bridge = new NodeBridge({
    pythonPath,
    scriptPath: 'runtime/python_bridge.py',
    enableJsonFallback,
  });

  // 1) Linear algebra pipeline with numpy (A: 100x6, B: 6x5 ⇒ C: 100x5 ⇒ col means: 5)
  const a1d = await bridge.call('numpy', 'arange', [600]);
  const A = await bridge.call('numpy', 'reshape', [a1d, [100, 6]]);
  const b1d = await bridge.call('numpy', 'arange', [30]);
  const B = await bridge.call('numpy', 'reshape', [b1d, [6, 5]]);
  const C = await bridge.call('numpy', 'matmul', [A, B]);
  const colMeans = await bridge.call('numpy', 'mean', [C], { axis: 0 });

  // 2) Feature engineering with pandas: build DataFrame and one‑hot encode a categorical column
  const N = 20;
  const series = Array.from({ length: N }, (_, i) => i);
  const cats = ['red', 'green', 'blue'];
  const catCol = series.map(i => cats[i % cats.length]);
  const y = series.map(i => Math.sin(i / 3) + (i % 2 === 0 ? 0.1 : -0.1));
  const df = await bridge.call('pandas', 'DataFrame', [{ x: series, cat: catCol, y }]);
  const dummies = await bridge.call('pandas', 'get_dummies', [df], { columns: ['cat'] });

  // 3) Summaries
  const sumY = await bridge.call('numpy', 'sum', [y]);

  // eslint-disable-next-line no-console
  console.log('[demo] numpy colMeans length:', Array.isArray(colMeans) ? colMeans.length : typeof colMeans);
  // eslint-disable-next-line no-console
  console.log('[demo] pandas get_dummies rows:', Array.isArray(dummies) ? dummies.length : typeof dummies);
  // eslint-disable-next-line no-console
  console.log('[demo] sum(y):', sumY);

  await bridge.dispose();
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[demo] error:', err?.message || err);
  process.exit(1);
});


