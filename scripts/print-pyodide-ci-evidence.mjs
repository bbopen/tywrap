import packageJson from '../package.json' with { type: 'json' };
import browsers from 'playwright-core/browsers.json' with { type: 'json' };

const pyodideVersion = packageJson.devDependencies.pyodide;
const playwrightVersion = packageJson.devDependencies['@playwright/test'];
const chromium = browsers.browsers.find(browser => browser.name === 'chromium');
const nodeMajor = Number(process.versions.node.split('.')[0]);

if (pyodideVersion !== '0.28.1' || playwrightVersion !== '1.58.2') {
  throw new Error('Pyodide and Playwright must use the reviewed exact versions');
}
if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
  throw new Error(`Pyodide browser evidence requires Node 20 or later, found ${process.version}`);
}
if (!chromium?.revision) {
  throw new Error('Playwright did not declare a Chromium revision');
}

console.log(`Node ${process.version}`);
console.log(`Pyodide package and CDN version ${pyodideVersion}`);
console.log(`Playwright ${playwrightVersion}, Chromium revision ${chromium.revision}`);
