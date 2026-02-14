/**
 * @deprecated Import from './node.js' instead.
 *
 * OptimizedNodeBridge has been unified with NodeBridge. The NodeBridge class
 * now supports both single-process mode (default) and multi-process pooling
 * via the minProcesses/maxProcesses options.
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
 * This file is maintained for backward compatibility only.
 */
export {
  NodeBridge as OptimizedNodeBridge,
  type NodeBridgeOptions as ProcessPoolOptions,
} from './node.js';
