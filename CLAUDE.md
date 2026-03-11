# AGENTS.md

> This file helps AI coding assistants (Cursor, Copilot, Claude Code, Devin, Jules, Aider, Warp)
> understand the tywrap codebase and contribute effectively.

## Project Overview

tywrap generates type-safe TypeScript wrappers for Python libraries. It has two components:
- **`tywrap`** (npm) — TypeScript/Node.js/Bun/Deno runtime bridges and CLI code generator
- **`tywrap-ir`** (PyPI) — Python AST analyzer that extracts typed IR from Python source

The generated wrappers let you call Python functions from TypeScript with full type safety,
using either a subprocess bridge (Node/Bun/Deno), in-browser WebAssembly (Pyodide), or HTTP.

## Build & Test Commands

```bash
# Setup
npm ci                          # Install Node.js dependencies
pip install -e tywrap_ir/       # Install Python component (editable)

# Build & type-check
npm run build                   # Compile TypeScript → dist/
npm run typecheck               # tsc --noEmit (no output)
npm run lint                    # ESLint on src/ and test/

# Test
npm test                        # Full Vitest suite
npm run test:types              # TSD type-level tests (test-d/)
npm run test:bun                # Bun-specific tests (requires Bun installed)
npm run test:coverage           # Coverage report → coverage/lcov.info

# Python integration tests
npm run test:python:suite:core  # Core Python libs (stdlib, etc.)
npm run test:python:suite:data  # Data libs (numpy, pandas, pyarrow)
```

## Repository Structure

```
src/
  cli.ts              # CLI entry point (tywrap init / generate)
  runtime/
    node.ts           # NodeBridge — subprocess-based (Node, Bun, Deno)
    pyodide.ts        # PyodideBridge — browser WebAssembly
    http.ts           # HttpBridge — remote Python server
  utils/
    runtime.ts        # detectRuntime(), isBun(), isDeno(), etc.
tywrap_ir/            # Python package: AST analysis → typed IR
  tywrap_ir/
    __main__.py       # CLI entry: tywrap-ir
runtime/
  python_bridge.py    # Python subprocess server (JSONL protocol)
test/                 # Vitest tests mirroring src/ structure
test-d/               # TSD type tests
docs/                 # Documentation (VitePress site)
examples/
  living-app/         # End-to-end example with pandas + Arrow
generated/            # Generated wrapper output (gitignored in user projects)
dist/                 # Compiled TypeScript output (do not edit)
```

## Code Conventions

- TypeScript strict mode; avoid `any` — use `unknown` and type guards instead
- Runtime bridges: `src/runtime/`; corresponding tests: `test/runtime_*.test.ts`
- Python code: `tywrap_ir/`; follow PEP 8, use type hints
- Generated files (`generated/`, `dist/`) — never edit manually
- `TYWRAP_PERF_BUDGETS=1` enables performance budget assertions in tests
- `NODE_OPTIONS=--expose-gc` required for GC-sensitive tests

## Commit Conventions

Conventional commits with scope:
- `feat(runtime): add warmup support`
- `fix(codec): handle oversized Arrow payloads`
- `test(pyodide): add retry regression`
- `docs: update Bun runtime guide`
- `chore: bump vitest`

## PR Guidelines

1. Include tests for new runtime behavior (see `test/runtime_*.test.ts` patterns)
2. Run `npm run check:all` before pushing — this runs format, lint, build, type tests, and unit tests
3. Wait for CI to be green including the `required` job
4. Resolve all CodeRabbit review threads before merging

## Environment Variables (for testing)

| Var | Purpose |
|-----|---------|
| `TYWRAP_PERF_BUDGETS=1` | Enable perf budget assertions |
| `NODE_OPTIONS=--expose-gc` | Enable GC for memory tests |
| `TYWRAP_CODEC_PYTHON=python` | Python path for codec tests |
| `TYWRAP_CODEC_MAX_BYTES` | Max response size (default 1MB) |
| `TYWRAP_CODEC_FALLBACK=json` | Disable Arrow, use JSON only |
