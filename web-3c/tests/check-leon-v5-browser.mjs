import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

// Smoke check for the v5 heading, carry-gun gait, spine pitch and camera kick in the production preview.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const project = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(project, '../runtime/web-3c-leon-v5.tmp');
await mkdir(out, { recursive: true });
const server = await preview({ root: project, preview: { host: '127.0.0.1', port: 4183, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const record = { errors: [], files: [], snapshots: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => record.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') record.errors.push(message.text()); });
  page.on('response', (response) => { if (response.url().includes('__re9-reference')) record.files.push([new URL(response.url()).pathname, response.status()]); });
  // The Rhodes central hall gives an unobstructed camera for pose screenshots.
  await page.goto('http://127.0.0.1:4183/?level=rhodes&spawn=0,1.8,43.5,0');
  await page.waitForFunction(() => !document.querySelector('#enter').disabled &&
    !document.querySelector('#player-appearance [value=leon]').disabled, null, { timeout: 120000 });
  await page.locator('#enter').click();
  await page.waitForFunction(() => document.pointerLockElement);
  const snap = async (name) => {
    record.snapshots[name] = await page.locator('#snapshot').evaluate((el) => el.value);
    await page.locator('#viewport').screenshot({ path: path.join(out, name + '.png') });
  };
  await page.waitForTimeout(800);
  await snap('idle');
  await page.keyboard.down('KeyD'); await page.waitForTimeout(900); await snap('walk-right'); await page.keyboard.up('KeyD');
  await page.waitForTimeout(300); await snap('stop-right');
  await page.keyboard.down('KeyS'); await page.waitForTimeout(900); await snap('walk-back'); await page.keyboard.up('KeyS');
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(1000); await snap('run');
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(800); await snap('aim-level');
  for (let i = 0; i < 20; i++) { await page.mouse.move(720, 500 - i * 6); await page.waitForTimeout(16); }
  await page.waitForTimeout(300); await snap('aim-up');
  await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(120); await snap('fire-kick');
  await page.mouse.up({ button: 'right' });
} finally {
  await writeFile(path.join(out, 'browser-check.json'), JSON.stringify(record, null, 2) + '\n');
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
console.log(JSON.stringify({ errors: record.errors, files: record.files.length }, null, 0));