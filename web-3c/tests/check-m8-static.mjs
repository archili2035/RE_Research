import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { checkRoute, chromium, evidenceDirectory, formatRouteEvent, project, readFixedRoute, viewport } from './m8-browser-route.mjs';

const fixed = await readFixedRoute();
const expected = JSON.parse(await readFile(new URL('fixtures/route.replay.json', project), 'utf8'));
const finalTick = expected.inputs.length;
assert.equal(expected.level.id, 'test-room', 'M8 requires the formal M7 route');
assert.equal(finalTick, fixed.tickCount);
assert.deepEqual(expected.events, fixed.events);

const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const { port } = socket.address();
await new Promise(resolve => socket.close(resolve));
const server = spawn('python', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: fileURLToPath(new URL('../', project)),
  windowsHide: true, stdio: 'ignore',
});
const root = 'http://127.0.0.1:' + port + '/docs/';
const remote = 'http://m8.test:' + port + '/docs/';
const out = { staticBase: root, remoteBase: remote, route: [], pages: {} };
let serverError;
server.on('error', error => { serverError = error; });
try {
  const deadline = Date.now() + 5000;
  while (!await fetch(root + 'index.html').then(r => r.ok, () => false)) {
    if (serverError) throw serverError;
    if (server.exitCode !== null || Date.now() > deadline) throw new Error('Static HTTP server did not become ready');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--enable-unsafe-swiftshader', '--no-proxy-server', '--host-resolver-rules=MAP m8.test 127.0.0.1'] });
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    const network = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => network.push([new URL(r.url()).pathname, r.status()]));
    await page.goto(root);
    const playLink = page.getByRole('link', { name: /打开 3C 灰盒试玩/ });
    await playLink.click();
    assert.equal(page.url(), root + 'web-3c/index.html');
    await page.getByRole('link', { name: '返回研究首页' }).click();
    assert.equal(page.url(), root + 'index.html');
    await playLink.click();
    await page.getByRole('link', { name: '动作姿态回读' }).click();
    assert.equal(page.url(), root + 'web-3c/m2.html');
    await page.waitForFunction(() => !document.querySelector('#clip').disabled);
    const samples = await page.locator('#clip option').allTextContents();
    assert.equal(samples.length, 5);
    await page.locator('#clip').selectOption('reload');
    await page.locator('#play').click();
    await page.waitForFunction(() => Number(document.querySelector('#time').value) > 0.05);
    const m2 = JSON.parse(await page.locator('#measurements').getAttribute('data-readback'));
    assert.ok(m2.trackCount > 0);
    await page.getByRole('link', { name: '返回 3C 灰盒' }).click();
    assert.equal(page.url(), root + 'web-3c/');
    await page.getByRole('link', { name: '路线回放与调参' }).click();
    assert.equal(page.url(), root + 'web-3c/m7.html');
    const state = page.locator('#status');
    const waitStatus = status => page.waitForFunction(status => document.querySelector('#status').value === status, status);
    await waitStatus('准备播放');
    const resets = [];
    for (let i = 0; i < 2; i++) {
      await page.locator('#reset').click();
      assert.match(await page.locator('#snapshot').textContent(), /步号 0 .*弹匣\/备用 8\/16/s);
      await page.locator('#step').click();
      assert.ok((await page.locator('#snapshot').textContent()).startsWith('步号 1 / ' + finalTick + ' '));
      await page.locator('#play').click();
      await waitStatus('完成 · 事件与基线一致');
      const snapshot = await page.locator('#snapshot').textContent();
      assert.ok(snapshot.startsWith('步号 ' + finalTick + ' / ' + finalTick + ' '));
      assert.match(snapshot, /弹匣\/备用 8\/15/);
      const download = page.waitForEvent('download');
      await page.locator('#download-trace').click();
      const replay = JSON.parse(await readFile(await (await download).path(), 'utf8'));
      assert.deepEqual(replay, expected);
      resets.push({ status: await state.textContent(), snapshot,
        eventCount: replay.events.length, events: replay.events });
    }
    assert.deepEqual(resets[0], resets[1]);
    assert.deepEqual(errors, []);
    const bad = network.filter(([p, status]) => !p.startsWith('/docs/') || (status >= 400 && !p.includes('/__re9-reference/')));
    assert.deepEqual(bad, []);
    out.pages = { samples, m2, resets, network, errors };
    await page.close();
    for (const suffix of ['web-3c/index.html', 'web-3c/']) {
      const result = await checkRoute(browser, root + suffix, 'original', fixed, { warmup: 0 });
      assert.equal(result.cfg.leonEnabled, false);
      assert.equal(result.cfg.referenceAvailable, false);
      assert.match(result.cfg.referenceText, /本地参考素材未提供/);
      assert.deepEqual(result.network.filter(([p, code]) => code >= 400 || !p.startsWith('/docs/web-3c/')),
        [['/docs/web-3c/__re9-reference/player_index.html', 404]]);
      out.route.push(result);
      console.log('Static route: ' + suffix + ' -> ' + JSON.stringify(result.points.at(-1)));
    }
    assert.deepEqual(out.route[0].events, out.route[1].events);
    for (const replay of resets) {
      assert.deepEqual(replay.events.map(formatRouteEvent), out.route[0].events);
      assert.match(replay.snapshot, /弹匣\/备用 8\/15/);
    }
    out.replayComparison = { status: 'matched', level: expected.level, ticks: finalTick };
    const portal = await browser.newPage();
    const remoteRequests = [];
    const remoteErrors = [];
    portal.on('pageerror', error => remoteErrors.push(error.message));
    portal.on('response', r => remoteRequests.push([new URL(r.url()).pathname, r.status()]));
    await portal.goto(remote + 'index.html');
    await portal.getByRole('link', { name: /打开 3C 灰盒试玩/ }).click();
    await portal.waitForFunction(() => !document.querySelector('#player-appearance').options[1].disabled &&
      !document.querySelector('#reference-follow').disabled);
    assert.equal(await portal.locator('#reference-view').getAttribute('src'), remote + 'player_index.html?embed=web-3c');
    assert.deepEqual(remoteRequests.filter(([p, status]) => !p.startsWith('/docs/') || status >= 400), []);
    assert.deepEqual(remoteErrors, []);
    await portal.getByRole('link', { name: '返回研究首页' }).click();
    assert.equal(portal.url(), remote + 'index.html');
    out.portalStyleHost = { remoteRequests, remoteErrors, returnUrl: portal.url() };
    await writeFile(new URL('static.json', evidenceDirectory), JSON.stringify(out, null, 2));
    console.log('Static Chromium checks passed for portal links, M2, M7, degraded M2 dependencies, and two full routes.');
  } finally { await browser.close(); }
} finally { server.kill(); }

