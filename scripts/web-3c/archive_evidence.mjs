// Copies small runtime evidence (json/csv/log/txt/md up to 300 kB) linked from reports/web-3c/*.md into
// reports/web-3c/evidence/ and rewrites the links. Larger local files keep a plain path marked as local only.
// Run from the repository root: node scripts/web-3c/archive_evidence.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('../../', import.meta.url);
const reports = new URL('reports/web-3c/', root);
const LIMIT = 300_000;
let copied = 0;
let localOnly = 0;
for (const name of readdirSync(reports).filter((file) => file.endsWith('.md'))) {
  const file = new URL(name, reports);
  const text = readFileSync(file, 'utf8');
  const next = text.replace(/\[([^\]]*)\]\((\.\.\/\.\.\/runtime\/([^)#/]+\.tmp\/[^)#]+))\)/g, (match, label, link, rest) => {
    const source = new URL('runtime/' + rest, root);
    if (!existsSync(source)) return match;
    const size = statSync(source).size;
    if (size <= LIMIT && /\.(json|csv|log|txt|md)$/.test(rest)) {
      const relative = rest.replace(/^([^/]+)\.tmp\//, '$1/');
      const target = new URL('evidence/' + relative, reports);
      mkdirSync(dirname(target.pathname.replace(/^\/(\w:)/, '$1')), { recursive: true });
      copyFileSync(source, target);
      copied += 1;
      return `[${label}](evidence/${relative})`;
    }
    localOnly += 1;
    return `${label}（本机 \`runtime/${rest}\`，${Math.round(size / 1024)} KB，未入库）`;
  });
  if (next !== text) writeFileSync(file, next);
}
console.log(`copied ${copied} links, ${localOnly} local-only links`);
void join;