/**
 * tywrap/runtime entrypoint.
 *
 * Exposes the runtime bridge registry used by generated wrappers, plus the
 * lower-level boundary primitives (codec + transport contract) for consumers
 * building custom bridges. These were previously re-exported from the package
 * root; they now live here so the root surface stays small.
 */

import type { RuntimeExecution } from '../types/index.js';

// BridgeCodec — validation and serialization for the JS<->Python boundary
export { BridgeCodec, type CodecOptions } from './bridge-codec.js';

// Transport contract — abstract I/O channel interface and guards
export type {
  Transport,
  TransportCapabilities,
  TransportOptions,
  ProtocolMessage,
  ProtocolResponse,
} from './transport.js';
export {
  PROTOCOL_ID,
  isTransport,
  isProtocolMessage,
  isProtocolResponse,
} from './transport.js';

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
