import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import packageJson from '../package.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const browsersPath = join(dirname(require.resolve('playwright-core')), 'browsers.json');
const browsers = JSON.parse(await readFile(browsersPath, 'utf8'));

const pyodideVersion = packageJson.devDependencies.pyodide;
const playwrightVersion = packageJson.devDependencies['@playwright/test'];
const installedPyodide = JSON.parse(
  await readFile(join(process.cwd(), 'node_modules', 'pyodide', 'package.json'), 'utf8')
).version;
const installedPlaywright = JSON.parse(
  await readFile(join(process.cwd(), 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')
).version;
const installedPlaywrightCore = JSON.parse(
  await readFile(join(process.cwd(), 'node_modules', 'playwright-core', 'package.json'), 'utf8')
).version;
const chromium = browsers.browsers.find(browser => browser.name === 'chromium');
const nodeMajor = Number(process.versions.node.split('.')[0]);

if (pyodideVersion !== '0.28.1' || playwrightVersion !== '1.58.2') {
  throw new Error('Pyodide and Playwright must use the reviewed exact versions');
}
if (
  installedPyodide !== pyodideVersion ||
  installedPlaywright !== playwrightVersion ||
  installedPlaywrightCore !== playwrightVersion
) {
  throw new Error('Installed Pyodide and Playwright versions differ from the reviewed pins');
}
if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
  throw new Error(`Pyodide browser evidence requires Node 20 or later, found ${process.version}`);
}
if (!chromium?.revision) {
  throw new Error('Playwright did not declare a Chromium revision');
}

console.log(`Node ${process.version}`);
console.log(`Installed Pyodide ${installedPyodide}; CDN version ${pyodideVersion}`);
console.log(`Installed Playwright ${installedPlaywright}, Chromium revision ${chromium.revision}`);
