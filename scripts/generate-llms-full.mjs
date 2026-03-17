import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const orderedDocs = [
  'docs/index.md',
  'docs/guide/getting-started.md',
  'docs/guide/configuration.md',
  'docs/guide/runtimes/comparison.md',
  'docs/guide/runtimes/node.md',
  'docs/guide/runtimes/bun.md',
  'docs/guide/runtimes/deno.md',
  'docs/guide/runtimes/browser.md',
  'docs/guide/runtimes/http.md',
  'docs/reference/cli.md',
  'docs/reference/env-vars.md',
  'docs/reference/type-mapping.md',
  'docs/reference/api/index.md',
  'docs/examples/index.md',
  'docs/troubleshooting/index.md',
];

const excludedDocs = new Set(['docs/codec-roadmap.md', 'docs/release.md']);

async function collectDocs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const normalized = fullPath.replaceAll('\\', '/');

    if (entry.isDirectory()) {
      if (
        normalized === 'docs/.vitepress' ||
        normalized === 'docs/plans' ||
        normalized === 'docs/public'
      ) {
        continue;
      }
      files.push(...(await collectDocs(fullPath)));
      continue;
    }

    if (!normalized.endsWith('.md') || excludedDocs.has(normalized)) {
      continue;
    }

    files.push(normalized);
  }

  return files;
}

async function main() {
  const discoveredDocs = (await collectDocs('docs')).sort();
  const orderedSet = new Set(orderedDocs);

  const missingFromOrder = discoveredDocs.filter(file => !orderedSet.has(file));
  const extraInOrder = orderedDocs.filter(file => !discoveredDocs.includes(file));

  if (missingFromOrder.length > 0 || extraInOrder.length > 0) {
    const problems = [
      missingFromOrder.length > 0 ? `Missing from order: ${missingFromOrder.join(', ')}` : null,
      extraInOrder.length > 0 ? `Not found on disk: ${extraInOrder.join(', ')}` : null,
    ].filter(Boolean);
    throw new Error(`llms-full source order is out of sync. ${problems.join(' | ')}`);
  }

  const header = [
    '# tywrap — Full Documentation',
    '> Complete tywrap documentation for AI agent frameworks.',
    '> See /llms.txt for the structured index.',
    '',
    '---',
    '',
  ].join('\n');

  const sections = [];
  for (const file of orderedDocs) {
    const text = await readFile(file, 'utf8');
    sections.push(`<!-- Source: ${file} -->\n${text.trimEnd()}\n`);
  }

  const output = `${header}${sections.join('\n---\n\n').trimEnd()}\n`;
  await writeFile('docs/public/llms-full.txt', output, 'utf8');
}

await main();
