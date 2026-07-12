/**
 * Disposable interface for resources that need cleanup.
 *
 * This interface enables the BoundedContext resource tracking system
 * to automatically dispose of owned resources when the context is disposed.
 */

/**
 * Interface for resources that require explicit cleanup.
 */
export interface Disposable {
  /**
   * Release resources held by this object.
   * This method should be idempotent (safe to call multiple times).
   */
  dispose(): Promise<void>;
}

/**
 * Type guard to check if a value implements the Disposable interface.
 *
 * @param value - The value to check
 * @returns True if the value has a dispose method
 */
export function isDisposable(value: unknown): value is Disposable {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Disposable).dispose === 'function'
  );
}

/**
 * Safely dispose a value if it implements Disposable.
 * Does nothing if the value is not disposable.
 *
 * @param value - The value to dispose
 * @returns Promise that resolves when disposal is complete
 */
export async function safeDispose(value: unknown): Promise<void> {
  if (isDisposable(value)) {
    await value.dispose();
  }
}

/**
 * Dispose multiple resources, collecting any errors.
 * All resources will be attempted even if some fail.
 *
 * @param resources - Iterable of Disposable resources
 * @returns Array of errors that occurred during disposal (empty if all succeeded)
 */
export async function disposeAll(resources: Iterable<Disposable>): Promise<Error[]> {
  const errors: Error[] = [];

  for (const resource of resources) {
    try {
      await resource.dispose();
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return errors;
}
