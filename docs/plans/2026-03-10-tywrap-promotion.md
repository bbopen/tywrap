# tywrap Promotion & Professionalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make tywrap discoverable, professional, and easy to maintain — through repository metadata fixes, a VitePress documentation site with full runtime guides (Node, Bun, Deno, Browser, HTTP), AI agent discoverability files, and GitHub automation.

**Architecture:** Phase 1 (metadata + README) is pure file edits with no runtime impact. Phase 2 (VitePress) builds a separate static site in `docs/.vitepress/` deployed via GitHub Actions to GitHub Pages. Phase 3 (automation) adds GitHub Actions workflows and a config file — zero changes to library code.

**Tech Stack:** VitePress (docs), GitHub Actions (CI/Pages/automation), actions/labeler@v6, actions/stale@v10, release-please, Renovate, Codecov

---

## Manual Pre-Steps (GitHub UI — do these first, no code required)

Before coding, do these in the GitHub repo UI at `github.com/bbopen/tywrap`:

1. **Settings > About** (gear icon on repo page):
   - Description: `Generate type-safe TypeScript wrappers for any Python library — Node.js, Deno, Bun, and browsers via Pyodide.`
   - Topics: `typescript`, `python`, `bridge`, `interop`, `type-safety`, `codegen`, `code-generation`, `ast`, `pyodide`, `node`, `bun`, `deno`, `ffi`, `bindings`, `numpy`, `pandas`, `developer-tools`, `python-interop`

2. **Social preview:** go to `https://socialify.git.ci/bbopen/tywrap`, download the PNG, upload it via Settings > General > Social preview

3. **Discussions:** Settings > General > Features > check "Discussions". Create categories: Q&A, Show and Tell, Ideas. Pin a welcome post.

4. **Labels:** Add these via Issues > Labels > New label:
   - `good first issue` (green `#7057ff`) — note: GitHub may already have this
   - `help wanted` (green `#008672`) — may already exist
   - `area:runtime` (blue `#0075ca`)
   - `area:codegen` (orange `#e4e669`)
   - `area:types` (purple `#d93f0b`)
   - `area:docs` (yellow `#fef2c0`)
   - `area:ci` (gray `#cccccc`)
   - `breaking` (red `#b60205`)

5. **Tag 2-3 open issues** with `good first issue` and `help wanted`.

6. **GitHub Pages:** Settings > Pages > Source: set to "GitHub Actions" (not a branch). Do this before the docs workflow runs.

7. **Codecov:** Sign up at codecov.io with your GitHub account, authorize the `bbopen/tywrap` repo, copy the `CODECOV_TOKEN`, add it as a repo secret: Settings > Secrets > Actions > New repository secret, name `CODECOV_TOKEN`.

---

## Phase 1: Quick Wins — Package Metadata & README

### Task 1: Clean up `package.json` metadata

**Files:**
- Modify: `package.json`

**Step 1: Edit `package.json`**

Change `description` from:
```
"TypeScript wrapper for Python libraries with full type safety (EXPERIMENTAL - v0.2.1)"
```
to:
```
"Generate type-safe TypeScript wrappers for any Python library — Node.js, Deno, Bun, and browsers via Pyodide."
```

Change `homepage` from:
```
"https://github.com/bbopen/tywrap#readme"
```
to:
```
"https://bbopen.github.io/tywrap"
```

Add these keywords to the existing `keywords` array (keep existing, add new ones):
```json
"codegen", "ffi", "bindings", "wrapper", "numpy", "pandas", "scipy", "python-wrapper", "rpc", "subprocess"
```

Final keywords array should be:
```json
"keywords": [
  "typescript", "python", "bridge", "type-safety", "type-safe",
  "interop", "pyodide", "ast", "code-generation", "codegen",
  "node", "deno", "bun", "ffi", "bindings", "wrapper",
  "numpy", "pandas", "scipy", "python-wrapper", "rpc", "subprocess"
]
```

**Step 2: Verify**
```bash
npm pack --dry-run 2>&1 | head -20
```
Expected: shows updated description in output (no EXPERIMENTAL text).

**Step 3: Commit**
```bash
git add package.json
git commit -m "chore: clean up package.json metadata for npm discoverability"
```

---

### Task 2: Clean up `tywrap_ir/pyproject.toml`

**Files:**
- Modify: `tywrap_ir/pyproject.toml`

**Step 1: Edit `tywrap_ir/pyproject.toml`**

Update `keywords`:
```toml
keywords = ["tywrap", "typescript", "python", "bridge", "code-generation", "ast", "ir", "interop", "type-safe", "bindings", "ffi", "codegen"]
```

Add new classifiers (append after existing ones, before the closing `]`):
```toml
  "Topic :: Software Development :: Compilers",
  "Topic :: Utilities",
  "Environment :: Console",
```

Update `[project.urls]` Documentation:
```toml
Documentation = "https://bbopen.github.io/tywrap"
```

