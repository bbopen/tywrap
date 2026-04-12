/**
 * @deprecated Import from './node.js' instead.
 *
 * Backward-compat shim for older deep imports. NodeBridge is the public API,
 * and it now supports both single-process mode (default) and multi-process
 * pooling via the minProcesses/maxProcesses options.
 *
 * Migration:
 * ```typescript
 * // Before
 * import { OptimizedNodeBridge, ProcessPoolOptions } from './optimized-node.js';
 * const bridge = new OptimizedNodeBridge({ minProcesses: 2, maxProcesses: 4 });
 *
 * // After
 * import { NodeBridge, NodeBridgeOptions } from './node.js';
 * const bridge = new NodeBridge({ minProcesses: 2, maxProcesses: 4 });
 * ```
 *
 * This file is not exposed through the package exports map and is maintained
 * for backward compatibility only.
 */
export {
  NodeBridge as OptimizedNodeBridge,
  type NodeBridgeOptions as ProcessPoolOptions,
} from './node.js';
