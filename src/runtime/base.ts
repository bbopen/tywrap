/**
 * Base runtime bridge
 *
 * @deprecated Use DisposableBase instead. RuntimeBridge will be removed in the next major version.
 */

import { DisposableBase } from './bounded-context.js';

/**
 * @deprecated Use DisposableBase instead. RuntimeBridge will be removed in the next major version.
 *
 * All bridges now build on DisposableBase which provides:
 * - Lifecycle management (init/dispose state machine)
 * - Validation helpers
 * - Error classification
 * - Bounded execution (timeout, retry)
 * - Resource ownership tracking
 *
 * @see DisposableBase
 */
export abstract class RuntimeBridge extends DisposableBase {}

// Re-export DisposableBase for backwards compatibility
export { DisposableBase };
