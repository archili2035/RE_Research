import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const variant = process.argv[2];
assert.ok(['before', 'after'].includes(variant), 'Expected before or after');
const evidence = new URL('../../runtime/web-3c-camera-calibration.tmp/', import.meta.url);
await mkdir(evidence, { recursive: true });
const output = (name) => new URL(variant + '-' + name, evidence);

function manualClock() {
  const scheduled = new Map();
  let id = 0;
  let frame = 0;
  window.requestAnimationFrame = (callback) => {
    scheduled.set(++id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => scheduled.delete(id);
  window.calibration = {
    run(frames, input = {}) {
      if (input.walk !== undefined) window.dispatchEvent(new KeyboardEvent(input.walk ? 'keydown' : 'keyup', { code: 'KeyW' }));
      if (input.aim !== undefined) document.dispatchEvent(new MouseEvent(input.aim ? 'mousedown' : 'mouseup', { button: 2 }));
      const snapshots = [];
      for (let i = 0; i < frames; i++) {
        const callbacks = [...scheduled.values()];
        scheduled.clear();
        for (const callback of callbacks) callback(frame * 1000 / 60);
        frame++;
        snapshots.push(document.querySelector('#snapshot').value);
      }
      return snapshots;
    },
  };
}

const project = fileURLToPath(new URL('../', import.meta.url));
const outDir = fileURLToPath(new URL(variant + '-dist/', evidence));
const server = await preview({ root: project, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const errors = [];
    let weapon = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).pathname.endsWith('/wp0100.glb') && response.status() === 200) weapon = true;
    });
    await page.addInitScript(manualClock);
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port);
    await page.waitForFunction(() => !document.querySelector('#enter').disabled &&
      document.querySelector('#player-appearance').value === 'leon', null, { timeout: 60000, polling: 50 });
    assert.ok(weapon, 'The local Leon weapon must be loaded for the muzzle measurement');
    const clip = await page.locator('#viewport').boundingBox();
    assert.deepEqual([clip.width, clip.height], [1280, 720]);
    const canvas = await page.locator('#viewport canvas').evaluate(element => [element.width, element.height]);
    assert.deepEqual(canvas, [1280, 720]);
    const enter = await page.locator('#enter').boundingBox();
    await page.mouse.click(enter.x + enter.width / 2, enter.y + enter.height / 2);
    await page.waitForFunction(() => document.pointerLockElement?.id === 'viewport', null, { polling: 50 });

    const parts = [];
    const run = async (frames, input) => {
      const snapshots = await page.evaluate(({ frames, input }) => window.calibration.run(frames, input), { frames, input });
      parts.push(...snapshots.filter(Boolean));
      return snapshots.at(-1);
    };
    const capture = async (name, snapshot, tick, phase) => {
      assert.match(snapshot, new RegExp('^步号 ' + tick + ' '));
      assert.match(snapshot, /遮挡 否$/);
      if (phase) assert.match(snapshot, new RegExp('着地 是  动作 ' + phase));
      await page.screenshot({ path: fileURLToPath(output(name + '.png')), clip });
      return snapshot;
    };
    await run(1); // Tick zero.
    const move = await capture('move', await run(175, { walk: true }), 175, 'ready');
    const aim = await capture('aim', await run(90, { walk: false, aim: true }), 265, 'aiming');
    const transition = [aim];
    for (const [frames, elapsed] of [[8, 8], [7, 15], [8, 23], [1, 24]]) {
      transition.push(await capture('release-' + elapsed, await run(frames, { aim: false }), 265 + elapsed));
    }
    assert.ok(parts.slice(174).every(snapshot => /遮挡 否$/.test(snapshot)));
    assert.deepEqual(errors, []);
    await writeFile(output('capture.json'), JSON.stringify({
      chromium: browser.version(), canvas, move, aim, transition, snapshots: parts,
    }, null, 2) + '\n');
    console.log(JSON.stringify({ variant, canvas, move, aim, transition }, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
