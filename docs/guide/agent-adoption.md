# Agent Adoption

Use `NodeBridge` for a TypeScript project that can start a local Python
process. Use `PyodideBridge` for browser code. Use `HttpBridge` when Python
runs on another host. See the [runtime comparison](./runtimes/comparison) for
constraints such as Deno Deploy and Arrow support.

## Recipe

Run these commands from the TypeScript project root. Replace `math` with the
Python module the project must call.

```bash
npm install tywrap
```

Expected output includes an added `tywrap` dependency in `package.json`.

```bash
pip install tywrap-ir
```

Expected output ends with a successful `tywrap-ir` installation. This `pip`
must install into the same Python environment configured below.

```bash
npx tywrap init
```

Expected output:

```text
Created /absolute/path/to/project/tywrap.config.ts
```

The command writes this starter configuration and adds `tywrap:generate` and
`tywrap:check` scripts when `package.json` exists:

```ts
import { defineConfig } from 'tywrap';

export default defineConfig({
  pythonModules: {
    math: { typeHints: 'strict' },
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

Edit `pythonModules` and `runtime.node.pythonPath` as needed. A local module
also needs its parent directory in `pythonImportPath`.

```bash
npx tywrap generate
```

Expected output for one module:

```text
Generated: 2 files from 1 modules (warnings: 0).
- generated/math.generated.ts
- generated/math.contract.json
```

The wrapper is `<module>.generated.ts`. The pinned extractor output is
`<module>.contract.json`. Import the compiled wrapper, set the bridge once,
then call the wrapper:

```ts
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import * as math from './generated/math.generated.js';

setRuntimeBridge(new NodeBridge({ pythonPath: 'python3' }));

const value = await math.sqrt(16);
console.log(value); // 4
```

Expected output:

```text
4
```

## Verify generated output

Commit the wrapper and contract files, then check them in CI:

```bash
npx tywrap generate --check
```

Expected output when current:

```text
Generated wrappers are up to date.
```

Exit code `0` means all generated files match. Exit code `1` means generation
failed, including a missing configuration or Python import failure. Exit code
`2` means `--fail-on-warn` found warnings. Exit code `3` means generated files
or contracts differ; run `npx tywrap generate` and commit the result. See the
[CLI reference](/reference/cli) for the complete command surface.

## Failure signatures

| Error prefix or text | Fix |
| --- | --- |
| `No IR produced for module ... tywrap_ir failed.` with `ModuleNotFoundError` | Install the target Python module in the same interpreter named by `runtime.node.pythonPath`. For a local module, add its parent directory to `pythonImportPath`. |
| `No IR produced for module` or `tywrap_ir not found on PYTHONPATH.` | Run `pip install tywrap-ir` in that configured Python environment, then rerun generation. |
| `IR version mismatch:` or `ir-version-mismatch` | Upgrade `tywrap-ir` to match `tywrap`, then regenerate the contract. |
| `contract-invalid` or `Contract ... is missing` | Replace the invalid or stale `contractInput` with a regenerated contract. |
| `Generated wrappers are out of date:` | Run `npx tywrap generate`, review the wrapper and contract changes, and commit them. |
| `Received an Arrow-encoded payload but no Arrow decoder is available.` | Run `npm install apache-arrow`, or set `TYWRAP_CODEC_FALLBACK=json` on the Python side when its documented JSON domain is acceptable. |
| `JSON pandas.DataFrame encoding requires an unnamed RangeIndex` or `JSON pandas.Series encoding requires an unnamed RangeIndex` | Follow the recipe in the error, such as `.reset_index(drop=True)`, or use Arrow. Other JSON codec preflight errors also state their conversion recipe. Apply that recipe rather than suppressing the error. |
| `Return validation failed for` (`BridgeValidationError`) | Compare the Python return value with the generated declared type. The message gives the call site and describes the expected type and received shape. Fix the annotation or returned value, then regenerate. |
| `Response payload is ... exceeds TYWRAP_CODEC_MAX_BYTES=` | Raise `TYWRAP_CODEC_MAX_BYTES` only for a response size the process can handle, or return a smaller result. |
