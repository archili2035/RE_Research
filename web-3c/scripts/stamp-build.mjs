import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const infoPath = 'build-info.json';
const label = /(<code data-build-id>)[^<]*(<\/code>)/;
const pages = new Map();

const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join('/'))
  .filter((file) => file !== infoPath)
  .sort();

const manifest = [];
for (const file of files) {
  let content = await readFile(join(dist, file));
  if (file.endsWith('.html')) {
    const html = content.toString('utf8');
    if (label.test(html)) {
      pages.set(file, html);
      // Hash the page with an empty label so stamping it again is idempotent.
      content = Buffer.from(html.replace(label, '$1$2'));
    }
  }
  manifest.push([file, createHash('sha256').update(content).digest('hex')]);
}

for (const entry of ['index.html', 'm2.html', 'm7.html']) {
  if (!pages.has(entry)) throw new Error(`Missing build ID label in ${entry}`);
}

const sha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
const buildId = sha256.slice(0, 12);
for (const [file, html] of pages) {
  await writeFile(join(dist, file), html.replace(label, (_match, start, end) => start + buildId + end));
}
await writeFile(join(dist, infoPath), JSON.stringify({ buildId, sha256 }, null, 2) + '\n');
console.log(`Web 3C build ID: ${buildId}`);

if (process.argv.includes('--portal')) {
  const portal = fileURLToPath(new URL('../../docs/web-3c/', import.meta.url));
  const assets = join(portal, 'assets');
  // Publish chunks before the HTML that references them. Remove only superseded Vite chunks.
  const htmlFiles = files.filter((file) => file.endsWith('.html'));
  for (const file of [...files.filter((file) => !file.endsWith('.html')), ...htmlFiles, infoPath]) {
    const destination = join(portal, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(dist, file), destination);
  }
  const live = new Set(files);
  for (const entry of await readdir(assets, { withFileTypes: true })) {
    if (entry.isFile() && /-[a-zA-Z0-9_-]{8}\.(js|css)$/.test(entry.name) && !live.has(`assets/${entry.name}`)) {
      await unlink(join(assets, entry.name));
    }
  }
  console.log(`Synced docs/web-3c to ${buildId}`);
}
