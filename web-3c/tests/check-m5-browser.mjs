import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const project = fileURLToPath(new URL('../', import.meta.url));
const out = new URL('../../runtime/web-3c-m5.tmp/', import.meta.url);

async function check(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const glbs = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().endsWith('/assets/m2-rehearsal.glb')) glbs.push(response.status());
  });
  await page.goto(url);
  await page.locator('#enter:enabled').waitFor();
  await page.evaluate(() => {
    const stream = document.querySelector('#events');
    const lines = new Set();
    new MutationObserver(() => stream.textContent.split('\n').forEach((line) => lines.add(line)))
      .observe(stream, { childList: true });
    window.m5Events = lines;
  });
  const waitForState = (phase, ammo) => page.waitForFunction(({ phase, ammo }) =>
    document.querySelector('#snapshot').value.includes(`动作 ${phase}  弹量 ${ammo}`), { phase, ammo });
  const tapFire = async () => {
    await page.mouse.down({ button: 'left' });
    await page.mouse.up({ button: 'left' });
  };

  await page.locator('#enter').click();
  await page.waitForFunction(() => document.pointerLockElement?.id === 'viewport');
  await page.keyboard.down('KeyW');
  await page.mouse.down({ button: 'right' });
  await waitForState('raising', '8 / 16');
  await tapFire();
  await waitForState('firing', '7 / 16');
  await page.keyboard.up('KeyW');
  await waitForState('aiming', '7 / 16');

  await page.keyboard.press('KeyR');
  await waitForState('reloading', '7 / 16');
  await tapFire();
  await waitForState('reloading', '8 / 15');
  await waitForState('aiming', '8 / 15');
  await page.mouse.up({ button: 'right' });
  await waitForState('ready', '8 / 15');
  await page.locator('#viewport').screenshot({ path: fileURLToPath(new URL('practice.png', out)) });
  await page.evaluate(() => document.exitPointerLock());

  const lines = await page.evaluate(() => [...window.m5Events]);
  assert.deepEqual(lines.map((line) => line.replace(/^\d+\.\d+\s+/, '')), [
    'input.request raise', 'action.accepted raise', 'input.request fire',
    'action.recovered raise', 'action.accepted fire', 'weapon.fired', 'ammo.committed 7/16', 'action.recovered fire',
    'input.request reload', 'action.accepted reload', 'input.request fire', 'ammo.committed 8/15',
    'action.recovered reload', 'input.request lower', 'action.accepted lower', 'action.recovered lower',
  ]);
  assert.deepEqual(glbs, [200]);
  assert.deepEqual(errors, []);
  await page.close();
  return { chromium: browser.version(), glbs, events: lines };
}

await mkdir(out, { recursive: true });
const server = await preview({ root: project, preview: { host: '127.0.0.1', port: 0 } });
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const result = await check(browser, `http://127.0.0.1:${server.httpServer.address().port}/`);
    await writeFile(new URL('browser-check.json', out), JSON.stringify(result, null, 2) + '\n');
    console.log(`Chromium ${result.chromium}: ${result.events.length} ordered events and one GLB response`);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
