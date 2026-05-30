I would not rubber-stamp the spec as written. The split direction is sound, but the warmup path needs a sharper design.

**Findings**

1. The disposal ownership answer is: facade should track `this.rpc`, and `RpcClient` should track the transport. Do not also track the transport from the facade. Current `BridgeProtocol` tracks transport in its constructor at `src/runtime/bridge-protocol.ts:237-245`, and `BoundedContext.dispose()` disposes tracked resources before `doDispose()` at `src/runtime/bounded-context.ts:166-184`. That means `RpcClient.dispose()` will dispose transport, then clear `bridgeInfoCache` in its `doDispose()` equivalent at `src/runtime/bridge-protocol.ts:268-270`. Tracking transport directly from the facade would either double-dispose or bypass cache clearing if `rpc` is not disposed.

2. The proposed warmup migration can deadlock if `sendOn()` uses `RpcClient.execute()`. `execute()` auto-inits whenever state is not ready at `src/runtime/bounded-context.ts:389-396`. During facade init, `doInit()` calls `rpc.init()`, which calls transport init, which creates workers, which invokes warmup. That warmup calling `rpc.sendOn()` through `execute()` would await the same `rpc.init()` already waiting on warmup. `sendOn()` needs a no-auto-init/internal send path for already-initialized worker transports, or it needs an explicit `skipLifecycle` mode.

3. PooledTransport does not support assigning `onWorkerReady` after construction. It copies the callback into private `poolOptions` at `src/runtime/pooled-transport.ts:107-115`, then copies it into `WorkerPool` during `doInit()` at `src/runtime/pooled-transport.ts:128-137`; `WorkerPool` stores it at `src/runtime/worker-pool.ts:142-149` and invokes it after worker transport init at `src/runtime/worker-pool.ts:476-490`. So the correct approach is a closure over a late-bound local variable, not post-constructor assignment. Because derived constructors cannot use `this` before `super()`, prefer `let rpc: RpcClient | undefined; const onWorkerReady = w => warmupWorker(requireRpc(rpc), w);` then set `rpc = this.rpc` after `super()`.

4. Request-id uniqueness is fine if warmup uses the same `RpcClient.generateId()` counter. Current live RPC IDs are generated in `BridgeProtocol` at `src/runtime/bridge-protocol.ts:367-368`; warmup currently uses a separate module-global counter at `src/runtime/node.ts:561-564`. Moving warmup onto the same counter improves global uniqueness. Pool concurrency is not a problem in JS’s single event loop, and replacement workers are not published until warmup completes (`src/runtime/worker-pool.ts:441-452`, `:487-507`).

5. Watch NodeBridge caching. Current cache hits return before any `super.call()` and therefore before auto-init (`src/runtime/node.ts:424-436`). If the composed `NodeBridge.call()` performs facade `ensure-ready` before checking cache, that changes behavior. Keep the cache lookup first.

**Explicit Answers**

(A) Yes, the composition split removes the leaked RPC stubs if you delete all four places: `ProcessIO` (`src/runtime/process-io.ts:382-419`), `PooledTransport` (`src/runtime/pooled-transport.ts:216-262`), `WorkerPool` (`src/runtime/worker-pool.ts:547-593`), and dead `PyodideIO` client methods plus `requestId`/ID parser (`src/runtime/pyodide-io.ts:196`, `:352-445`, `:491-510`).

(B) As written, yes, behavior can accidentally change. The major risk is warmup deadlock through `execute()` auto-init. Secondary risks: cache-hit auto-init in `NodeBridge.call()`, warmup error-message wrapping, and bridgeInfo cache clearing if `rpc` is not tracked/disposed.

(C) Yes, generated wrappers should keep working without regeneration because they call only `getRuntimeBridge().call/instantiate/callMethod/disposeInstance` at `src/core/generator.ts:588`, `:894`, `:1107`, `:1112`, and `getRuntimeBridge()` still returns `RuntimeExecution` at `src/runtime/index.ts:13`.

(D) Biggest migration-order risk: S4 warmup through `rpc.sendOn()` during `rpc.init()`. Implement that incorrectly and runtime_node/pool tests can hang or timeout before you even reach protocol assertions.