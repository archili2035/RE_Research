import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium, project } from './m8-browser-route.mjs';

const server = await preview({ root: fileURLToPath(project), preview: { host: '127.0.0.1', port: 0 } });
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port);
    await page.waitForFunction(() => !document.querySelector('#enter').disabled &&
      document.querySelector('#player-appearance').value === 'leon');
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await page.getByRole('heading', { name: '安魂曲里昂参考' }).count(), 0);
    const dimensions = () => page.locator('#viewport').evaluate((element) => {
      const viewport = element.getBoundingClientRect();
      const canvas = element.querySelector('canvas');
      const crosshair = element.querySelector('.crosshair').getBoundingClientRect();
      return {
        frame: [viewport.width, viewport.height],
        buffer: [canvas.width, canvas.height],
        center: [crosshair.x + crosshair.width / 2 - viewport.x, crosshair.y + crosshair.height / 2 - viewport.y],
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const desktop = await dimensions();
    assert.deepEqual(desktop, { frame: [1280, 720], buffer: [1280, 720], center: [640, 360], overflow: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('#viewport canvas').width < 390);
    const narrow = await dimensions();
    const [width, height] = narrow.frame;
    assert.ok(Math.abs(height - width * 9 / 16) < 1);
    assert.deepEqual(narrow.buffer, [Math.round(width), Math.round(height)]);
    assert.ok(Math.abs(narrow.center[0] - width / 2) < 1 && Math.abs(narrow.center[1] - height / 2) < 1);
    assert.equal(narrow.overflow, false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ desktop, narrow }));
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
