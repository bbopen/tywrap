#!/usr/bin/env node

/**
 * Resolve latest versions from PyPI for a set of packages and print JSON mapping.
 * Usage: node tools/resolve_pypi.js package1 package2 ...
 */

import https from 'node:https';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if ((res.statusCode ?? 0) >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', d => chunks.push(Buffer.from(d)));
        res.on('end', () => {
          try {
            const txt = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(txt));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function resolveLatest(pkg) {
  try {
    const data = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`);
    return data?.info?.version ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const pkgs = process.argv.slice(2);
  if (pkgs.length === 0) {
    // eslint-disable-next-line no-console
    console.error('Usage: node tools/resolve_pypi.js <package> [package2 ...]');
    process.exit(1);
  }
  const entries = await Promise.all(
    pkgs.map(async p => {
      const v = await resolveLatest(p);
      return [p, v];
    })
  );
  const mapping = Object.fromEntries(entries.filter(e => e[1] !== null));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(mapping, null, 2));
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
