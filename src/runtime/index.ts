/**
 * Runtime bridge registry for generated wrappers.
 */

import type { RuntimeExecution } from '../types/index.js';

let runtimeBridge: RuntimeExecution | null = null;

export function setRuntimeBridge(bridge: RuntimeExecution): void {
  runtimeBridge = bridge;
}

export function getRuntimeBridge(): RuntimeExecution {
  if (!runtimeBridge) {
    throw new Error(
      'No runtime bridge configured. Call setRuntimeBridge(new NodeBridge(...)) or setRuntimeBridge(new PyodideBridge(...)) before using generated modules.'
    );
  }
  return runtimeBridge;
}

export function clearRuntimeBridge(): void {
  runtimeBridge = null;
}
