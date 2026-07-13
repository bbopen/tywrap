# Data-plane performance baselines

This document records historical local baseline numbers for tywrap's
data-plane paths. The repository now enforces performance budgets in a
required `data-plane-perf` CI job. That job sets
`TYWRAP_DATA_PLANE_PERF=1` to enable the assertions in
`test/data-plane-perf.test.ts`.

> **The recorded numbers are machine-dependent historical observations.** Do
> not treat them as current targets or CI thresholds. Re-run the harness on the
> same machine before and after a change when you need a local comparison. CI
> uses same-run relative budgets instead of the absolute values below.

## What is measured

The benchmarks live in [`test/data-plane-benchmarks.test.ts`](../test/data-plane-benchmarks.test.ts)
and cover the paths flagged in the 0.7.0 expert review (D1):

| Benchmark | Path exercised |
|-----------|----------------|
| Arrow encode+decode round-trip: ndarray | `tableFromArrays`, then `tableToIPC`, base64, and `decodeValueAsync` (ndarray envelope, with reshape) |
| Arrow encode+decode round-trip: DataFrame | multi-column Arrow IPC, then base64 and `decodeValueAsync` (dataframe envelope) |
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

Captured locally on the 0.7.0 refactor branch. These are historical local
baselines. Two consecutive runs show the observed run-to-run variance.

- Machine is Apple Silicon (darwin), Node 25
- **Date:** 2026-05-31

| Benchmark | Run 1 | Run 2 |
|-----------|-------|-------|
| Arrow ndarray round-trip (1000 elems) | 0.107 ms/op | 0.105 ms/op |
| Arrow DataFrame round-trip (1000 by 8) | 0.201 ms/op | 0.199 ms/op |
| 100k-row DataFrame decode (100000 by 4) | 0.552 ms/op | 0.558 ms/op |
| ~5MB payload decode incl. size guard (5,242,922 bytes) | 5.116 ms/op | 5.142 ms/op |
| PooledTransport small calls (4 workers, conc 8) | ~2.45M ops/sec | ~2.28M ops/sec |

These historical numbers had a single-digit percentage spread on this
machine. They remain a record of the local harness and are not CI thresholds.

## Current perf gates

The enforced budgets live in
[`test/data-plane-perf.test.ts`](../test/data-plane-perf.test.ts). Setting
`TYWRAP_DATA_PLANE_PERF=1` enables them. The required `data-plane-perf` CI
job runs the suite. It first proves correctness at scale with chunked 20 MiB
and 80 MiB responses plus a 20 MiB request echo. Each case uses
`tywrap-frame/1` frames against a 1 MiB ceiling. The suite then checks these
budgets:

| Gate | Budget |
|------|--------|
| Chunked 20 MiB response median vs same-run high-ceiling single frame | calibrated overhead ratio (inherent fragmentation cost, not the doc numbers) |
| `PooledTransport` small-call throughput (4 workers) | >= 70% of a same-run single-worker baseline |
| Arrow ndarray/DataFrame + 100k-row decode | <= 2.0x of a same-run warm baseline |
| Retained heap after an 80 MiB chunked response | <= `payload * 4 + fixed` (no quadratic growth) |

> **CI compares same-run baselines rather than the local numbers in this
> document.** Each gate measures a baseline in the same process on the same
> runner, using a median of five after warmup, and compares the subject against
> that result. The gates do not use a hardcoded absolute threshold.

The gates run in a dedicated `data-plane-perf` CI job with pinned Node 22 and
Python 3.11, `TYWRAP_DATA_PLANE_PERF=1`, `NODE_OPTIONS=--expose-gc`, serial
Vitest, and no coverage. That job is part of the `required` gate. Release
publishing reruns the full suite with `TYWRAP_PERF_BUDGETS=1`, while the
dedicated data-plane gate is enforced by required CI.

```bash
TYWRAP_DATA_PLANE_PERF=1 NODE_OPTIONS=--expose-gc npx vitest run \
  test/data-plane-perf.test.ts --reporter=verbose
```
