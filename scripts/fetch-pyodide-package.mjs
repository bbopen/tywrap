import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const packageName = process.argv[2];
if (packageName !== 'numpy') throw new Error('Only the reviewed numpy asset is allowed');

const directory = join(process.cwd(), 'node_modules', 'pyodide');
const lock = JSON.parse(await readFile(join(directory, 'pyodide-lock.json'), 'utf8'));
const metadata = lock.packages?.[packageName];
if (!metadata?.file_name || !metadata?.sha256) throw new Error(`Missing locked ${packageName} metadata`);

const url = `https://cdn.jsdelivr.net/pyodide/v0.28.1/full/${metadata.file_name}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== metadata.sha256) throw new Error(`Checksum mismatch for ${metadata.file_name}`);
await writeFile(join(directory, metadata.file_name), bytes);
console.log(`Fetched ${metadata.file_name} with locked sha256 ${digest}`);
