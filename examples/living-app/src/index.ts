import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';

import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';
import { clearArrowDecoder, registerArrowDecoder } from 'tywrap';

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
  if (argv.includes('--arrow')) {
    return 'arrow';
  }
  if (argv.includes('--json')) {
    return 'json';
  }
  const env = process.env.TYWRAP_LIVING_APP_CODEC?.toLowerCase();
  if (env === 'arrow') {
    return 'arrow';
  }
  return 'json';
}

async function enableArrowDecoder(): Promise<void> {
  const require = createRequire(import.meta.url);
  const arrow = require('apache-arrow') as unknown as {
    tableFromIPC?: (bytes: Uint8Array) => { toArray?: () => unknown[] };
  };
  if (typeof arrow.tableFromIPC !== 'function') {
    throw new Error('apache-arrow does not export tableFromIPC');
  }
  registerArrowDecoder((bytes: Uint8Array) => arrow.tableFromIPC!(bytes));
}

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
    timeoutMs: 30_000,
  });
  setRuntimeBridge(bridge);

  if (codec === 'arrow') {
    await enableArrowDecoder();
    const info = await bridge.getBridgeInfo();
    if (!info.arrowAvailable) {
      throw new Error(
        'Arrow mode requested but pyarrow is not installed in the Python environment. Install pyarrow or run with --json.'
      );
    }
  }

  const tmp = mkdtempSync(join(tmpdir(), 'tywrap-living-app-'));
  const baselinePath = join(tmp, 'baseline.csv');
  const currentPath = join(tmp, 'current.csv');

  const baseline = await writeSyntheticEventsCsv(baselinePath, 750, 1, 0.0);
  const current = await writeSyntheticEventsCsv(currentPath, 750, 1, 0.25);

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

  try {
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
    await bridge.dispose();
    clearArrowDecoder();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console -- example output
  console.error(err);
  process.exitCode = 1;
});
