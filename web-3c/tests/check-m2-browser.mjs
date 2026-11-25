import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const project = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(project, '../runtime/web-3c-m2.tmp');
const tolerance = 1e-5;
const near = (actual, expected, label, limit = tolerance) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= limit,
    `${label}: ${actual} differs from ${expected} by more than ${limit}`);
};
const nearVector = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, i) => near(value, expected[i], `${label}[${i}]`));
};
const pitch = (pose) => Math.asin(pose.weaponForward[1]) * 180 / Math.PI;

async function check(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const glbs = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    if (response.url().endsWith('.glb') && new URL(response.frame().url()).pathname.endsWith('/m2.html')) {
      glbs.push(response.url());
    }
  });
  await page.goto(url);
  await page.locator('a[href="./m2.html"]').click();
  const clip = page.locator('#clip');
  const time = page.locator('#time');
  const readback = page.locator('#measurements');
  await page.waitForFunction(() => !document.querySelector('#clip').disabled ||
    document.querySelector('#status').textContent === '姿态回读失败');
  assert.deepEqual(errors, []);
  assert.equal(await page.locator('#viewport canvas').count(), 1);
  assert.equal(glbs.length, 1, 'all actions and their reference share one GLB request');

  const poses = {};
  async function sample(label, id, timeS, blend, trackCount, screenshot = false) {
    await clip.selectOption(id);
    if (id) {
      await time.evaluate((element, value) => {
        element.value = String(value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }, timeS);
    } else {
      assert.ok(await time.isDisabled());
    }
    const pose = JSON.parse(await readback.getAttribute('data-readback'));
    assert.equal(pose.clip, id || 'bind');
    assert.equal(pose.blend, blend);
    assert.equal(pose.trackCount, trackCount);
    near(pose.timeS, timeS, label + ' time');
    assert.equal(pose.binding.bones, 17);
    assert.equal(pose.binding.vertices, 456);
    near(pose.binding.inverseBindError, 0, label + ' inverse bind');
    near(pose.binding.vertexErrorM, 0, label + ' bind vertex');
    assert.ok([...pose.bounds.min, ...pose.bounds.max].every(Number.isFinite));
    near(pose.bounds.min[1], 0, label + ' floor');
    near(pose.bounds.max[1], 1.82, label + ' height');
    nearVector(pose.forward, [0, 0, -1], label + ' forward');
    nearVector(pose.root, [0, 0, 0], label + ' root');
    nearVector(pose.rightFoot, [0.125, 0.08, 0], label + ' right foot');
    nearVector(pose.leftFoot, [-0.125, 0.08, 0], label + ' left foot');
    assert.equal(pose.socketParent, 'R_Hand');
    assert.equal(pose.propParent, 'R_Wep');
    nearVector(pose.socketLocal, [0, -0.043, 0.046], label + ' socket local');
    poses[label] = pose;
    if (screenshot) await page.locator('#viewport').screenshot({ path: path.join(out, label + '.png') });
    return pose;
  }

  const bind = await sample('bind', '', 0, null, 0);
  const hold = await sample('hold', 'hold-idle', 0.40, 'normal', 6, true);
  const raiseStart = await sample('raise-start', 'raise', 0, 'normal', 6);
  const raiseMid = await sample('raise-mid', 'raise', 0.22, 'normal', 6, true);
  const aim = await sample('aim', 'raise', 0.44, 'normal', 6);
  const fireStart = await sample('fire-start', 'fire', 0, 'additive', 6);
  const firePeak = await sample('fire-peak', 'fire', 0.06, 'additive', 6, true);
  const fireEnd = await sample('fire-end', 'fire', 0.24, 'additive', 6);
  const reloadDrop = await sample('reload-drop', 'reload', 0.3, 'baked', 13);
  const reloadContact = await sample('reload-contact', 'reload', 0.72, 'baked', 13, true);
  const reloadEnd = await sample('reload-end', 'reload', 1.4, 'baked', 13);
  const restored = await sample('bind-restored', '', 0, null, 0);
  nearVector(restored.socketPosition, bind.socketPosition, 'switch back to bind');
  nearVector(restored.leftHand, bind.leftHand, 'left hand restored');
  nearVector(restored.leftHandRotation, bind.leftHandRotation, 'left hand rotation restored');
  nearVector(hold.socketPosition, raiseStart.socketPosition, 'raise starts in hold');
  near(pitch(hold), -18, 'hold angle', 0.01);
  near(pitch(raiseMid), -8, 'raise mid angle', 0.01);
  near(pitch(aim), 0, 'aim angle', 0.01);
  assert.ok(hold.socketPosition[1] < raiseMid.socketPosition[1] &&
    raiseMid.socketPosition[1] < aim.socketPosition[1], 'raise lifts weapon smoothly at key poses');
  for (const pose of [fireStart, firePeak, fireEnd]) near(pose.referenceTimeS, 0.44, 'fire base time');
  for (const pose of [fireStart, fireEnd, reloadEnd]) {
    nearVector(pose.weaponForward, aim.weaponForward, pose.clip + ' aim direction');
    nearVector(pose.socketPosition, aim.socketPosition, pose.clip + ' aim position');
    nearVector(pose.leftHand, aim.leftHand, pose.clip + ' aim support hand');
    nearVector(pose.leftHandRotation, aim.leftHandRotation, pose.clip + ' aim support hand rotation');
  }
  near(pitch(firePeak), 13, 'fire recoil angle', 0.01);
  assert.ok(reloadDrop.reloadContactM > 0.18);
  near(reloadDrop.magazineOffsetM, Math.hypot(0.15, 0.035), 'magazine displaced');
  near(reloadContact.reloadContactM, 0, 'left hand reaches magazine well');
  near(reloadContact.magazineOffsetM, 0, 'magazine reaches well');

  await clip.selectOption('fire');
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('#time-value').value === '0.240');
  assert.equal(await page.locator('#play').textContent(), '播放');
  assert.deepEqual(errors, []);
  return { glbRequests: glbs.length, errors, poses };
}

if (!existsSync(path.join(project, 'dist/m2.html'))) throw new Error('Run npm run build in web-3c first');
await mkdir(out, { recursive: true });
const server = await preview({ root: project, preview: { host: '127.0.0.1', port: 0 } });
try {
  const { port } = server.httpServer.address();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const result = await check(browser, `http://127.0.0.1:${port}/`);
    const hashes = {};
    for (const name of ['clips.json', 'm2-rehearsal.glb']) {
      hashes[name] = createHash('sha256').update(await readFile(path.join(project, 'dist/assets', name))).digest('hex');
    }
    await writeFile(path.join(out, 'pose-readback.json'), JSON.stringify({
      chromium: browser.version(), hashes, ...result,
    }, null, 2) + '\n');
    console.log(`Chromium ${browser.version()}: ${Object.keys(result.poses).length} poses, ${result.glbRequests} GLB request, no browser errors`);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