**Step 2: Verify**
```bash
cd tywrap_ir && python -c "import tomllib; d = tomllib.load(open('pyproject.toml','rb')); print(d['project']['classifiers'])"
```
Expected: list including `"Topic :: Software Development :: Compilers"`.

**Step 3: Commit**
```bash
git add tywrap_ir/pyproject.toml
git commit -m "chore: update tywrap-ir PyPI classifiers and docs URL"
```

---

### Task 3: Update `README.md`

**Files:**
- Modify: `README.md`

**Step 1: Add two new badges** — insert after the existing 4 badges (after the CI badge line):
```markdown
[![npm downloads](https://img.shields.io/npm/dm/tywrap.svg)](https://www.npmjs.com/package/tywrap)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
```

**Step 2: Add a Documentation badge/link** — add after the existing badge block:
```markdown
[![Docs](https://img.shields.io/badge/docs-bbopen.github.io%2Ftywrap-blue)](https://bbopen.github.io/tywrap)
```

**Step 3: Update the ⚠️ experimental notice** — replace existing notice:
```markdown
> **⚠️ Experimental Software (v0.2.1)** - APIs may change between versions. Not recommended for production use until v1.0.0.
```
with:
```markdown
> **⚠️ Experimental** — APIs may change before v1.0.0. See [CHANGELOG](./CHANGELOG.md) for breaking changes.
```

**Step 4: Add "Why tywrap?" section** — insert after the `## Features` section and before `## Requirements`:

```markdown
## Why tywrap?

| Feature | tywrap | pythonia | node-calls-python | pymport |
|---------|--------|----------|-------------------|---------|
| Auto-generated TypeScript types | Yes | No | No | No |
| Browser / WASM (Pyodide) | Yes | No | No | No |
| numpy / pandas type mappings | Yes | No | No | No |
| Node.js + Bun + Deno | All three | Node only | Node only | Node only |
| Apache Arrow binary transport | Yes | No | No | No |
```

**Step 5: Add star CTA** — insert immediately after the `## Quick Start` closing code block:
```markdown
> If tywrap saves you time, a ⭐ on GitHub helps others find it.
```

**Step 6: Commit**
```bash
git add README.md
git commit -m "docs: add Why tywrap comparison table, badges, and star CTA"
```

---

### Task 4: Create `AGENTS.md` and `CLAUDE.md`

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`

**Step 1: Create `AGENTS.md`** at the repo root with this content:

```markdown
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
docs/                 # Documentation (migrated to VitePress)
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
```

**Step 2: Create `CLAUDE.md`** — identical content to `AGENTS.md`. Run:
```bash
cp AGENTS.md CLAUDE.md
```

**Step 3: Commit**
```bash
git add AGENTS.md CLAUDE.md
git commit -m "docs: add AGENTS.md and CLAUDE.md for AI coding agent discoverability"
```

---

## Phase 2: VitePress Documentation Site

### Task 5: Install VitePress and add npm scripts

**Files:**
- Modify: `package.json`

**Step 1: Install VitePress**
```bash
npm install --save-dev vitepress
```

**Step 2: Add scripts** — add to the `scripts` block in `package.json`:
```json
"docs:dev": "vitepress dev docs",
"docs:build": "vitepress build docs",
"docs:preview": "vitepress preview docs"
```

**Step 3: Verify VitePress installed**
```bash
npx vitepress --version
```
Expected: prints a version like `1.x.x`.

**Step 4: Commit**
```bash
git add package.json package-lock.json
git commit -m "chore: install vitepress and add docs scripts"
```

---

### Task 6: Create VitePress config

**Files:**
- Create: `docs/.vitepress/config.ts`

**Step 1: Create the config file**

```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'tywrap',
  description: 'Generate type-safe TypeScript wrappers for any Python library — Node.js, Deno, Bun, and browsers via Pyodide.',
  base: '/tywrap/',
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', href: '/tywrap/favicon.ico' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'tywrap',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'GitHub',
        link: 'https://github.com/bbopen/tywrap',
        target: '_blank',
      },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' },
          {
            text: 'Runtime Bridges',
            collapsed: false,
            items: [
              { text: 'Comparison', link: '/guide/runtimes/comparison' },
              { text: 'Node.js', link: '/guide/runtimes/node' },
              { text: 'Bun', link: '/guide/runtimes/bun' },
              { text: 'Deno', link: '/guide/runtimes/deno' },
              { text: 'Browser (Pyodide)', link: '/guide/runtimes/browser' },
              { text: 'HTTP Bridge', link: '/guide/runtimes/http' },
            ],
          },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Environment Variables', link: '/reference/env-vars' },
          { text: 'Type Mapping', link: '/reference/type-mapping' },
          { text: 'API', link: '/reference/api/' },
        ],
      },
      {
        text: 'Examples',
        items: [
          { text: 'Quick Examples', link: '/examples/' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'Troubleshooting', link: '/troubleshooting/' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/bbopen/tywrap' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/tywrap' },
    ],

    editLink: {
      pattern: 'https://github.com/bbopen/tywrap/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © tywrap contributors',
    },
  },
})
```

**Step 2: Commit**
```bash
git add docs/.vitepress/config.ts
git commit -m "docs: add vitepress config with full sidebar"
```

---

### Task 7: Create VitePress landing page

**Files:**
- Create: `docs/index.md`

**Step 1: Create `docs/index.md`** (VitePress home page format):

```markdown
---
layout: home

