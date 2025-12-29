/**
 * Base runtime bridge
 */

import type { RuntimeExecution } from '../types/index.js';

export abstract class RuntimeBridge implements RuntimeExecution {
  abstract call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;

  abstract instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;

  abstract callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;

  abstract disposeInstance(handle: string): Promise<void>;

  abstract dispose(): Promise<void>;
}
