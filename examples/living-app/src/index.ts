import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

import { NodeBridge } from 'tywrap/node';
import { setRuntimeBridge } from 'tywrap/runtime';

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

async function main(): Promise<void> {
  const exampleRoot = resolveExampleRoot();

  const venvPath = join(exampleRoot, '.venv');
  const bridge = new NodeBridge({
    cwd: exampleRoot,
    virtualEnv: existsSync(venvPath) ? '.venv' : undefined,
    enableJsonFallback: true,
    timeoutMs: 30_000,
  });
  setRuntimeBridge(bridge);

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
    console.log(JSON.stringify({ baselineProfile, currentProfile, drift, topUsers }, null, 2));
  } finally {
    await bridge.dispose();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console -- example output
  console.error(err);
  process.exitCode = 1;
});
