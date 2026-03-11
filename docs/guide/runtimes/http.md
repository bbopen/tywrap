# HTTP Bridge Guide

`HttpBridge` connects to a Python server over HTTP. Use it when Python must run separately — including Deno Deploy, serverless environments, or distributed architectures.

## When to Use HttpBridge

- You cannot spawn subprocesses (Deno Deploy, Cloudflare Workers, serverless)
- Python must run on a dedicated server for resource reasons
- You want to share one Python server across multiple TypeScript clients

## Installation

```bash
npm install tywrap
pip install tywrap-ir
```

## TypeScript Setup

```typescript
import { HttpBridge } from 'tywrap/http';
import { setRuntimeBridge } from 'tywrap/runtime';

setRuntimeBridge(new HttpBridge({
  baseURL: 'http://localhost:8080',
  timeoutMs: 30000,
  headers: {
    'Authorization': 'Bearer your-token',
  },
}));
```

## Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `baseURL` | Yes | — | Base URL of the Python bridge server |
| `headers` | No | `{}` | Additional HTTP headers (auth, CORS, etc.) |
| `timeoutMs` | No | `30000` | Request timeout in milliseconds |
| `codec` | No | Arrow | Codec options |

## Running the Python Server

Start the Python bridge server:

```bash
pip install tywrap-ir
python -m tywrap_ir.server --port 8080
```

> **Note:** HTTP transport is stateless — each call is an independent POST request with no session state.

## Apache Arrow

Arrow binary transport works over HTTP. Register a decoder to enable it:

```typescript
import { registerArrowDecoder } from 'tywrap';
import { tableFromIPC } from 'apache-arrow';

registerArrowDecoder(bytes => tableFromIPC(bytes));
```

## Environment Variables

| Var | Purpose |
|-----|---------|
| `TYWRAP_CODEC_FALLBACK=json` | Disable Arrow, use JSON only |
| `TYWRAP_CODEC_MAX_BYTES` | Cap max response size |

See the [environment variables reference](/reference/env-vars).

## Security

- Always use HTTPS in production
- Set `Authorization` headers for server access control
- Consider rate-limiting the Python server endpoint