hero:
  name: tywrap
  text: TypeScript wrappers for Python libraries
  tagline: Auto-generate type-safe TypeScript bindings for any Python library — works in Node.js, Bun, Deno, and browsers via Pyodide.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/bbopen/tywrap

features:
  - icon: 🔒
    title: Full Type Safety
    details: TypeScript definitions generated directly from Python source analysis via AST — no manual type writing.
  - icon: 🌐
    title: Multi-Runtime
    details: One API across Node.js, Bun, Deno (subprocess), and browsers (Pyodide WebAssembly).
  - icon: ⚡
    title: Rich Data Types
    details: First-class support for numpy, pandas, scipy, torch, and sklearn with Apache Arrow binary transport.
  - icon: 🛠
    title: Zero-Config CLI
    details: Run `npx tywrap generate` and get production-ready TypeScript wrappers with a single command.
---

## Quick Start

```bash
npm install tywrap
pip install tywrap-ir
npx tywrap init
npx tywrap generate
```

```typescript
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import * as math from './generated/math.generated.js';

setRuntimeBridge(new NodeBridge({ pythonPath: 'python3' }));
const result = await math.sqrt(16); // 4 — fully typed
```

> ⚠️ **Experimental** — APIs may change before v1.0.0. See [CHANGELOG](https://github.com/bbopen/tywrap/blob/main/CHANGELOG.md) for breaking changes.

> If tywrap saves you time, a ⭐ on [GitHub](https://github.com/bbopen/tywrap) helps others find it.
```

**Step 2: Commit**
```bash
git add docs/index.md
git commit -m "docs: add vitepress landing page"
```

---

### Task 8: Migrate existing docs into VitePress structure

The existing docs are already at the right paths for VitePress (`docs/getting-started.md`, `docs/configuration.md`, etc.). VitePress will serve them from `docs/` automatically based on the sidebar config. You need to:

1. **Rename/move paths to match config:** The config uses `/guide/getting-started` etc., but existing files are at `docs/getting-started.md`. Move them:

```bash
mkdir -p docs/guide docs/guide/runtimes docs/reference docs/examples
mv docs/getting-started.md docs/guide/getting-started.md
mv docs/configuration.md docs/guide/configuration.md
mv docs/runtimes/nodejs.md docs/guide/runtimes/node.md
mv docs/runtimes/browser.md docs/guide/runtimes/browser.md
mv docs/type-mapping-matrix.md docs/reference/type-mapping.md
mv docs/api docs/reference/api
mv docs/examples/README.md docs/examples/index.md
mv docs/troubleshooting/README.md docs/troubleshooting/index.md
```

2. **Update cross-links** inside the moved files. Search for old relative paths like `../configuration.md` and update to the new paths. Use:
```bash
grep -r "\.\./\|getting-started\|configuration\|type-mapping-matrix" docs/guide/ docs/reference/
```
Then edit each file to fix broken relative links.

**Step 2: Verify locally**
```bash
npm run docs:dev
```
Open `http://localhost:5173/tywrap/guide/getting-started` — content should render with sidebar.

**Step 3: Commit**
```bash
git add docs/
git commit -m "docs: migrate existing docs into vitepress guide/reference structure"
```

---

### Task 9: New Bun runtime guide

**Files:**
- Create: `docs/guide/runtimes/bun.md`

**Step 1: Create the file**

```markdown
# Bun Runtime Guide

tywrap works with [Bun](https://bun.sh/) 1.1+ using the same `NodeBridge` as Node.js. No separate bridge or `npm:` prefix is needed.

## Installation

```bash
bun add tywrap
pip install tywrap-ir
```

## Basic Setup

```typescript
import { NodeBridge } from 'tywrap';  // main export, no /node needed
import { setRuntimeBridge } from 'tywrap/runtime';

setRuntimeBridge(new NodeBridge({
  pythonPath: 'python3',
  virtualEnv: '.venv',   // optional: path to your venv
  timeoutMs: 30000,
}));
```

> **Note:** With Bun you import from `'tywrap'` directly. This differs from Node.js where you may use `'tywrap/node'`.

## bunfig.toml

Tywrap ships with a `bunfig.toml` you can reference for build and run settings:

```toml
[build]
target = "bun"
format = "esm"
splitting = true
sourcemap = "external"
external = ["pyodide"]

[dev]
hot = true
```

## Configuration Options

`NodeBridge` accepts the same options under Bun as under Node.js. See the [Node.js guide](./node) for the full option reference.

Key options for Bun:

| Option | Default | Description |
|--------|---------|-------------|
| `pythonPath` | auto-detect | Path to `python3` executable |
| `virtualEnv` | — | Path to virtual environment directory |
| `timeoutMs` | 30000 | Request timeout in milliseconds |
| `inheritProcessEnv` | `false` | Set `true` to pass full `process.env` to subprocess |

## Environment Variables

The same `TYWRAP_*` env vars work under Bun. See the [environment variables reference](/reference/env-vars).

## Running Bun-Specific Tests

```bash
bun run vitest --run test/runtime_bun.test.ts
```

Or via npm script:

```bash
npm run test:bun
```

## Virtual Environments

```typescript
setRuntimeBridge(new NodeBridge({
  pythonPath: '.venv/bin/python',
  virtualEnv: '.venv',
}));
```

## Troubleshooting

**`python3: command not found`** — Set `pythonPath` explicitly or ensure Python is in `PATH`.

**Subprocess times out** — Increase `timeoutMs` or check that `pip install tywrap-ir` was run in the correct environment.

See the [Node.js troubleshooting guide](./node#troubleshooting) for additional patterns — they apply equally to Bun.
```

**Step 2: Commit**
```bash
git add docs/guide/runtimes/bun.md
git commit -m "docs: add Bun runtime guide"
```

---

### Task 10: New Deno runtime guide

**Files:**
- Create: `docs/guide/runtimes/deno.md`

**Step 1: Create the file**

```markdown
# Deno Runtime Guide

tywrap works with [Deno](https://deno.land/) 1.46+ using the same `NodeBridge` as Node.js. Deno requires the `npm:` prefix for npm imports.

## ⚠️ Deno Deploy Limitation

**Deno Deploy does NOT support subprocess execution.** Because tywrap's `NodeBridge` spawns a Python subprocess, it cannot run in Deno Deploy.

**Alternatives for Deno Deploy:**
- Use [`PyodideBridge`](./browser) — runs Python in-browser via WebAssembly (no subprocess)
- Use [`HttpBridge`](./http) — connects to a remote Python server over HTTP

## Installation

```bash
deno add npm:tywrap
pip install tywrap-ir
```

Or import directly:
```typescript
import { NodeBridge } from 'npm:tywrap';
```

## Required Permissions

Deno requires explicit permission flags for subprocess execution:

```bash
deno run \
  --allow-run=python3 \
  --allow-read \
  --allow-env \
  your-script.ts
```

| Flag | Reason |
|------|--------|
| `--allow-run=python3` | Spawn the Python subprocess |
| `--allow-read` | Read Python scripts and config files |
| `--allow-env` | Read `TYWRAP_*` and `PATH` environment variables |

## Basic Setup

```typescript
import { NodeBridge } from 'npm:tywrap';
import { setRuntimeBridge } from 'npm:tywrap/runtime';

setRuntimeBridge(new NodeBridge({
  pythonPath: 'python3',
  timeoutMs: 30000,
}));
```

## Type Checking

```bash
deno check src/index.ts
```

## Configuration Options

See the [Node.js guide](./node) for the full `NodeBridgeOptions` reference — all options work identically in Deno.

## Environment Variables

The same `TYWRAP_*` env vars work under Deno. See the [environment variables reference](/reference/env-vars).

## When to Use Each Bridge in Deno

| Scenario | Bridge | Notes |
|----------|--------|-------|
| Local Deno script | `NodeBridge` | Needs `--allow-run` |
| Deno Deploy | `PyodideBridge` | WebAssembly, no subprocess |
| Deno Deploy + heavy libs | `HttpBridge` | Python runs on a separate server |

## Troubleshooting

**`PermissionDenied: Requires run access to "python3"`** — Add `--allow-run=python3` to your `deno run` command.

**`NotSupported: Subprocess access is not allowed`** — You are running in Deno Deploy. Switch to `PyodideBridge` or `HttpBridge`.

See the [Node.js troubleshooting guide](./node#troubleshooting) for additional patterns.
```

**Step 2: Commit**
```bash
git add docs/guide/runtimes/deno.md
git commit -m "docs: add Deno runtime guide with Deploy limitation warning"
```

---

### Task 11: New HTTP bridge guide

**Files:**
- Create: `docs/guide/runtimes/http.md`

**Step 1: Create the file**

```markdown
# HTTP Bridge Guide

`HttpBridge` connects to a Python server over HTTP. Use it when Python must run in a separate process or on a separate machine — including Deno Deploy, edge functions, or distributed architectures.

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
    'Authorization': 'Bearer your-token',  // optional
  },
}));
```

## Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `baseURL` | Yes | — | Base URL of the Python bridge server |
| `headers` | No | `{}` | Additional HTTP headers (auth, etc.) |
| `timeoutMs` | No | `30000` | Request timeout in milliseconds |
| `codec` | No | Arrow | Codec options — see [configuration](/guide/configuration) |

## Running the Python Server

Start the Python bridge server using the bundled script:

```bash
pip install tywrap-ir flask  # flask is needed for HTTP server mode
python -m tywrap_ir.server --port 8080
```

Or point tywrap to your own HTTP server that implements the JSONL-over-HTTP protocol.

> **Note:** HTTP transport is stateless — each call is an independent POST request. There is no persistent connection or session state.

## Protocol

Each call sends a POST to `{baseURL}/call` with a JSON body:
```json
{ "module": "math", "function": "sqrt", "args": [16], "kwargs": {} }
```
Response:
```json
{ "result": 4.0 }
```

## Apache Arrow

Arrow binary transport works over HTTP. Enable it by registering a decoder:

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

See [environment variables reference](/reference/env-vars).

## Security

- Always use HTTPS in production
- Set `Authorization` headers for server access control
- Consider rate-limiting the Python server endpoint
```

**Step 2: Commit**
```bash
git add docs/guide/runtimes/http.md
git commit -m "docs: add HTTP bridge guide"
```

---

### Task 12: Runtime comparison page

**Files:**
- Create: `docs/guide/runtimes/comparison.md`

**Step 1: Create the file**

```markdown
# Runtime Comparison

tywrap supports five runtime configurations. Choose based on your environment and requirements.

## Feature Matrix

| Feature | Node.js | Bun | Deno (local) | Browser (Pyodide) | HTTP |
|---------|:-------:|:---:|:------------:|:-----------------:|:----:|
| Python subprocess | ✅ | ✅ | ✅ | ❌ | ❌ |
| Deno Deploy / serverless | ❌ | ❌ | ❌ | ✅ | ✅ |
| Apache Arrow transport | ✅ | ✅ | ✅ | ✅ | ✅ |
| Virtual environment support | ✅ | ✅ | ✅ | ❌ | Server-side |
| Process pooling (experimental) | ✅ | ✅ | ✅ | ❌ | ❌ |
| numpy / pandas support | ✅ | ✅ | ✅ | Limited | ✅ |
| Tested in CI | ✅ | ✅ | Mocked | ✅ | ✅ |

## Import Paths

| Runtime | Import |
|---------|--------|
| Node.js | `import { NodeBridge } from 'tywrap/node'` |
| Bun | `import { NodeBridge } from 'tywrap'` |
| Deno | `import { NodeBridge } from 'npm:tywrap'` |
| Browser | `import { PyodideBridge } from 'tywrap/pyodide'` |
| HTTP | `import { HttpBridge } from 'tywrap/http'` |

## Decision Guide

```
Do you need to run Python in a subprocess?
├── Yes → Does your environment allow subprocess execution?
│   ├── Yes (Node.js or Bun) → Use NodeBridge
│   ├── Yes (Deno local) → Use NodeBridge with --allow-run
│   └── No (Deno Deploy, serverless) → Continue below
└── No (browser, edge, serverless) →
    ├── Can you load ~50MB WASM? → Use PyodideBridge (Pyodide)
    └── No / need heavy Python libs → Use HttpBridge
```

## Bridge Classes

| Bridge | Package export | Guide |
|--------|---------------|-------|
| `NodeBridge` | `tywrap/node` or `tywrap` | [Node.js](./node) · [Bun](./bun) · [Deno](./deno) |
| `PyodideBridge` | `tywrap/pyodide` | [Browser](./browser) |
| `HttpBridge` | `tywrap/http` | [HTTP](./http) |
```

**Step 2: Commit**
```bash
git add docs/guide/runtimes/comparison.md
git commit -m "docs: add runtime comparison page"
```

---

### Task 13: New CLI reference page

**Files:**
- Create: `docs/reference/cli.md`

**Step 1: Create the file**

```markdown
# CLI Reference

The `tywrap` CLI generates TypeScript wrappers from Python source.

## Installation

```bash
npm install tywrap        # local
npm install -g tywrap     # global
```

Or use without installing:
```bash
npx tywrap <command>
```

## Commands

### `tywrap init`

Creates a `tywrap.config.ts` (or `.json`) in the current directory and adds `tywrap:generate` and `tywrap:check` scripts to `package.json` if it exists.

```bash
npx tywrap init
```

### `tywrap generate`

Reads `tywrap.config.ts` (or the path specified by `--config`) and generates TypeScript wrappers for all configured Python modules.

```bash
npx tywrap generate
npx tywrap generate --config path/to/tywrap.config.json
```

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to config file (default: `tywrap.config.ts`) |
| `--check` | Verify generated files match current Python source (useful in CI) |
| `--verbose` | Print detailed output |

### `tywrap generate --check`

Runs generation and compares output to the files already on disk. Exits with code 1 if anything would change. Use in CI to prevent stale generated files from being committed:

```bash
npx tywrap generate --check
```

Add to CI:
```yaml
- name: Check generated wrappers are up to date
  run: npx tywrap generate --check
```

## Config File

```typescript
// tywrap.config.ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    'numpy': { alias: 'np' },
    'pandas': { classes: ['DataFrame'], functions: ['read_csv'] },
    'math': { functions: ['sqrt', 'pi'] },
  },
  output: {
    dir: './src/generated',
    format: 'esm',
    declaration: true,
  },
});
```

See the [Configuration guide](/guide/configuration) for all options.
```

**Step 2: Commit**
```bash
git add docs/reference/cli.md
git commit -m "docs: add CLI reference page"
```

---

### Task 14: New environment variables reference page

**Files:**
- Create: `docs/reference/env-vars.md`

**Step 1: Create the file**

```markdown
# Environment Variables

All `TYWRAP_*` environment variables are read at runtime by the bridge.

## Reference

| Variable | Runtimes | Default | Description |
|----------|----------|---------|-------------|
| `TYWRAP_PYTHON_PATH` | Node, Bun, Deno | auto-detect | Path to the Python executable (e.g. `/usr/bin/python3`) |
| `TYWRAP_VIRTUAL_ENV` | Node, Bun, Deno | — | Path to a virtual environment directory (activates it for the subprocess) |
| `TYWRAP_CODEC_FALLBACK` | Node, HTTP | `arrow` | Set to `json` to disable Apache Arrow and use JSON-only transport |
| `TYWRAP_CODEC_MAX_BYTES` | Node, HTTP | `1048576` (1MB) | Maximum serialized response size in bytes. Requests exceeding this fail with an explicit error instead of silently truncating. |
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

### Cap response size at 10MB
```bash
TYWRAP_CODEC_MAX_BYTES=10485760 node dist/app.js
```

## Precedence

Environment variables are fallbacks — options passed directly to the bridge constructor take precedence:

```typescript
// Constructor option wins over TYWRAP_PYTHON_PATH
new NodeBridge({ pythonPath: '/my/python' })
```

## subprocess env inheritance

By default, `NodeBridge` inherits only `PATH`, `PYTHON*`, and `TYWRAP_*` variables from `process.env` to keep the subprocess environment minimal and reproducible. To pass the full environment:

```typescript
new NodeBridge({ inheritProcessEnv: true })
```
```

**Step 2: Commit**
```bash
git add docs/reference/env-vars.md
git commit -m "docs: add environment variables reference page"
```

---

### Task 15: Create `llms.txt` and `llms-full.txt`

**Files:**
- Create: `docs/public/llms.txt`
- Create: `docs/public/llms-full.txt`

VitePress serves everything in `docs/public/` at the site root. These files will be live at `https://bbopen.github.io/tywrap/llms.txt`.

**Step 1: Create `docs/public/llms.txt`**

```markdown
# tywrap

> TypeScript wrapper generator for Python libraries. Auto-generates type-safe TypeScript
> bindings from Python source via AST analysis. Supports Node.js, Bun, Deno (subprocess),
> and browsers (Pyodide WebAssembly). Apache Arrow binary transport for numpy/pandas data.
> Experimental (v0.2.1) — APIs may change before v1.0.0.

## Docs

- [Getting Started](https://bbopen.github.io/tywrap/guide/getting-started): Installation, first wrapper, quick start
- [Configuration](https://bbopen.github.io/tywrap/guide/configuration): tywrap.config.ts / .json all options
- [Runtime Comparison](https://bbopen.github.io/tywrap/guide/runtimes/comparison): Which bridge to use (Node/Bun/Deno/Pyodide/HTTP)
- [Node.js Runtime](https://bbopen.github.io/tywrap/guide/runtimes/node): NodeBridge setup, virtual envs, pooling, Docker
- [Bun Runtime](https://bbopen.github.io/tywrap/guide/runtimes/bun): NodeBridge on Bun, bunfig.toml
- [Deno Runtime](https://bbopen.github.io/tywrap/guide/runtimes/deno): npm: prefix, --allow-run, Deploy limitation
- [Browser Runtime (Pyodide)](https://bbopen.github.io/tywrap/guide/runtimes/browser): WebAssembly Python, CDN setup
- [HTTP Bridge](https://bbopen.github.io/tywrap/guide/runtimes/http): Remote Python server, Deno Deploy
- [CLI Reference](https://bbopen.github.io/tywrap/reference/cli): tywrap init, generate, generate --check
- [Environment Variables](https://bbopen.github.io/tywrap/reference/env-vars): All TYWRAP_* variables
- [Type Mapping](https://bbopen.github.io/tywrap/reference/type-mapping): Python→TypeScript type conversions
- [Examples](https://bbopen.github.io/tywrap/examples/): Copy-pasteable runtime examples

## Optional

- [Troubleshooting](https://bbopen.github.io/tywrap/troubleshooting/): Common errors and fixes
- [Changelog](https://github.com/bbopen/tywrap/blob/main/CHANGELOG.md): Version history and breaking changes
- [Contributing](https://github.com/bbopen/tywrap/blob/main/CONTRIBUTING.md): Development setup, PR guidelines
- [AGENTS.md](https://github.com/bbopen/tywrap/blob/main/AGENTS.md): AI coding agent instructions
```

**Step 2: Create `docs/public/llms-full.txt`**

This is a concatenation of all doc pages into a single file for agent frameworks that want full context in one fetch. Create a build script or assemble it manually from all the guide/reference/examples markdown files. For now, create a placeholder that documents the intent:

```markdown
# tywrap — Full Documentation

> This file contains the complete tywrap documentation concatenated for use by
> AI agent frameworks. See llms.txt for the structured index.

[Paste full content of each doc page here, separated by --- dividers]
```

Note: Once the VitePress site is built, automate this by adding a `docs:build:llms` script that concatenates `docs/guide/**/*.md` + `docs/reference/**/*.md` into `docs/public/llms-full.txt` as part of `docs:build`.

**Step 3: Commit**
```bash
git add docs/public/
git commit -m "docs: add llms.txt and llms-full.txt for AI agent discoverability"
```

---

### Task 16: GitHub Pages deploy workflow

**Files:**
- Create: `.github/workflows/docs.yml`

**Step 1: Enable GitHub Pages** (manual UI step if not done yet):
Settings > Pages > Source: "GitHub Actions"

**Step 2: Create the workflow**

```yaml
name: Deploy Docs to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

# Sets permissions of the GITHUB_TOKEN to allow deployment to GitHub Pages
permissions:
  contents: read
  pages: write
  id-token: write

# Allow only one concurrent deployment, skipping runs queued between the run in-progress and latest queued.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # VitePress uses git history for "last updated" timestamps

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - uses: actions/configure-pages@v4

      - name: Install dependencies
        run: npm ci --prefer-offline --no-audit

      - name: Build VitePress site
        run: npm run docs:build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

**Step 3: Push and verify**
```bash
git add .github/workflows/docs.yml
git commit -m "ci: add github pages docs deploy workflow"
git push
```
Then check GitHub Actions tab — the `Deploy Docs to GitHub Pages` job should run and deploy the site. After it completes, visit `https://bbopen.github.io/tywrap/`.

---

## Phase 3: Automation

### Task 17: Add Codecov to CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Add the Codecov upload step**

In `.github/workflows/ci.yml`, find the `test` job. After the `Run tests` step, add:

```yaml
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v5
        if: matrix.node-version == 22 && matrix.python-version == '3.11'
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./coverage/lcov.info
          fail_ci_if_error: false
```

The `if` condition uploads only once (from the Node 22 / Python 3.11 matrix combination) to avoid duplicate uploads.

**Step 2: Ensure test:coverage generates lcov**

The `test:coverage` script uses `@vitest/coverage-v8` (already in devDependencies). Verify `vitest.config.ts` outputs lcov:

```bash
cat vitest.config.ts
```

If `coverage.reporter` does not include `'lcov'`, add it:
```typescript
coverage: {
  reporter: ['text', 'lcov'],
  // ...
}
```

**Step 3: Change test job to also collect coverage**

In the `test` job's `Run tests` step, change:
```yaml
run: npm test
```
to:
```yaml
run: npm run test:coverage
```
(Only needed if you want coverage reported on every CI run. Otherwise keep `npm test` and add a separate coverage job.)

**Step 4: Add coverage badge to README**

In `README.md`, add to the badge row:
```markdown
[![Coverage](https://codecov.io/gh/bbopen/tywrap/branch/main/graph/badge.svg)](https://codecov.io/gh/bbopen/tywrap)
```

**Step 5: Commit**
```bash
git add .github/workflows/ci.yml README.md vitest.config.ts
git commit -m "ci: add codecov coverage upload"
```

---

### Task 18: PR auto-labeling

**Files:**
- Create: `.github/labeler.yml`
- Create: `.github/workflows/labeler.yml`

**Step 1: Create `.github/labeler.yml`**

```yaml
area:runtime:
  - changed-files:
      - any-glob-to-any-file:
          - 'src/runtime/**'
          - 'test/runtime*'
          - 'runtime/**'

area:codegen:
  - changed-files:
      - any-glob-to-any-file:
          - 'src/codegen/**'
          - 'src/cli.ts'
          - 'tywrap_ir/**'
          - 'test/python/**'
          - 'test/cli*'

area:types:
  - changed-files:
      - any-glob-to-any-file:
          - 'src/types/**'
          - 'test-d/**'
          - 'tsd.json'

area:docs:
  - changed-files:
      - any-glob-to-any-file:
          - 'docs/**'
          - '*.md'
          - 'CONTRIBUTING.md'
          - 'AGENTS.md'
          - 'CLAUDE.md'

area:ci:
  - changed-files:
      - any-glob-to-any-file:
          - '.github/**'
          - 'scripts/**'
```

**Step 2: Create `.github/workflows/labeler.yml`**

```yaml
name: PR Labeler

on:
  pull_request_target:
    types: [opened, synchronize, reopened]

jobs:
  labeler:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/labeler@v6
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
```

**Step 3: Commit**
```bash
git add .github/labeler.yml .github/workflows/labeler.yml
git commit -m "ci: add file-based pr auto-labeling"
```

---

### Task 19: Stale issue management

**Files:**
- Create: `.github/workflows/stale.yml`

**Step 1: Create `.github/workflows/stale.yml`**

```yaml
name: Stale Issues and PRs

on:
  schedule:
    - cron: '30 1 * * *'  # 1:30am UTC daily
  workflow_dispatch:

permissions:
  issues: write
  pull-requests: write

jobs:
  stale:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}

          # Issues
          days-before-issue-stale: 90
          days-before-issue-close: 30
          stale-issue-label: 'stale'
          stale-issue-message: >
            This issue has been inactive for 90 days. It will be closed in 30 days
            unless there is new activity. If this is still relevant, please comment
            or add a reaction to keep it open.
          close-issue-message: >
            Closed due to inactivity. If this issue is still relevant, please open
            a new one with updated context.
          exempt-issue-labels: 'good first issue,help wanted,pinned,security'

          # PRs
          days-before-pr-stale: 60
          days-before-pr-close: 14
          stale-pr-label: 'stale'
          stale-pr-message: >
            This PR has been inactive for 60 days. It will be closed in 14 days
            unless there is new activity. If you intend to continue this work,
            please rebase and push a new commit.
          close-pr-message: >
            Closed due to inactivity. Feel free to reopen if you resume work on this.
          exempt-pr-labels: 'pinned,security'
```

**Step 2: Commit**
```bash
git add .github/workflows/stale.yml
git commit -m "ci: add stale issue and pr management workflow"
```

---

### Task 20: Renovate config

**Files:**
- Create: `renovate.json`

**Step 1: Create `renovate.json`** at repo root:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "packageRules": [
    {
      "matchUpdateTypes": ["patch", "minor"],
      "matchDepTypes": ["devDependencies"],
      "automerge": true,
      "automergeType": "pr",
      "platformAutomerge": true
    },
    {
      "matchPackagePatterns": ["^@types/"],
      "groupName": "TypeScript type definitions",
      "automerge": true,
      "automergeType": "pr"
    },
    {
      "matchDepTypes": ["dependencies"],
      "automerge": false
    }
  ],
  "schedule": ["before 6am on Monday"],
  "prConcurrentLimit": 5,
  "prHourlyLimit": 2
}
```

**Step 2: Install Renovate GitHub App**

Visit `https://github.com/apps/renovate` and install it for the `bbopen/tywrap` repository. Renovate will open a "Configure Renovate" PR within 24 hours.

**Step 3: Commit**
```bash
git add renovate.json
git commit -m "chore: add renovate config for automated dependency updates"
```

---

### Task 21: release-please workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release Please

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          release-type: node
          token: ${{ secrets.GITHUB_TOKEN }}

  publish-npm:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created }}
    runs-on: ubuntu-latest
    environment: npm
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.release-please.outputs.tag_name }}

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci --prefer-offline --no-audit
      - run: npm run build
      - run: npm run test
        env:
          NODE_OPTIONS: --expose-gc
          TYWRAP_PERF_BUDGETS: '1'

      - name: Publish to npm
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

