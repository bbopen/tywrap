#!/usr/bin/env node
/**
 * Indicative data-plane benchmark for the request hot path.
 *
 * Run after `npm run build` so it exercises the current compiled runtime:
 *   node scripts/bench-data-plane.mjs
 *
 * This is deliberately a reporting harness, not a performance gate. Compare
 * before/after runs on the same machine; absolute figures are environment
 * dependent.
 */
import { performance } from 'node:perf_hooks';

import { BridgeCodec } from '../dist/runtime/bridge-codec.js';
import { NodeBridge } from '../dist/runtime/node.js';

function makeObject(leaves) {
  return Object.fromEntries(Array.from({ length: leaves }, (_, index) => [`key_${index}`, index]));
}

function measureEncode(label, value, iterations) {
  const codec = new BridgeCodec();
  for (let index = 0; index < 100; index += 1) {
    codec.encodeRequest(value);
  }

  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    codec.encodeRequest(value);
  }
  const elapsedMs = performance.now() - startedAt;
  const opsPerSecond = (iterations * 1_000) / elapsedMs;
  console.log(`${label}: ${opsPerSecond.toFixed(0)} ops/sec (${iterations} ops, ${elapsedMs.toFixed(1)} ms)`);
}

async function measureRoundTrip() {
  const bridge = new NodeBridge({ timeoutMs: 30_000 });
  await bridge.init();
  try {
    await bridge.call('operator', 'add', [1, 1]);

    const calls = 1_000;
    const startedAt = performance.now();
    for (let index = 0; index < calls; index += 1) {
      await bridge.call('operator', 'add', [index, 1]);
    }
    const elapsedMs = performance.now() - startedAt;
    const latencyMs = elapsedMs / calls;
    console.log(
      `subprocess round-trip (warm, sequential): ${latencyMs.toFixed(3)} ms/call ` +
        `(${calls} calls, ${elapsedMs.toFixed(1)} ms)`
    );
  } finally {
    await bridge.dispose();
  }
}

measureEncode('encodeRequest (100 leaves)', makeObject(100), 50_000);
measureEncode('encodeRequest (10k leaves)', makeObject(10_000), 1_000);
await measureRoundTrip();
