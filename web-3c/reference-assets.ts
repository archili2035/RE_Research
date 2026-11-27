import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Connect, Plugin } from 'vite';

const files = new Set([
  '/player/motions.js',
  '/player/masks.js',
  '/player/math.js',
  '/player/model.js',
  '/player/skinning.js',
]);
const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const weaponRoute = '/wp0100.glb';

const serveReference: Connect.NextHandleFunction = async (request, response) => {
  const pathname = request.url?.split('?')[0] ?? '';
  const weapon = pathname === weaponRoute;
  if ((!weapon && !files.has(pathname)) || !localAddresses.has(request.socket.remoteAddress ?? '')) {
    response.writeHead(404).end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const file = new URL(weapon ? '../runtime/web-3c-weapon.tmp/wp0100.glb' : `../docs${pathname}`, import.meta.url);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    response.writeHead(weapon ? 204 : 404).end();
    return;
  }
  const type = weapon ? 'model/gltf-binary' : 'text/javascript; charset=utf-8';
  response.writeHead(200, {
    'Content-Type': type,
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
