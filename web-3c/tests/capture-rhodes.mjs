// Capture the Rhodes Hill greybox from the spawn camera and from scripted camera poses.
// Usage: node tests/capture-rhodes.mjs  (after npm run build)
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium, project } from './m8-browser-route.mjs';

const out = new URL('../../runtime/web-3c-rhodes.tmp/', import.meta.url);
await mkdir(out, { recursive: true });
const server = await preview({ root: fileURLToPath(project), preview: { host: '127.0.0.1', port: 0 } });
try {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--enable-unsafe-swiftshader'] });
  try {
    const shots = [
      ['spawn', ''],
      ['hall-stairs', '&spawn=0,2.3,40.5,0'],          // Central Hall looking north at the twin staircase
      ['hall-south', '&spawn=0,1.8,43.5,180'],         // under the gallery looking south to the target
      ['guard-office', '&spawn=-7.2,1.8,45.7,90'],     // inside the guard office, facing west towards the fireplace
      ['medication', '&spawn=-11.7,1.8,49.4,90'],      // top of the south-west steps down to the medication room
      ['landing', '&spawn=0,4.3,27.8,180'],            // stair landing looking back over the atrium
    ];
    const results = [];
    for (const [name, query] of shots) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/?level=rhodes' + query);
      await page.waitForFunction(() => !document.querySelector('#enter').disabled, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      await page.locator('#viewport').screenshot({ path: fileURLToPath(new URL(name + '.png', out)) });
      results.push({ name, heading: await page.locator('#scene-heading').textContent(), errors });
      await page.close();
    }
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
} finally { await server.close(); }