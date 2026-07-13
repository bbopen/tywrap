# Contributing to tywrap

This guide is the maintainer entry point. Read the [release guide](docs/release.md)
before changing package versions, IR versions, or generated release artifacts.

## Setup

Use Node.js 20 or later and Python 3.10 or later. CI covers Python 3.10, 3.11,
and 3.12. The main lint job uses Node 22 and Python 3.11.

```bash
npm ci
pip install -e tywrap_ir/
```

Run the normal gate after a focused change:

```bash
npm run check:all
```

`check:all` runs format checking, linting, the build, type tests, and unit
tests. It does not replace the focused test command for a changed subsystem.

## Test map

| Surface | Command | What it checks |
| --- | --- | --- |
| TypeScript unit and runtime tests | `npm test` | Generator, transports, codec, and bridge behavior. |
| Type-level tests | `npm run test:types` | Generated and exported TypeScript types through `test-d/`. |
| Python producer tests | `python -m pytest test/python/test_bridge_codec.py test/python/test_frame_codec.py` | Python codec and frame behavior. |
| Core Python library suite | `npm run test:python:suite:core` | IR extraction against core libraries. |
| Data Python library suite | `npm run test:python:suite:data` | IR extraction against data libraries. |
| Menagerie | `npm run test:menagerie` | Named generation and runtime codec truth-table rows. |

Set `TYWRAP_PERF_BUDGETS=1` to enable performance budget assertions. Set
`NODE_OPTIONS=--expose-gc` for GC-sensitive memory tests. CI sets both in its
main test jobs.

## Menagerie

`test/menagerie/manifest.ts` is the executable catalogue. Each row is one
Python call under one codec configuration.

| Status | Meaning |
| --- | --- |
| `EXPECTED_OK` | The stated value survives. |
| `KNOWN_LIE` | The call resolves with a documented loss and expected future fix. |
| `LOUD_FAIL` | The call rejects with a checked error. |

A behavior change must flip its menagerie rows in the same PR. Add a row
when a new representation or failure domain becomes observable. Do not relabel
a known loss as supported without an executable expectation.

The `optional-scientific-menagerie` CI job uses pinned Python 3.11 packages:
NumPy 2.3.5, pandas 3.0.2, pyarrow 24.0.0, SciPy 1.16.3,
scikit-learn 1.8.0, and CPU-only torch 2.10.0. Use the same pins locally when
investigating a scientific row:

```bash
python3.11 -m venv .venv-menagerie
.venv-menagerie/bin/python -m pip install -e tywrap_ir
.venv-menagerie/bin/python -m pip install numpy==2.3.5 pandas==3.0.2 pyarrow==24.0.0 scipy==1.16.3 scikit-learn==1.8.0
.venv-menagerie/bin/python -m pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cpu
TYWRAP_CODEC_PYTHON=.venv-menagerie/bin/python npm run test:menagerie
```

See [Menagerie Discipline](docs/maintainers/menagerie.md) for row structure
and status obligations.

## Generated files

Never hand-edit `src/runtime/pyodide-bootstrap-core.generated.ts` or
`docs/public/llms-full.txt`. Regenerate the Pyodide bootstrap with its script
after changing `runtime/tywrap_bridge_core.py`. Regenerate the full LLM bundle
with:

```bash
node scripts/generate-llms-full.mjs
```

Generated wrappers and `<module>.contract.json` files belong to the consuming
project. Use `npx tywrap generate --check` to detect their drift.

## Documentation

VitePress content lives under `docs/`. Build the site with:

```bash
npm run docs:build
```

The build synchronizes `llms-full.txt`; run the generator again as the final
documentation step when its source pages changed. Keep `docs/public/llms.txt`
as the hand-maintained index.

> Before committing prose, lint it against the repository's plain-language
> conventions: no em dashes, no marketing adjectives, no filler
> constructions, concrete numbers over vague claims. The
> [vale-ai-tells](https://github.com/tbhb/vale-ai-tells) Vale package
> automates most of these checks if you use Vale locally.

## Pull requests

Use conventional commits such as `fix(codec): reject invalid envelope` or
`docs: update agent adoption guide`. Include tests for behavior changes and
type tests when the public TypeScript surface changes.

Run `npm run check:all` once before pushing. CI must pass, including the
`required` job. Wait for CodeRabbit and resolve every review thread before
merging.

By contributing, you agree to license your contributions under the project’s
MIT License.
