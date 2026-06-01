# Chunked transport framing (`tywrap-frame/1`)

Large Python results can exceed the single-line ceiling of the subprocess JSONL
channel (`maxLineLength`, default 100 MB). `tywrap-frame/1` is the framing
protocol that fragments one logical message across multiple wire frames and
reassembles it on the other side, so a payload larger than one frame can still
cross the boundary without a silent lossy fallback.

This document is the spec. As of 0.8.0 it describes the **wire contract and the
negotiation handshake**; the framing constants, the `BridgeInfo.transport`
negotiation block, and the relaxed `meta` validator land in W1 with **no runtime
behavior change**. The actual fragment/reassembly machinery lands in later
workstreams (W3–W6) and implements exactly what is written here.

## Scope: subprocess only

`tywrap-frame/1` is **subprocess-only** for 0.8.0. The subprocess transport is
the only backend with a real frame ceiling — the JSONL line-length limit. The
other backends stay single-frame and keep `supportsChunking: false`:

- **HTTP** has no line ceiling, but still buffers a whole response via
  `response.text()`; chunking there is a later optimization, not a correctness
  requirement.
- **Pyodide** is in-memory (`maxFrameBytes: Number.POSITIVE_INFINITY`,
  JSON-only); there is no wire to fragment.

`supportsStreaming` stays `false` on every backend in 0.8.0.

## Layering

Chunking lives in the transport I/O layer, **below** `RpcClient`. `RpcClient`
keeps its one-logical-string-in / one-logical-string-out contract; it never sees
frames. Both sides fragment and reassemble:

- TypeScript: `src/runtime/subprocess-transport.ts`.
- Python: the read/write loop in `runtime/python_bridge.py`.

`runtime/tywrap_bridge_core.py` (dispatch + serializers) stays oblivious — it
produces and consumes complete logical JSON messages.

The logical RPC protocol stays `tywrap/1`. We do **not** bump `PROTOCOL_ID` to
`tywrap/2`: an old bridge rejects any non-`tywrap/1` request, so a `tywrap/2`
request could never bootstrap its own negotiation. Instead `tywrap-frame/1` is a
separate framing protocol, advertised through a `tywrap/1` `meta` extension.

## Frame envelope

A frame envelope is distinct from the logical `ProtocolMessage` /
`ProtocolResponse`. It carries a slice of the bytes of one **complete** logical
JSON message:

```json
{
  "__tywrap_frame__": "chunk",
  "frameProtocol": "tywrap-frame/1",
  "stream": "request",
  "id": 42,
  "seq": 0,
  "total": 8,
  "totalBytes": 7340032,
  "encoding": "utf8-slice",
  "data": "..."
}
```

| Field             | Meaning                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| `__tywrap_frame__`| `"chunk"` (data frame) or `"error"` (framing-layer error, no more data frames).  |
| `frameProtocol`   | Must equal `tywrap-frame/1` (`FRAME_PROTOCOL_ID`); any other value is rejected.   |
| `stream`          | `"request"` (JS → Python) or `"response"` (Python → JS).                          |
| `id`              | RPC correlation id, shared with the logical `ProtocolMessage.id`.                |
| `seq`             | Zero-based frame index within the stream.                                        |
| `total`           | Total frame count for the stream; repeated on every frame.                       |
| `totalBytes`      | Byte length of the complete reassembled message; repeated on every frame.        |
| `encoding`        | Per-frame payload encoding: `"utf8-slice"` (chosen) or `"utf8-base64"`.          |
| `data`            | This frame's slice of the logical message, encoded per `encoding`.               |

The TypeScript type is `ChunkFrame` in `src/runtime/transport.ts`; the constants
are `FRAME_PROTOCOL_ID` and `FRAME_PROTOCOL_VERSION` (the version derived from the
trailing number, the same pattern as `TYWRAP_PROTOCOL_VERSION`).

## Encoding: `utf8-slice` (chosen)