> **Note:** This workflow replaces the tag-based trigger in the existing `publish.yml`. Once `release.yml` is working, disable or delete the old `publish.yml` to avoid double-publishing. Keep `publish-pypi.yml` as-is and trigger it manually after a release, or wire it to listen for the same release tag.

**Step 2: Commit**
```bash
git add .github/workflows/release.yml
git commit -m "ci: add release-please workflow for automated changelog and npm publish"
```

---

## Final Verification

After all tasks are complete:

```bash
# 1. Docs build locally
npm run docs:dev
# open http://localhost:5173/tywrap/ — verify all pages load, no 404s

# 2. Package metadata
npm pack --dry-run 2>&1 | grep '"description"'
# expected: no EXPERIMENTAL text

# 3. AGENTS.md present
cat AGENTS.md | head -5
# expected: # AGENTS.md header

# 4. After pushing to main:
# - GitHub Actions "Deploy Docs to GitHub Pages" job passes
# - curl https://bbopen.github.io/tywrap/llms.txt  → returns markdown
# - curl https://bbopen.github.io/tywrap/guide/runtimes/bun  → 200 OK

# 5. CI coverage (after CODECOV_TOKEN secret is set):
# codecov.io/gh/bbopen/tywrap shows a coverage report

# 6. Labeler test: open a PR touching src/runtime/ → area:runtime label appears

# 7. Renovate: within 24h of installing the GitHub App, a "Configure Renovate" PR opens
```
