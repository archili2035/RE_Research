import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Connect, Plugin } from 'vite';

const files = new Set([
  '/player_index.html',
  '/assets/theme/tokens.css',
  '/assets/theme/base.css',
  '/player/style.css',
  '/player/motions.js',
  '/player/masks.js',
  '/player/math.js',
  '/player/model.js',
  '/player/skinning.js',
  '/player/model-view.js',
  '/player/app.js',
  '/player/vendor/three.min.js',
]);
const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const serveReference: Connect.NextHandleFunction = async (request, response) => {
  const pathname = request.url?.split('?')[0] ?? '';
  if (!files.has(pathname) || !localAddresses.has(request.socket.remoteAddress ?? '')) {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const file = new URL(`../docs${pathname}`, import.meta.url);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    response.writeHead(404).end();
    return;
  }
  const type = pathname.endsWith('.js') ? 'text/javascript'
    : pathname.endsWith('.css') ? 'text/css' : 'text/html';
  response.writeHead(200, {
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Length': size,
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-RE9-Reference': '1',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  await pipeline(createReadStream(file), response).catch(() => response.destroy());
};

export function localReferenceAssets(): Plugin {
  const install = ({ middlewares }: { middlewares: Connect.Server }) =>
    middlewares.use('/__re9-reference', serveReference);
  return {
    name: 're9-local-reference',
    configureServer(server) { install(server); },
    configurePreviewServer(server) { install(server); },
  };
}