**Decision (plan decision #6): `tywrap-frame/1` uses `encoding: "utf8-slice"`.**

The chunked payload is the bytes of a complete, valid-UTF-8 JSON message. Two
candidates were considered:

- **`utf8-base64`** — base64-encode the UTF-8 bytes of each chunk. Safe for
  arbitrary byte split points, but inflates the wire by ~33% and forces a
  full base64 decode plus a separate bytes buffer per frame — a memory
  amplification (string + UTF-8 bytes + base64) flagged as a real risk in the
  design review.
- **`utf8-slice`** (chosen) — because the payload is already valid UTF-8, split
  it on **UTF-8 codepoint boundaries** and embed the raw string slice directly.
  Reassembly is plain concatenation of the slices; the result is the original
  JSON string verbatim. No base64, no ~33% inflation, no extra decode pass, and
  the memory ceiling stays close to `payload × (small constant)`.

**Rationale.** `utf8-slice` is strictly cheaper on both wire size and memory for
the one payload shape we ever chunk (a JSON message), and the only thing
`utf8-base64` buys — tolerance for splitting mid-codepoint — is unnecessary when
the sender controls the split points and splits on codepoint boundaries by
construction. The codepoint-boundary rule is a sender obligation: a frame's
`data` MUST NOT split a multi-byte UTF-8 sequence, so the receiver can decode
each frame as valid UTF-8 and concatenate without re-aligning bytes across frame
edges. `utf8-base64` remains a defined alternative in the wire schema for future
use (e.g. a non-text payload), but tywrap does not emit it in 0.8.0.

> Implementation note for later workstreams: `total` and the per-frame split
> points are computed over the message's UTF-8 **byte** length against
> `maxFrameBytes` (the frame ceiling is a byte limit), but each frame boundary is
> snapped back to the nearest codepoint boundary at or before the byte limit so
> no multi-byte sequence is split. `totalBytes` is the exact UTF-8 byte length of
> the full reassembled message.

## Correlation and reassembly

- **Correlation** reuses the existing RPC `id`. A receiver groups inbound frames
  by `(stream, id)`.
- `seq` is zero-based and dense: a complete stream has exactly one frame for each
  `seq` in `[0, total)`.
- `total` and `totalBytes` are repeated on every frame and MUST be identical
  across all frames of a stream; a mismatch is a framing error.

After the receiver has all `total` frames for an `id`, it validates **before**
decoding:

1. `frameProtocol === FRAME_PROTOCOL_ID` on every frame.
2. No duplicate `seq`; the full `[0, total)` range is present exactly once.
3. The number of frames equals `total`.
4. The concatenated payload's UTF-8 byte length equals `totalBytes` exactly.
5. The concatenated payload decodes as strict UTF-8.

Only when all five hold does the framing layer hand the reassembled string to the
existing JSON/codec path and resolve the pending `id`. Any failure rejects the
pending `id` and marks the subprocess for restart (the stdout stream can no
longer be trusted to be frame-aligned). There is no silent single-frame fallback:
a payload that requires chunking against a bridge that cannot chunk fails
explicitly.

## Negotiation handshake

The subprocess spawns the bridge with three env vars:

| Env var                          | Value                                  |
| -------------------------------- | -------------------------------------- |
| `TYWRAP_TRANSPORT_CHUNKING`      | `1` to enable framing                  |
| `TYWRAP_TRANSPORT_FRAME_PROTOCOL`| `tywrap-frame/1`                       |
| `TYWRAP_TRANSPORT_MAX_FRAME_BYTES`| the JSONL `maxLineLength`             |

After spawn, the JS side issues a small **unchunked** `tywrap/1` `meta` probe. A
bridge that understands framing returns a `transport` block in its `BridgeInfo`:

```json
{
  "transport": {
    "frameProtocol": "tywrap-frame/1",
    "supportsChunking": true,
    "maxFrameBytes": 104857600
  }
}
```

- If the `transport` block is **present** and `supportsChunking: true`, the JS
  side may fragment requests and expect fragmented responses up to
  `maxFrameBytes` per frame.
- If the block is **absent** (an old bridge, or HTTP/Pyodide), small calls still
  work unchanged. Payloads that *require* chunking fail explicitly — **no silent
  single-frame fallback** that would either truncate or blow the line ceiling.

The `BridgeInfo.transport` block (TypeScript type `BridgeTransportInfo`) is
**optional** in the wire contract. The `meta` validator
(`validateBridgeInfoPayload` in `src/runtime/rpc-client.ts`) validates the block
when present and **carries it through** so negotiation data survives; absence is
backward compatible.

### Validator changes that land in W1

The same pass relaxes two over-strict `meta` checks so the honest per-backend
identities validate:

- `bridge` accepts the full `BridgeBackend` union
  (`python-subprocess` | `pyodide` | `http`) instead of hardcoding
  `python-subprocess`. All backends speak the identical `tywrap/1` protocol; this
  lets the Pyodide and HTTP facades route `getBridgeInfo()` through the same
  validator. (Today the Python subprocess server reports `python-subprocess`,
  the Pyodide bootstrap reports `pyodide`; HTTP uses the subprocess server and so
  reports `python-subprocess`. Honest per-backend HTTP reporting is a possible
  followup, but accepting the union now is safe and backward compatible.)
- `pid` accepts a positive integer **or** `null`. Subprocess reports a real OS
  pid; in-WASM Pyodide (and HTTP) have no local process and report `null`.

## Backpressure

The TS side needs a per-logical-request write mutex so one request's frames are
written contiguously to stdin (reuse the existing `writeToStdin` drain
primitive); interleaving two requests' frames would corrupt both streams. Python
writes and flushes one frame at a time; the OS pipe provides backpressure.

## Timeout, abort, and late-frame discard

One timeout spans the whole logical exchange: request-write + execution +
response-read + reassembly. On timeout or abort:

- The JS side stops writing further request frames, rejects the logical `send`,
  and marks the `id` as timed out.
- **Late response frames must be tracked and discarded.** A multi-frame response
  may still be arriving when the timeout fires. The current one-shot "consume a
  single timed-out id" logic is insufficient for streams: leftover frames for a
  timed-out `id` would otherwise desync the stdout reader and corrupt the next
  response. The reassembler keeps a discard set of timed-out ids and drops every
  frame whose `id` is in that set until the stream for that `id` completes (its
  `total`-th frame arrives) or the subprocess is restarted.

## Errors mid-stream

- **Ordinary Python exceptions** stay normal: they serialize to a (possibly
  chunked) `ProtocolResponse.error` and flow through the standard path.
- **Framing failures** emit `__tywrap_frame__: "error"` where the sender can
  still write (so the receiver learns the stream is aborted rather than waiting
  for frames that will never come).
- **Unrecoverable framing corruption** — a malformed frame, a duplicate `seq`, a
  `totalBytes` mismatch, an unknown `frameProtocol`, or non-frame stdout
  pollution — rejects the pending `id` and marks the subprocess for restart,
  because the stdout stream can no longer be trusted to be frame-aligned.
