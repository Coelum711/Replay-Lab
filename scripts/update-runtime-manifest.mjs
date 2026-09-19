import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url);
const distDir = new URL('../dist/', import.meta.url);
const manifestUrl = new URL('../web/runtime-files.json', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = String(packageJson.version || '0.0.0').match(/^\d+\.\d+/)?.[0] ?? '0.0';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(relative(new URL('../dist/', import.meta.url).pathname, full).split(sep).join('/'));
  }
  return files;
}

const files = (await walk(distDir.pathname)).sort();
await writeFile(manifestUrl, JSON.stringify({ version, files }, null, 2) + '\n');
console.log(`runtime manifest ${version}: ${files.length} JS modules`);
