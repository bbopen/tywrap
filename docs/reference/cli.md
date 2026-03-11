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

Creates a `tywrap.config.ts` (or `.json`) in the current directory and adds `generate` and `check` scripts to `package.json` if one is present.

```bash
npx tywrap init
```

### `tywrap generate`

Reads the config file and generates TypeScript wrappers for all configured Python modules.

```bash
npx tywrap generate
npx tywrap generate --config path/to/tywrap.config.json
```

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to config file (default: `tywrap.config.ts`) |
| `--check` | Verify generated files match current Python source — exits 1 if anything changed (for CI) |
| `--verbose` | Print detailed output |

### `tywrap generate --check`

Runs generation and compares output to files already on disk. Exits with code 1 if anything would change. Use in CI to prevent stale generated files:

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
