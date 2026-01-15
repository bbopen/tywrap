# Living App (pandas + numpy + pydantic + Arrow)

This is a small but non-trivial “living example” that exercises tywrap end-to-end:

- TypeScript (Node) calls into Python via `NodeBridge`
- Python uses `pandas` + `numpy` for data work and `pydantic` for config validation
- Rich results (e.g. `pandas.DataFrame`) come back via Arrow IPC and are decoded in Node with `apache-arrow`

## What it does

The example generates two synthetic CSV datasets (“baseline” and “current”), profiles them, and produces a simple drift report.

## Setup (fresh checkout)

From the repo root:

1. Install Node dependencies:

```sh
npm ci
```

2. Create a Python venv and install Python dependencies:

```sh
python3 -m venv examples/living-app/.venv
./examples/living-app/.venv/bin/python -m pip install -U pip
./examples/living-app/.venv/bin/python -m pip install -e tywrap_ir
./examples/living-app/.venv/bin/python -m pip install -r examples/living-app/requirements-arrow.txt
```

3. Build tywrap (for the CLI + runtime bridge):

```sh
npm run build
```

4. Generate wrappers, build the example, and run it:

```sh
npm run example:living-app:smoke
```

## Notes

- The living app defaults to Arrow mode to exercise tywrap’s primary transport path for `pandas` / `numpy`.
- JSON mode is still supported, but must be requested explicitly (and it forces `TYWRAP_CODEC_FALLBACK=json` so no Arrow decoder is required):

```sh
./examples/living-app/.venv/bin/python -m pip install -r examples/living-app/requirements.txt
npm run example:living-app:smoke:json
```
