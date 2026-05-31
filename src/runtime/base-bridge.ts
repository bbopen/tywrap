/**
 * BasePythonBridge - shared RPC delegation for the bridge facades.
 *
 * The three bridge facades (NodeBridge/HttpBridge/PyodideBridge) all extend
 * DisposableBase (lifecycle/resources) and implement PythonRuntime by HOLDING
 * an RpcClient. The PythonRuntime delegation was byte-identical across all
 * three: each method does `await this.ensureReady()` then forwards to the held
 * RpcClient. This base collapses that duplication onto a single
 * `getRpcClient()` accessor while leaving each facade free to own its own
 * RpcClient field (for constructor wiring, resource tracking, and — in
 * NodeBridge's case — a caching override of call()).
 *
 * It carries no transport/codec/lifecycle specifics: doInit/doDispose remain
 * abstract on DisposableBase and stay per-facade.
 *
 * @see https://github.com/bbopen/tywrap/issues/149
 */

import type { PythonRuntime, BridgeInfo } from '../types/index.js';

import { DisposableBase } from './bounded-context.js';
import type { RpcClient, GetBridgeInfoOptions } from './rpc-client.js';

/**
 * Shared base for the bridge facades. Implements the PythonRuntime RPC
 * delegation (plus getBridgeInfo) over a single held RpcClient, exposed by the
 * abstract {@link getRpcClient} accessor. Lifecycle (doInit/doDispose) and the
 * RpcClient's construction/ownership remain the subclass's responsibility.
 */
export abstract class BasePythonBridge extends DisposableBase implements PythonRuntime {
  /**
   * Return the held RpcClient that the shared delegating methods forward to.
   * Subclasses construct, track, and own the RpcClient; this accessor lets the
   * base reach it without dictating how it is stored.
   */
  protected abstract getRpcClient(): RpcClient;

  // ===========================================================================
  // RPC METHODS (delegate to the held RpcClient)
  // ===========================================================================

  async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureReady();
    return this.getRpcClient().call<T>(module, functionName, args, kwargs);
  }

  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureReady();
    return this.getRpcClient().instantiate<T>(module, className, args, kwargs);
  }

  async callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureReady();
    return this.getRpcClient().callMethod<T>(handle, methodName, args, kwargs);
  }

  async disposeInstance(handle: string): Promise<void> {
    await this.ensureReady();
    return this.getRpcClient().disposeInstance(handle);
  }

  /**
   * Fetch bridge diagnostics and feature availability.
   */
  async getBridgeInfo(options?: GetBridgeInfoOptions): Promise<BridgeInfo> {
    await this.ensureReady();
    return this.getRpcClient().getBridgeInfo(options);
  }

  /**
   * Ensure the facade is initialized before delegating an RPC. Replicates the
   * auto-init that the bounded execute path provided pre-composition, so the
   * facade's own doInit pre-work runs before any RPC.
   */
  protected async ensureReady(): Promise<void> {
    if (!this.isReady) {
      await this.init();
    }
  }
}
