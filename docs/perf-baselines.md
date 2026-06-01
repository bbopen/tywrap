# Data-plane performance baselines

This document records **indicative** baseline numbers for tywrap's hot
data-plane paths. They are measure-first observations captured to give the
0.8.0 release a real harness to layer perf **gates** on top of. As of this
writing there is **no perf gating** — the benchmarks assert only that the
measured work happened, then print timings.

> **Absolute numbers are machine-dependent and indicative only.** Do not treat
> them as targets. The value here is the *relative* harness: re-run on the same
> machine before/after a change to detect regressions, and use these as the
> starting point for 0.8.0 threshold selection (gate on a generous multiple of
> the observed baseline, not the raw number).

## What is measured

The benchmarks live in [`test/data-plane-benchmarks.test.ts`](../test/data-plane-benchmarks.test.ts)
and cover the paths flagged in the 0.7.0 expert review (D1):

| Benchmark | Path exercised |
|-----------|----------------|
| Arrow encode+decode round-trip: ndarray | `tableFromArrays` → `tableToIPC` → base64 → `decodeValueAsync` (ndarray envelope, with reshape) |
| Arrow encode+decode round-trip: DataFrame | multi-column Arrow IPC → base64 → `decodeValueAsync` (dataframe envelope) |
| 100k-row DataFrame decode latency | decode-only of a pre-built 100k-row Arrow payload |
| ~5MB payload size-check overhead | `BridgeCodec.decodeResponse` incl. the `maxPayloadBytes` UTF-8 size guard + JSON parse |
| PooledTransport throughput | `PooledTransport` (over `TransportPool`) dispatch overhead for repeated small calls, using an in-memory echo transport (no Python subprocess) |

All inputs are synthetic in-memory data built with `apache-arrow` (a
devDependency). No live Python subprocess is required.

## How to run

The benchmarks are gated behind `TYWRAP_PERF_BUDGETS=1` so the normal suite is
unaffected (they `describe.skip` otherwise). `--expose-gc` lets the harness
settle the heap between runs:

```bash
TYWRAP_PERF_BUDGETS=1 NODE_OPTIONS=--expose-gc npx vitest run \
  test/data-plane-benchmarks.test.ts --reporter=verbose
```

Each benchmark prints a line prefixed with `[data-plane-bench]`.

### Tuning knobs (env vars)

All iteration counts and sizes are overridable so the same harness can be
dialed up for a dedicated bench run or down for CI smoke:

| Var | Default | Benchmark |
|-----|---------|-----------|
| `TYWRAP_BENCH_NDARRAY_LEN` / `TYWRAP_BENCH_NDARRAY_ITERS` | 1000 / 500 | ndarray round-trip |
| `TYWRAP_BENCH_DF_ROWS` / `TYWRAP_BENCH_DF_COLS` / `TYWRAP_BENCH_DF_ITERS` | 1000 / 8 / 300 | DataFrame round-trip |
| `TYWRAP_BENCH_DF_LARGE_ROWS` / `TYWRAP_BENCH_DF_LARGE_COLS` / `TYWRAP_BENCH_DF_LARGE_ITERS` | 100000 / 4 / 20 | 100k-row decode |
| `TYWRAP_BENCH_PAYLOAD_BYTES` / `TYWRAP_BENCH_PAYLOAD_ITERS` | 5 MiB / 100 | 5MB size-check |
| `TYWRAP_BENCH_POOL_CALLS` / `TYWRAP_BENCH_POOL_WORKERS` / `TYWRAP_BENCH_POOL_CONCURRENCY` | 10000 / 4 / 8 | pooled transport |

## Recorded local baseline

Captured locally on the 0.7.0 refactor branch. Two consecutive runs shown to
illustrate run-to-run variance.

- **Machine:** Apple Silicon (darwin), Node 25
- **Date:** 2026-05-31

| Benchmark | Run 1 | Run 2 |
|-----------|-------|-------|
| Arrow ndarray round-trip (1000 elems) | 0.107 ms/op | 0.105 ms/op |
| Arrow DataFrame round-trip (1000×8) | 0.201 ms/op | 0.199 ms/op |
| 100k-row DataFrame decode (100000×4) | 0.552 ms/op | 0.558 ms/op |
| ~5MB payload decode incl. size guard (5,242,922 bytes) | 5.116 ms/op | 5.142 ms/op |
| PooledTransport small calls (4 workers, conc 8) | ~2.45M ops/sec | ~2.28M ops/sec |

These numbers are stable run-to-run on this machine (single-digit-percent
spread), which is what matters for using them as a regression tripwire.

## Perf gates (0.8.0, #233)

0.8.0 layers actual **perf gates** on top of the measure-first harness above.
They live in [`test/data-plane-perf.test.ts`](../test/data-plane-perf.test.ts)
(also gated behind `TYWRAP_PERF_BUDGETS=1`) and assert budgets, where the
measure-first benchmarks only print. The suite first proves correctness at
scale (chunked 20 MiB + 80 MiB responses and a 20 MiB request echo, all forced
through `tywrap-frame/1` frames against a 1 MiB ceiling), then checks budgets:

| Gate | Budget |
|------|--------|
| Chunked 20 MiB response median vs same-run high-ceiling single frame | calibrated overhead ratio (inherent fragmentation cost, not the doc numbers) |
| `PooledTransport` small-call throughput (4 workers) | >= 70% of a same-run single-worker baseline |
| Arrow ndarray/DataFrame + 100k-row decode | <= 2.0x of a same-run warm baseline |
| Retained heap after an 80 MiB chunked response | <= `payload * 4 + fixed` (no quadratic growth) |

> **CI baselines are stored and compared SEPARATELY from this local doc.** The
> Apple-Silicon numbers in the table above are indicative only and are **not**
> used as CI thresholds. Every gate in `test/data-plane-perf.test.ts` is
> **same-run relative**: it measures a baseline in the same process on the same
> runner (median of 5, after warmup) and compares the subject against *that*,
> never against a hardcoded absolute. This keeps the gates portable across the
> Apple-Silicon dev machine and the pinned Linux CI runner without re-tuning.

The gates run in a dedicated `data-plane-perf` CI job (pinned Node 22 / Python
3.11, `TYWRAP_PERF_BUDGETS=1`, `NODE_OPTIONS=--expose-gc`, serial Vitest, no
coverage so instrumentation does not skew timings). That job is part of the
`required` gate; release publishing additionally re-runs the full suite with
`TYWRAP_PERF_BUDGETS=1`, so the data-plane gates also fence the npm publish.

```bash
TYWRAP_PERF_BUDGETS=1 NODE_OPTIONS=--expose-gc npx vitest run \
  test/data-plane-perf.test.ts --reporter=verbose
```
