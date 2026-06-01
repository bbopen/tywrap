# Transport capability matrix

Every tywrap transport exposes a static, transport-level capability descriptor
via `Transport.capabilities()`. The same descriptor is surfaced by
`RpcClient.capabilities()` (it delegates to the held transport). It tells callers
what the wire channel can carry and how it frames messages **without** a network
round-trip.

This descriptor is deliberately separate from the bridge `meta` report
(`BridgeInfo`, fetched via `RpcClient.getBridgeInfo()`):

- The **transport descriptor** is authoritative for transport-level flags — what
  bytes the channel moves and how it frames them. It does not depend on lifecycle
  state, so it is safe to read before `init()` and after `dispose()`.
- The **`BridgeInfo` meta report** is authoritative for the *Python environment* —
  which optional libraries (`arrowAvailable`, `scipyAvailable`, `torchAvailable`,
  `sklearnAvailable`) happen to be importable in the running interpreter.

When you need both questions answered — "can this transport carry Arrow **and**
does this Python have pyarrow?" — consult both: the transport descriptor for the
channel, `BridgeInfo` for library availability.

## `TransportCapabilities`

```typescript
interface TransportCapabilities {
  backend: 'subprocess' | 'http' | 'pyodide';
  supportsArrow: boolean;
  supportsBinary: boolean;
  supportsChunking: boolean;
  supportsStreaming: boolean;
  maxFrameBytes: number;
}
```

## Matrix

| Backend (transport)            | `backend`     | `supportsArrow` | `supportsBinary` | `supportsChunking` | `supportsStreaming` | `maxFrameBytes`                  |
| ------------------------------ | ------------- | --------------- | ---------------- | ------------------ | ------------------- | -------------------------------- |
| `SubprocessTransport` (Node)   | `subprocess`  | `true`          | `true`           | `false`            | `false`             | JSONL line limit (default 100 MB) |
| `HttpTransport`                | `http`        | `true`          | `true`           | `false`            | `false`             | `Number.POSITIVE_INFINITY`       |
| `PyodideTransport` (WASM)      | `pyodide`     | `false`         | `true`           | `false`            | `false`             | `Number.POSITIVE_INFINITY`       |

`PooledTransport` (the multi-process Node path) reports the capabilities of the
worker transport it distributes across — in practice `SubprocessTransport`, so it
mirrors the subprocess row.

## Notes per flag

### `supportsArrow`

Whether the transport can carry Arrow-encoded payloads (binary IPC frames) on the
wire.

- **subprocess / http**: `true`. The channel can move Arrow bytes. Whether Arrow is
  actually *used* for a given response still depends on the Python side
  (`BridgeInfo.arrowAvailable`) and the `TYWRAP_CODEC_FALLBACK` setting — those are
  runtime/codec concerns, not transport-level ones.
- **pyodide**: `false`. pyarrow is unavailable in WASM, so the Pyodide bootstrap
  forces JSON markers (`force_json_markers=True`) and reports
  `arrowAvailable: false`. The channel is JSON-only.

### `supportsBinary`

Whether the transport can carry arbitrary binary data (e.g. Python `bytes`).
`true` on all current backends — binary rides through base64 `bytes` envelopes.

### `supportsChunking` and `supportsStreaming`

`false` on every backend today. No backend splits a logical message across
multiple frames (`supportsChunking`) or streams incremental results for a single
request (`supportsStreaming`). Both are planned for **0.8.0**.

### `maxFrameBytes`

Maximum size, in bytes, of a single wire frame the transport itself will accept.
`Number.POSITIVE_INFINITY` means the transport imposes no frame ceiling of its own
(a higher layer — e.g. the codec's payload limit, default 10 MB — may still cap
the size).

- **subprocess**: the JSONL line-length limit (`maxLineLength`, default
  `100 * 1024 * 1024` = 100 MB). A response line larger than this raises a protocol
  error.
- **http**: `Number.POSITIVE_INFINITY`. The whole response body is read in one shot;
  the transport imposes no frame limit.
- **pyodide**: `Number.POSITIVE_INFINITY`. Calls are in-memory string passing with no
  framing.

## Example

```typescript
import { RpcClient } from 'tywrap/runtime';

// rpc holds a transport (e.g. via NodeBridge / PyodideBridge / HttpBridge).
const caps = rpc.capabilities();
if (caps.supportsArrow) {
  // The channel can carry Arrow; pair with getBridgeInfo() to confirm pyarrow
  // is actually importable on the Python side before relying on Arrow encoding.
  const info = await rpc.getBridgeInfo();
  const useArrow = info.arrowAvailable;
}
```
