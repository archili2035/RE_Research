import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

// Smoke check for the v5/v6 heading, carry-gun gait, starts and stops, spine pitch, shot effects and the source camera
// profile in the production preview. JSON goes to reports/web-3c/evidence/, screenshots stay in runtime/.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const project = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(project, '../runtime/web-3c-leon-v6.tmp');
const evidence = path.resolve(project, '../reports/web-3c/evidence');
await mkdir(out, { recursive: true });
await mkdir(evidence, { recursive: true });
const server = await preview({ root: project, preview: { host: '127.0.0.1', port: 4183, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const record = { errors: [], files: [], snapshots: {} };
async function walkthrough(prefix, query) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => record.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') record.errors.push(message.text()); });
  page.on('response', (response) => { if (response.url().includes('__re9-reference')) record.files.push([new URL(response.url()).pathname, response.status()]); });
  // The Rhodes central hall gives an unobstructed camera for pose screenshots.
  await page.goto('http://127.0.0.1:4183/?level=rhodes&spawn=0,1.8,43.5,0' + query);
  await page.waitForFunction(() => !document.querySelector('#enter').disabled &&
    !document.querySelector('#player-appearance [value=leon]').disabled, null, { timeout: 120000 });
  await page.locator('#enter').click();
  await page.waitForFunction(() => document.pointerLockElement);
  const snap = async (name) => {
    record.snapshots[prefix + name] = await page.locator('#snapshot').evaluate((el) => el.value);
    await page.locator('#viewport').screenshot({ path: path.join(out, prefix + name + '.png') });
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
  await page.waitForTimeout(500); await snap('lowered');
  await page.close();
}
try {
  await walkthrough('', '');
  await walkthrough('source-', '&camera=source');
} finally {
  await writeFile(path.join(evidence, 'v6-browser-check.json'), JSON.stringify(record, null, 2) + '\n');
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
console.log(JSON.stringify({ errors: record.errors, files: record.files.length }, null, 0));