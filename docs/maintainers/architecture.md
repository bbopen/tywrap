# Architecture

tywrap has a generation pipeline and a runtime pipeline. The generation
pipeline turns Python declarations into TypeScript wrappers. The runtime
pipeline executes a generated call and returns a decoded result that must match
the declared return schema.

## Pipeline

| Stage | Owners | Invariant |
| --- | --- | --- |
| Python analysis | `tywrap_ir/tywrap_ir/__main__.py`, `tywrap_ir/tywrap_ir/` | The extractor emits JSON typed IR for the requested module. |
| IR contract | `src/tywrap.ts`, `src/types/` | A contract has the expected module and `ir_version`. The current version is `0.4.0`. |
| Wrapper generation | `src/core/generator.ts`, `src/core/emit-call.ts`, `src/core/mapper.ts` | Generated calls carry a `ReturnSchema` that represents the Python return annotation. |
| Runtime transport | `src/runtime/node.ts`, `src/runtime/subprocess-transport.ts`, `src/runtime/frame-codec.ts`, `runtime/python_bridge.py` | Node subprocess requests use JSONL and negotiate `tywrap-frame/1` when a message exceeds one line. |
| Python dispatch and encoding | `runtime/tywrap_bridge_core.py`, `runtime/safe_codec.py` | The bridge validates protocol input, then dispatches the requested call and returns JSON-safe values or versioned envelopes. |
| JavaScript decoding | `src/utils/codec.ts`, `src/runtime/bridge-codec.ts` | Envelope shape and payload domains are checked before a decoded value reaches application code. |
| Return validation | `src/runtime/validators.ts` | A decoded result matches the generated `ReturnSchema`, including scientific provenance when declared. |

## IR and generated contracts

`generate()` in `src/tywrap.ts` invokes `python -m tywrap_ir --module <name>`.
It validates the returned object before passing it to `CodeGenerator`. The
generator writes `<module>.generated.ts` and the stable
`<module>.contract.json` file beside it. The contract omits extractor metadata,
sorts object keys, and records the pinned IR representation.

`contractInput` changes the source of IR. Instead of starting Python, generation
reads a saved contract and applies the same module and version validation. This
supports reproducible generation. A version mismatch is a hard failure: update
the matching package pair and regenerate the contract.

`src/core/generator.ts` maps annotations to TypeScript and emits one
`createReturnValidator()` call per generated callable. Return schemas cover
primitive values, containers, definitions, and scientific markers. The
wrapper calls the active bridge and validates the resolved value before its
promise resolves.

## Runtime bridges

`NodeBridge` starts `runtime/python_bridge.py` through the subprocess transport.
Normal requests and responses are JSONL. When a request or response crosses the
line ceiling, `src/runtime/frame-codec.ts` splits it into negotiated
`tywrap-frame/1` frames. Reassembly remains bounded by the codec payload limit.

`PyodideBridge` runs the shared Python bridge core in WebAssembly. Its generated
bootstrap source lives in `src/runtime/pyodide-bootstrap-core.generated.ts`; do
not edit it directly. Regenerate it from `runtime/tywrap_bridge_core.py` with
the repository script. Pyodide uses JSON codec envelopes because pyarrow is not
available in WASM.

`HttpBridge` sends the same RPC and codec concepts to a remote Python service.
The transport owns HTTP concerns while the codec and return validator preserve
the client-side invariants.

## Codec envelopes

`runtime/tywrap_bridge_core.py` recognizes scientific values and replaces them
with envelopes marked by `__tywrap__`, `codecVersion: 1`, and an `encoding`.
The marker set is `ndarray`, `dataframe`, `series`, `scipy.sparse`,
`torch.tensor`, and `sklearn.estimator`. `src/utils/codec.ts` is the matching
decoder and validates each envelope before decoding it.

Arrow is the default for scientific arrays and pandas tabular values when
Python has pyarrow and JavaScript has an Arrow decoder. JSON fallback is
explicit through `TYWRAP_CODEC_FALLBACK=json`; it has narrower, documented
domains. Pandas JSON values require an unnamed zero-based
`RangeIndex`, and unsupported dtypes fail with a conversion recipe.

Nested arrays and plain objects can contain envelopes. The producer permits a
depth of 900 and at most 1,000,000 visited containers. The decoder permits a
depth of 2048 and the same container count. The budget excludes primitive
leaves. A decoded envelope is terminal, except for
the required nested ndarray inside a torch envelope.

## Runtime return validation

`src/runtime/validators.ts` validates the value after decoding. A mismatch
throws `BridgeValidationError` with the call site, declared type, and received
shape. Scientific values retain non-enumerable provenance from their envelope.
The validator checks the marker and, when the schema declares them, dimensions
and dtype without walking Arrow payload data. `unknown`, `void`, and `Any`
returns deliberately receive no runtime check.

## One call end to end

1. A generated call such as `math.sqrt(16)` builds a bridge request and its
   generated `ReturnSchema` validator.
2. `NodeBridge` sends the request over JSONL, or `tywrap-frame/1` frames when
   it is too large for one line.
3. `runtime/python_bridge.py` reads the request and calls
   `dispatch_request()` in `runtime/tywrap_bridge_core.py`.
4. The core imports the requested module, dispatches `sqrt`, and serializes its
   result. A scientific result becomes a version-1 envelope; a plain number
   remains JSON.
5. The subprocess transport returns the response. `BridgeCodec` and
   `decodeEnvelopeAsync()` validate and decode its value.
6. The generated return validator accepts the decoded number and resolves the
   promise. A mismatched value throws `BridgeValidationError` instead.

Read [Scientific Codec Envelopes](/codec-envelopes) before changing an
envelope. It defines the supported JSON domains and validation behavior.
