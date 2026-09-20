# Value contracts

The frozen internal prototype is [value-contracts.v1.json](value-contracts.v1.json).
That JSON file owns the policy. The TypeScript interface mirrors it and has revision 1.

Each contract names a logical value, its wire encoding, its decoded JavaScript value, and its constraints. A sequence or record holds child contracts. The prototype covers float16 ndarrays and Torch tensors. Other Arrow types keep their existing rules. In particular, Arrow int64 may decode as `bigint`. Unsupported conversions carry a reason and guidance.

The wire stays at `tywrap/1` and scientific `codecVersion: 1`. Existing Arrow envelopes, JSON fallback, and transports keep their shape. The producer rejects unsafe Python integers before it writes JSON. A generated wrapper that consumes this interface must keep `number` for Python `int` and add a safe-integer return constraint. Regenerate wrappers after that compiler change. Do not return `bigint` under an existing `Promise<number>`.

Migration for users with large Python integers: convert them to strings in Python with an explicit return annotation, or keep integer columns in Arrow tables. JSON fallback for ndarray and pandas values still rejects unsafe integers. This is a behavior change from silent rounding to a call error.

The prototype covers safe integers, float16 Arrow ndarrays, Torch reuse, and nested records. Bigint and dataclass designs remain separate. Runtime changes and proof fixtures will follow this interface commit.
