**(a) Biggest Unflagged Risk**
The most underestimated functional risk is `consolidate-runtime-transport`: the plan treats request-id correlation as something you can “move into `BridgeProtocol.dispatch`,” but the current transport abstraction is already a correlated RPC abstraction, not a byte transport.

Evidence:

- `BridgeProtocol` generates the id, sends encoded JSON, then blindly decodes whatever string comes back. It does not compare response id to request id: [src/runtime/bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:288), [src/runtime/bridge-protocol.ts](/Users/brettbonner/tywrap/src/runtime/bridge-protocol.ts:305).
- `SafeCodec` extracts `result`/`error` from an envelope but also does not validate id equality: [src/runtime/safe-codec.ts](/Users/brettbonner/tywrap/src/runtime/safe-codec.ts:413), [src/runtime/safe-codec.ts](/Users/brettbonner/tywrap/src/runtime/safe-codec.ts:556).
- The real demux/correlation lives in `ProcessIO`: it extracts the request id before writing, registers a pending request, then resolves only the matching response line: [src/runtime/process-io.ts](/Users/brettbonner/tywrap/src/runtime/process-io.ts:249), [src/runtime/process-io.ts](/Users/brettbonner/tywrap/src/runtime/process-io.ts:309), [src/runtime/process-io.ts](/Users/brettbonner/tywrap/src/runtime/process-io.ts:607).
- `PooledTransport` assumes every worker transport has that same request/response `send()` contract: [src/runtime/pooled-transport.ts](/Users/brettbonner/tywrap/src/runtime/pooled-transport.ts:174).
- Node warmup bypasses `BridgeProtocol` entirely and hand-rolls request ids, JSON parsing, and envelope validation: [src/runtime/node.ts](/Users/brettbonner/tywrap/src/runtime/node.ts:566), [src/runtime/node.ts](/Users/brettbonner/tywrap/src/runtime/node.ts:695).

So the hazard is not “where should the id check live?” The hazard is that there are multiple protocol clients today. If the team only adds id equality to `BridgeProtocol`, warmup and direct transport paths still bypass it. If they remove correlation from `ProcessIO`, concurrent subprocess calls and pooled workers break unless the transport interface is redesigned.

Blunt version: T5 is being described like cleanup, but it is a transport contract migration. Treat it as one.

**(b) Comments Charter**
The charter is useful in intent, but it risks becoming performative because it focuses too much on comments and not enough on executable contracts.

The repo already has comment rot. `ProcessIO`’s example shows `id: '1'` and `type: 'call'`, which is not the actual protocol shape requiring numeric `id`, `protocol`, `method`, and `params`: [src/runtime/process-io.ts](/Users/brettbonner/tywrap/src/runtime/process-io.ts:157). `HttpIO` repeats the same stale example: [src/runtime/http-io.ts](/Users/brettbonner/tywrap/src/runtime/http-io.ts:58). That is exactly the failure mode your charter could amplify: big explanatory blocks that sound helpful and become wrong.

What is missing:

- A short `docs/dev/architecture.md` or equivalent showing the authoritative generate path and runtime request path in one place.
- A rule that every cross-language contract comment must point to a test or fixture, not just sibling files.
- A “no banner comments” rule. The code already has too many section banners; adding more will bury invariants.
- A schema/change-log discipline for IR and protocol migrations. Comments cannot carry that burden.

Newcomers need a map, runnable examples, and failing tests. They do not need every file to narrate itself.

**(c) One Change**
Keep or extract the essence of `BridgeCore` instead of deleting it outright, and make it the single protocol client.

Right now `BridgeCore` is dead-ish, but it already contains the shape the plan says it wants: id generation, pending map, timeout tracking, response-id validation, protocol validation, and line-buffer handling: [src/runtime/bridge-core.ts](/Users/brettbonner/tywrap/src/runtime/bridge-core.ts:59), [src/runtime/bridge-core.ts](/Users/brettbonner/tywrap/src/runtime/bridge-core.ts:107), [src/runtime/bridge-core.ts](/Users/brettbonner/tywrap/src/runtime/bridge-core.ts:218).

I would not preserve it as-is. I would rename and shrink it into a clear `ProtocolClient`/`RpcClient`, then make `BridgeProtocol`, warmup, and subprocess handling use that one path. That one change beats the alternatives because it attacks the real complexity: duplicated protocol semantics. Public API trimming, generator decomposition, and comment cleanup all help, but they do not make the system conceptually simpler in the way a single authoritative protocol client would.