import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const project = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(project, '../runtime/web-3c-reference.tmp');
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `${actual} differs from ${expected}`);

async function check(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1020 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const response = await page.goto(url);
  assert.ok(response.ok());
  const select = page.locator('#reference-clip');
  await page.waitForFunction(() => !document.querySelector('#reference-clip').disabled);
  const iframe = page.locator('#reference-view');
  const embedded = page.frameLocator('#reference-view');
  const frameStatus = embedded.locator('#time');
  const selected = () => frameStatus.evaluate(() => {
    const { player, ModelView } = window;
    const { bank, id, fps, frames } = player.clip;
    return { bank, id, fps, frames, timeS: player.time, playing: player.playing,
      frame: Math.round(player.time * fps), parts: ModelView.stats.parts, vertices: ModelView.stats.vertices,
      bounds: ModelView.stats.bounds, visible: getComputedStyle(document.querySelector('#modelview')).visibility,
      weaponJoint: player.pose[player.clip.bones.findIndex((bone) => bone.name === 'R_Wep')].p };
  });
  const follow = page.locator('#reference-follow');
  const marker = (key) => page.locator(`#reference-events button[data-event="${key}"]`);
  const left = await page.locator('#viewport').boundingBox();
  const right = await iframe.boundingBox();
  assert.ok(right.x > left.x + left.width);
  assert.equal(right.y, left.y);
  assert.equal(await select.inputValue(), 'hold');
  const clips = [
    { key: 'hold', id: 160, frames: 307 }, { key: 'raise', id: 140, frames: 30 },
    { key: 'fire', id: 1100, frames: 30 }, { key: 'reload', id: 1200, frames: 312 },
  ];
  assert.equal(await select.locator('option').count(), clips.length);
  const samples = [];
  for (let pass = 1; pass <= 2; pass++) {
    for (const clip of clips) {
      await select.selectOption(clip.key);
      const first = await selected();
      assert.equal(first.bank, 100);
      assert.equal(first.id, clip.id);
      assert.equal(first.frames, clip.frames);
      assert.equal(first.fps, 60);
      assert.equal(first.timeS, 0);
      assert.equal(first.playing, false);
      assert.equal(first.visible, 'visible');
      assert.equal(first.parts, 6);
      assert.equal(first.vertices, 72346);
      assert.ok([...first.bounds.min, ...first.bounds.max].every(Number.isFinite));
      const height = first.bounds.max[1] - first.bounds.min[1];
      assert.ok(height > 1.5 && height < 1.9, `${clip.key} must be upright (height ${height})`);
      await embedded.locator('#next').click();
      const next = await selected();
      assert.equal(next.frame, 1);
      closeTo(next.timeS, 1 / 60);
      assert.match(await frameStatus.textContent(), /参考 0\.017 s/);
      await embedded.locator('#prev').click();
      assert.equal((await selected()).timeS, 0);
      samples.push({ pass, clip: clip.key, first, next });
    }
  }
  const holdStart = samples.find((sample) => sample.clip === 'hold').first;
  const fireStart = samples.find((sample) => sample.clip === 'fire').first;
  const wristDistance = (a, b) => Math.hypot(...a.weaponJoint.map((value, i) => value - b.weaponJoint[i]));
  assert.ok(wristDistance(holdStart, fireStart) < 0.003, 'fire starts near the hold reference pose');
  await embedded.locator('#timeline').evaluate((timeline) => {
    timeline.value = timeline.max;
    timeline.dispatchEvent(new Event('input'));
  });
  await embedded.locator('#next').click();
  assert.equal((await selected()).frame, 312);
  await embedded.locator('#prev').click();
  assert.equal((await selected()).frame, 311);
  closeTo((await selected()).timeS, 311 / 60);
  assert.equal(await follow.isChecked(), false);
  await follow.check();

  await page.locator('#enter').click();
  await page.waitForFunction(() => document.pointerLockElement?.id === 'viewport');
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => document.querySelector('#reference-clip').value === 'raise');
  assert.equal((await selected()).id, 140);
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('action.recovered raise'));
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await page.waitForFunction(() => document.querySelector('#reference-clip').value === 'fire', null, { timeout: 7000 })
    .catch(async (error) => {
      throw new Error(`Fire did not select 100/1100. Recent simulation events:\n${await page.locator('#events').textContent()}`, { cause: error });
    });
  assert.equal((await selected()).id, 1100);
  await page.waitForFunction(() => document.querySelector('#events').textContent.includes('action.recovered fire'));
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => document.querySelector('#reference-clip').value === 'reload');
  assert.equal((await selected()).id, 1200);
  await page.waitForFunction(() => document.querySelector('[data-event=refilled]').hasAttribute('data-time-s'));
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => !document.pointerLockElement);
  await page.mouse.up({ button: 'right' });

  const getTimes = async () => Object.fromEntries(await Promise.all([
    'raise', 'fired', 'spent', 'refilled',
  ].map(async (key) => {
    const value = await marker(key).evaluate((button) => ({
      tick: Number(button.dataset.tick), order: Number(button.dataset.order),
      timeS: Number(button.dataset.timeS), text: button.textContent,
    }));
    assert.ok(value.tick > 0 && value.order >= 0);
    closeTo(value.timeS, value.tick / 60);
    assert.match(value.text, /\d+\.\d{3} s/);
    return [key, value];
  })));
  const events = await getTimes();
  closeTo(events.fired.timeS, events.spent.timeS);
  assert.ok(events.fired.order < events.spent.order);
  assert.ok(events.raise.tick < events.fired.tick && events.spent.tick < events.refilled.tick);
  assert.match(events.spent.text, /7\/16$/);
  assert.match(events.refilled.text, /8\/15$/);

  for (const [key, id] of [['refilled', 1200], ['spent', 1100], ['raise', 140], ['fired', 1100]]) {
    await marker(key).click();
    const pose = await selected();
    assert.equal(pose.id, id);
    assert.equal(pose.timeS, 0);
    assert.equal(await follow.isChecked(), false);
  }
  await embedded.locator('#next').click();
  closeTo((await selected()).timeS, 1 / 60);
  assert.match(await embedded.locator('#kind').textContent(), /单发叠加示意/);
  await embedded.locator('#timeline').evaluate((timeline) => {
    timeline.value = '0.1';
    timeline.dispatchEvent(new Event('input'));
  });
  const shotPose = await selected();
  assert.equal(shotPose.frame, 6);
  assert.ok(wristDistance(fireStart, shotPose) > 0.02, 'source recoil changes the displayed weapon joint');
  assert.deepEqual(await getTimes(), events, 'reference scrubbing keeps simulation times intact');
  await page.screenshot({ path: path.join(out, 'comparison.png') });

  await page.setViewportSize({ width: 640, height: 900 });
  const mobileLeft = await page.locator('#viewport').boundingBox();
  const mobileRight = await iframe.boundingBox();
  assert.equal(mobileRight.x, mobileLeft.x);
  assert.ok(mobileRight.y > mobileLeft.y + mobileLeft.height);
  await embedded.locator('#prev').click();
  closeTo((await selected()).timeS, 5 / 60);
  assert.deepEqual(errors, []);
  return { samples, shotPose, events, errors };
}

if (!existsSync(path.join(project, 'dist/index.html'))) {
  throw new Error('Run npm run build in web-3c first');
}
await mkdir(out, { recursive: true });
const server = await preview({ root: project, preview: { host: '127.0.0.1', port: 0 } });
try {
  const { port } = server.httpServer.address();
  const url = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const results = await check(browser, url);
    await writeFile(path.join(out, 'reference-check.json'), JSON.stringify({
      chromium: browser.version(), ...results,
    }, null, 2) + '\n');
    console.log(`Chromium ${browser.version()}: ${results.samples.length} paused clip samples, 4 event jumps, no browser errors`);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
