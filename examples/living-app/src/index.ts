import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import { autoRegisterArrowDecoder, clearArrowDecoder } from 'tywrap';

import {
  driftReport,
  profileCsv,
  topUsersBySpend,
  writeSyntheticEventsCsv,
  type DriftConfig,
  type ProfileConfig,
} from '../generated/living_app.app.generated.js';

function resolveExampleRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

type CodecMode = 'json' | 'arrow';

function resolveCodecMode(argv: readonly string[]): CodecMode {
  // Why: the living app exists to validate tywrap's Arrow transport path in a real-ish workflow.
  // JSON mode is still supported, but only when explicitly requested.
  const wantsArrow = argv.includes('--arrow');
  const wantsJson = argv.includes('--json');
  if (wantsArrow && wantsJson) {
    throw new Error('Pass only one of --arrow or --json.');
  }
  if (wantsArrow) {
    return 'arrow';
  }
  if (wantsJson) {
    return 'json';
  }
  const env = process.env.TYWRAP_LIVING_APP_CODEC?.toLowerCase();
  if (env === 'json') {
    return 'json';
  }
  if (env === 'arrow') {
    return 'arrow';
  }
  return 'arrow';
}

/**
 * Register an Arrow decoder for this Node process.
 *
 * Why: `apache-arrow` is an optional dependency and tywrap should run without it in JSON mode.
 */
async function enableArrowDecoder(): Promise<void> {
  const registered = await autoRegisterArrowDecoder();
  if (!registered) {
    throw new Error(
      "Arrow mode requires the optional dependency 'apache-arrow'. Install it with `npm install apache-arrow`."
    );
  }
}

/**
 * Coerce Arrow-decoded values into something safe to JSON.stringify for demo output.
 *
 * Why: in Arrow mode `topUsersBySpend` returns an Arrow Table object (with methods/BigInts).
 * This function keeps console output readable and avoids accidentally dumping megabytes.
 */
function toJsonSafe(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __tywrap__: 'bytes', byteLength: value.byteLength };
  }
  if (value && typeof value === 'object') {
    const maybe = value as { numRows?: unknown; numCols?: unknown; toArray?: () => unknown[] };
    if (typeof maybe.toArray === 'function') {
      const numRows = typeof maybe.numRows === 'number' ? maybe.numRows : undefined;
      const numCols = typeof maybe.numCols === 'number' ? maybe.numCols : undefined;
      const rows = maybe.toArray();
      return {
        __tywrap__: 'arrow-table',
        numRows,
        numCols,
        rows: rows.slice(0, 20),
      };
    }
  }
  return value;
}

/**
 * JSON.stringify replacer for Arrow-mode output.
 *
 * Why: Arrow decoding can surface `BigInt` values (e.g. int64 columns), and JSON doesn't support
 * BigInt. We downcast safely when possible, otherwise stringify.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    if (Number.isSafeInteger(asNumber)) {
      return asNumber;
    }
    return value.toString();
  }
  return value;
}

async function main(): Promise<void> {
  const exampleRoot = resolveExampleRoot();
  const codec = resolveCodecMode(process.argv.slice(2));

  const venvPath = join(exampleRoot, '.venv');
  const bridge = new NodeBridge({
    cwd: exampleRoot,
    virtualEnv: existsSync(venvPath) ? '.venv' : undefined,
    enableJsonFallback: codec === 'json',
    // Why: keep the example deterministic even if the developer has TYWRAP_CODEC_FALLBACK set in
    // their shell. Arrow mode should exercise Arrow transport; JSON mode should never require a
    // decoder.
    env: {
      TYWRAP_CODEC_FALLBACK: codec === 'json' ? 'json' : undefined,
    },
    timeoutMs: 30_000,
  });
  setRuntimeBridge(bridge);

  if (codec === 'arrow') {
    // Enable Arrow decoder - will fail at decode time if pyarrow is not installed
    await enableArrowDecoder();
  }

  const profileConfig: ProfileConfig = {
    topK: 5,
    sampleRows: 1000,
    quantiles: [0, 0.5, 0.9, 0.99, 1],
    maxUniqueCategorical: 25,
    topCorrelations: 8,
  };

  const driftConfig: DriftConfig = {
    numericMeanThreshold: 0.15,
    categoricalL1Threshold: 0.25,
    topK: 5,
  };

  let tmp: string | undefined;
  try {
    tmp = mkdtempSync(join(tmpdir(), 'tywrap-living-app-'));
    const baselinePath = join(tmp, 'baseline.csv');
    const currentPath = join(tmp, 'current.csv');

    const baseline = await writeSyntheticEventsCsv(baselinePath, 750, 1, 0.0);
    const current = await writeSyntheticEventsCsv(currentPath, 750, 1, 0.25);

    const baselineProfile = await profileCsv(baseline, profileConfig);
    const currentProfile = await profileCsv(current, profileConfig);
    const drift = await driftReport(baseline, current, driftConfig);
    const topUsers = await topUsersBySpend(current, 5);

    // eslint-disable-next-line no-console -- example output
    console.log(
      JSON.stringify(
        {
          codec,
          baselineProfile,
          currentProfile,
          drift,
          topUsers: codec === 'arrow' ? toJsonSafe(topUsers) : topUsers,
        },
        jsonReplacer,
        2
      )
    );
  } finally {
    // Why: mkdtempSync creates real filesystem state; cleanup keeps local runs and CI tidy.
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    await bridge.dispose();
    // Why: registerArrowDecoder is global process state; clear it so other examples/tests don't
    // inherit Arrow decoding unexpectedly.
    clearArrowDecoder();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console -- example output
  console.error(err);
  process.exitCode = 1;
});
