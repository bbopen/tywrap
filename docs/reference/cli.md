# CLI Reference

The `tywrap` CLI has two commands: `init` and `generate`.

## Installation

```bash
npm install tywrap
```

Or run it with `npx`:

```bash
npx tywrap <command>
```

## `tywrap init`

Creates a starter config file in the current directory.

- The default file is `tywrap.config.ts`.
- If you do not pass `--modules`, the starter config wraps `math`.
- If a `package.json` is present, tywrap adds `tywrap:generate` and
  `tywrap:check` scripts unless you pass `--no-scripts`.

```bash
npx tywrap init
npx tywrap init --format json --modules math,numpy
```

| Flag                                  | Description                                            |
| ------------------------------------- | ------------------------------------------------------ |
| `--config`, `-c`                      | Path for the new config file                           |
| `--format ts\|json`                   | Output format for the starter config                   |
| `--modules`                           | Comma-separated Python modules to seed into the config |
| `--runtime node\|pyodide\|http\|auto` | Runtime to use for seeded module entries               |
| `--output-dir`                        | Generated wrapper directory in the starter config      |
| `--force`                             | Overwrite an existing config file                      |
| `--scripts`, `--no-scripts`           | Add or skip recommended `package.json` scripts         |

## `tywrap generate`

Loads config, resolves Python IR, and writes generated wrapper files.

When `--config` is omitted, the CLI searches in this order:

1. `tywrap.config.ts`
2. `tywrap.config.mts`
3. `tywrap.config.js`
4. `tywrap.config.mjs`
5. `tywrap.config.cjs`
6. `tywrap.config.json`

If no config file is found, you can still generate wrappers by passing
`--modules`.

```bash
npx tywrap generate
npx tywrap generate --config ./tywrap.config.json
npx tywrap generate --modules math,statistics --runtime node
```

| Flag                                  | Description                                                         |
| ------------------------------------- | ------------------------------------------------------------------- |
| `--config`, `-c`                      | Config file path                                                    |
| `--modules`                           | Comma-separated Python modules to wrap                              |
| `--runtime node\|pyodide\|http\|auto` | Runtime to use when `--modules` is provided                         |
| `--python`                            | Python executable path override                                     |
| `--output-dir`                        | Override `output.dir`                                               |
| `--format esm\|cjs\|both`             | Override `output.format`                                            |
| `--declaration`                       | Override `output.declaration`                                       |
| `--source-map`                        | Override `output.sourceMap`                                         |
| `--cache`, `--no-cache`               | Enable or disable on-disk IR caching                                |
| `--debug`                             | Enable debug logging                                                |
| `--verbose`, `-v`                     | Alias for `--debug`                                                 |
| `--fail-on-warn`                      | Exit non-zero when generation emits warnings                        |
| `--check`                             | Compare generated output with what is on disk without writing files |

## `tywrap generate --check`

`--check` is for CI and upgrade verification. It does not write files.

```bash
npx tywrap generate --check
```

Exit codes:

- `0`: generated files are up to date
- `2`: generation succeeded but warnings were present and `--fail-on-warn` was
  set
- `3`: generated files are out of date
- `1`: general failure, such as missing config, import failure, or write error

Typical CI step:

```yaml
- name: Check generated wrappers
  run: npx tywrap generate --check
```

## Starter Config Example

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    math: { runtime: 'node', typeHints: 'strict' },
    numpy: { runtime: 'node', typeHints: 'strict', alias: 'np' },
  },
  output: {
    dir: './generated',
    format: 'esm',
    declaration: false,
    sourceMap: false,
  },
  runtime: {
    node: {
      pythonPath: 'python3',
    },
  },
  types: {
    presets: ['stdlib'],
  },
});
```

See the [Configuration guide](/guide/configuration) for the full config surface.
