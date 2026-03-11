# Environment Variables

All `TYWRAP_*` environment variables are read at runtime by the bridge.

## Reference

| Variable | Runtimes | Default | Description |
|----------|----------|---------|-------------|
| `TYWRAP_PYTHON_PATH` | Node, Bun, Deno | auto-detect | Path to the Python executable (e.g. `/usr/bin/python3`) |
| `TYWRAP_VIRTUAL_ENV` | Node, Bun, Deno | — | Path to a virtual environment directory |
| `TYWRAP_CODEC_FALLBACK` | Node, HTTP | `arrow` | Set to `json` to disable Apache Arrow and use JSON-only transport |
| `TYWRAP_CODEC_MAX_BYTES` | Node, HTTP | `1048576` (1 MB) | Maximum serialized response size in bytes. Requests exceeding this fail with an explicit error. |
| `TYWRAP_REQUEST_MAX_BYTES` | Node, HTTP | — | Maximum serialized request size in bytes. Unbounded by default. |
| `TYWRAP_TORCH_ALLOW_COPY` | Node, HTTP | `false` | Set to `true` to allow implicit GPU→CPU tensor copies when serializing `torch.Tensor`. |
| `TYWRAP_PERF_BUDGETS` | Test suite | — | Set to `1` to enable performance budget assertions in the test suite. |

## Usage Examples

### Explicit Python path

```bash
TYWRAP_PYTHON_PATH=/opt/homebrew/bin/python3 node dist/app.js
```

### Virtual environment

```bash
TYWRAP_VIRTUAL_ENV=.venv node dist/app.js
```

### JSON-only transport (disable Arrow)

```bash
TYWRAP_CODEC_FALLBACK=json node dist/app.js
```

### Cap response size at 10 MB

```bash
TYWRAP_CODEC_MAX_BYTES=10485760 node dist/app.js
```

## Precedence

Environment variables are fallbacks — constructor options take precedence:

```typescript
// Constructor option wins over TYWRAP_PYTHON_PATH
new NodeBridge({ pythonPath: '/my/python' })
```

## Subprocess Environment Inheritance

By default, `NodeBridge` inherits only `PATH`, `PYTHON*`, and `TYWRAP_*` from `process.env` to keep the subprocess environment minimal. To pass the full environment:

```typescript
new NodeBridge({ inheritProcessEnv: true })
```
