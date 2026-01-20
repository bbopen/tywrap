/**
 * Base runtime bridge
 *
 * @deprecated Use BoundedContext instead. RuntimeBridge will be removed in the next major version.
 */

import { BoundedContext } from './bounded-context.js';

/**
 * @deprecated Use BoundedContext instead. RuntimeBridge will be removed in the next major version.
 *
 * All bridges now extend BoundedContext which provides:
 * - Lifecycle management (init/dispose state machine)
 * - Validation helpers
 * - Error classification
 * - Bounded execution (timeout, retry)
 * - Resource ownership tracking
 *
 * @see BoundedContext
 */
export abstract class RuntimeBridge extends BoundedContext {}

// Re-export BoundedContext for backwards compatibility
export { BoundedContext };
