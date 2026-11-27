import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { checkRoute, chromium, evidenceDirectory, project, readFixedRoute, viewport } from './m8-browser-route.mjs';

const fixed = await readFixedRoute();
const server = await preview({ root: fileURLToPath(project), preview: { host: '127.0.0.1', port: 0 } });
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: false,
    args: ['--window-size=1500,1120', '--window-position=40,40', '--enable-unsafe-swiftshader'],
  });
  try {
    const session = await browser.newBrowserCDPSession();
    const { gpu } = await session.send('SystemInfo.getInfo');
    const out = { chromium: browser.version(), headless: false, gpu, viewport, routeTicks: fixed.tickCount, results: [] };
    const url = 'http://127.0.0.1:' + server.httpServer.address().port + '/';
    const modes = ['original', 'leon', 'leon', 'original'];
    for (const mode of modes) {
      const result = await checkRoute(browser, url, mode, fixed, { intercept: true });
      assert.equal(result.cfg.visibility, 'visible');
      assert.deepEqual(result.cfg.viewport, [viewport.width, viewport.height]);
      assert.ok(Math.abs(result.cfg.dpr - 1) < 1e-4, 'Expected DPR 1');
      assert.equal(result.unfocusedFrames, 0, 'The Chromium window lost focus during ' + mode);
      const first = out.results[0];
      if (first) {
        assert.deepEqual(result.cfg.canvas, first.cfg.canvas);
        assert.equal(result.renderer, first.renderer);
      }
      out.results.push(result);
      console.log(JSON.stringify({
        mode, loadMs: result.loadMs, p50: result.p50, p95: result.p95, max: result.max,
        samples: result.samples, over50: result.over50, over100: result.over100,
        windows: result.cfg, renderer: result.renderer,
      }));
    }
    await writeFile(new URL('performance-headed.json', evidenceDirectory), JSON.stringify(out, null, 2) + '\n');
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}

