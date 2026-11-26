import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { checkDirections } from './leon-browser-directions.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const project = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(project, '../runtime/web-3c-leon.tmp');
const directionOut = path.resolve(project, '../runtime/web-3c-leon-direction.tmp');
const readyOut = path.resolve(project, '../runtime/web-3c-leon-ready.tmp');

async function check(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const files = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => {
    if (response.url().includes('/__re9-reference/player/')) files.push(new URL(response.url()).pathname);
  });
  // Observe only the WebGL context in the playable viewport, excluding the reference iframe.
  await page.addInitScript(() => {
    window.playfieldIndexCount = 0;
    for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Context) continue;
      const draw = Context.prototype.drawElements;
      Context.prototype.drawElements = function (mode, count, ...rest) {
        if (this.canvas.parentElement?.id === 'viewport') {
          window.playfieldIndexCount = Math.max(window.playfieldIndexCount, count);
        }
        return draw.call(this, mode, count, ...rest);
      };
    }
  });
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('#enter').disabled &&
    !document.querySelector('#player-appearance [value=leon]').disabled);
  const appearance = page.locator('#player-appearance');
  const aimReleased = () => document.querySelector('#snapshot').value.includes('瞄准 否');
  const indexCount = () => page.evaluate(() => window.playfieldIndexCount);
  const resetIndexCount = () => page.evaluate(() => { window.playfieldIndexCount = 0; });
  assert.equal(await appearance.inputValue(), 'leon');
  await page.waitForFunction(() => window.playfieldIndexCount > 10000);

  const positionX = () => page.locator('#snapshot').evaluate((element) =>
    Number(element.value.match(/坐标 (-?\d+\.\d+),/)[1]));
  const startX = await positionX();
  await page.locator('#enter').click();
  await page.waitForFunction(() => document.pointerLockElement?.id === 'viewport');
  await page.locator('#viewport').screenshot({ path: path.join(out, 'leon-standing.png') });
  await page.keyboard.down('KeyW');
  await page.waitForFunction((x) => Number(document.querySelector('#snapshot').value.match(/坐标 (-?\d+\.\d+),/)[1]) > x + 3, startX);
  await page.keyboard.up('KeyW');
  await page.waitForFunction(() => window.playfieldIndexCount > 10000);
  const leonIndexCount = await indexCount();
  const walkedX = await positionX();
  const stopTick = await page.locator('#snapshot').evaluate((element) => Number(element.value.match(/步号 (\d+)/)[1]));
  await page.waitForFunction((tick) => Number(document.querySelector('#snapshot').value.match(/步号 (\d+)/)[1]) >= tick + 10, stopTick);
  assert.ok(Math.abs(await positionX() - walkedX) <= 0.01);
  await page.locator('#viewport').screenshot({ path: path.join(out, 'leon-stopped.png') });

  await page.mouse.down({ button: 'right' });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('action.recovered raise'));
  await page.waitForFunction((x) => Number(document.querySelector('#snapshot').value.match(/坐标 (-?\d+\.\d+),/)[1]) > x + 0.5, walkedX);
  await page.locator('#viewport').screenshot({ path: path.join(out, 'leon-aim.png') });
  const fireStartX = await positionX();
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('action.recovered fire'));
  await page.keyboard.up('KeyW');
  const fireEndX = await positionX();
  assert.ok(fireEndX > fireStartX + 0.25);
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('action.recovered reload'));
  const ammo = (await page.locator('#ammo').textContent()).trim();
  assert.equal(ammo, '8 / 15');
  const events = await page.locator('#events').textContent();
  assert.match(events, /weapon\.fired/);
  assert.match(events, /ammo\.committed 7\/16/);
  assert.match(events, /ammo\.committed 8\/15/);
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(aimReleased);
  await page.mouse.up({ button: 'right' });
  const stoppedX = await positionX();

  await appearance.selectOption('graybox');
  await resetIndexCount();
  await page.waitForFunction(() => window.playfieldIndexCount > 0);
  const grayboxIndexCount = await indexCount();
  assert.ok(grayboxIndexCount < 10000);
  assert.equal(await positionX(), stoppedX);
  assert.equal((await page.locator('#ammo').textContent()).trim(), ammo);
  await appearance.selectOption('leon');
  await page.waitForFunction(() => window.playfieldIndexCount > 10000);
  assert.equal(await positionX(), stoppedX);
  assert.equal((await page.locator('#ammo').textContent()).trim(), ammo);
  await page.screenshot({ path: path.join(out, 'leon-playfield.png') });
  for (const file of ['model.js', 'motions.js', 'skinning.js']) {
    assert.equal(files.filter((url) => url.endsWith('/' + file)).length, 1, file);
  }
  assert.deepEqual(errors, []);
  return { startX, walkedX, fireStartX, fireEndX, stoppedX, ammo, leonIndexCount, grayboxIndexCount, events, files, errors };
}

await mkdir(out, { recursive: true });
await mkdir(directionOut, { recursive: true });
await mkdir(readyOut, { recursive: true });
const server = await preview({ root: project, preview: { host: '127.0.0.1', port: 0 } });
try {
  const { port } = server.httpServer.address();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const url = `http://127.0.0.1:${port}/`;
    const result = await check(browser, url);
    await writeFile(path.join(out, 'browser-check.json'), JSON.stringify({
      chromium: browser.version(), ...result,
    }, null, 2) + '\n');
    const directions = await checkDirections(browser, url);
    await writeFile(path.join(directionOut, 'browser-check.json'), JSON.stringify({ chromium: browser.version(), ...directions }, null, 2) + '\n');
    const ready = await checkDirections(browser, url, { aimed: false });
    await writeFile(path.join(readyOut, 'browser-check.json'), JSON.stringify({ chromium: browser.version(), ...ready }, null, 2) + '\n');
    console.log(`Chromium ${browser.version()}: Leon aimed and ready direction gait, moving aim transitions, wall stop, and weapon regression verified`);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
