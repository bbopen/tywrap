# Environment Variables

This page lists the implemented `TYWRAP_*` environment variables in the repo
today.

## Bridge and Codec

These affect the Python bridge or decoded runtime behavior.

| Variable                   | Scope         | Default | Purpose                                                                        |
| -------------------------- | ------------- | ------- | ------------------------------------------------------------------------------ |
| `TYWRAP_CODEC_FALLBACK`    | Python bridge | unset   | Set to `json` to allow JSON fallback when Arrow encoding is unavailable        |
| `TYWRAP_CODEC_MAX_BYTES`   | Python bridge | unset   | Reject response payloads larger than this byte count                           |
| `TYWRAP_REQUEST_MAX_BYTES` | Python bridge | unset   | Reject request payloads larger than this byte count                            |
| `TYWRAP_TORCH_ALLOW_COPY`  | Python bridge | off     | Allow GPU-to-CPU or contiguous-copy conversion when serializing `torch.Tensor` |

## Logging

These control the structured logger in the JavaScript runtime.

| Variable           | Default | Purpose                                           |
| ------------------ | ------- | ------------------------------------------------- |
| `TYWRAP_LOG_LEVEL` | `WARN`  | One of `DEBUG`, `INFO`, `WARN`, `ERROR`, `SILENT` |
| `TYWRAP_LOG_JSON`  | `false` | Set to `1` or `true` for JSON log output          |

## Repo Test and Benchmark Knobs

These are used by the tywrap test suite and maintenance workflows. They are not
required for normal library use.

| Variable                             | Purpose                                          |
| ------------------------------------ | ------------------------------------------------ |
| `TYWRAP_CODEC_PYTHON`                | Python executable for codec-heavy tests          |
| `TYWRAP_PERF_BUDGETS`                | Enable performance budget suites                 |
| `TYWRAP_PERF_TIME_BUDGET_MS`         | Time budget for generator performance tests      |
| `TYWRAP_PERF_MEMORY_BUDGET_MB`       | Memory budget for generator performance tests    |
| `TYWRAP_CODEC_PERF_ITERATIONS`       | Iteration count for codec performance tests      |
| `TYWRAP_CODEC_PERF_TIME_BUDGET_MS`   | Time budget for codec performance tests          |
| `TYWRAP_CODEC_PERF_MEMORY_BUDGET_MB` | Memory budget for codec performance tests        |
| `TYWRAP_ADVERSARIAL`                 | Enable adversarial bridge tests                  |
| `TYWRAP_ADVERSARIAL_PYTHON`          | Python executable override for adversarial tests |

## Common Examples

Use JSON fallback:

```bash
export TYWRAP_CODEC_FALLBACK=json
```

Cap response and request payload size:

```bash
export TYWRAP_CODEC_MAX_BYTES=10485760
export TYWRAP_REQUEST_MAX_BYTES=1048576
```

Enable JSON logs:

```bash
export TYWRAP_LOG_LEVEL=INFO
export TYWRAP_LOG_JSON=1
```

## Not Configured Through Env Vars

Python executable and virtual environment selection are configured through code
or config files today:

```ts
new NodeBridge({ pythonPath: '/usr/bin/python3', virtualEnv: './venv' });
```

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  runtime: {
    node: {
      pythonPath: 'python3',
      virtualEnv: './venv',
      timeout: 30000,
    },
  },
});
```
