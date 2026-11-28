import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const variant = process.argv[2];
assert.ok(variant === 'before' || variant === 'after', 'Expected before or after');
assert.ok(process.env.CAMERA_FFMPEG, 'Set CAMERA_FFMPEG to ffmpeg with MJPEG and VP8 support');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const project = new URL('../', import.meta.url);
const evidence = new URL('../../runtime/web-3c-leon-strafe.tmp/', import.meta.url);
await mkdir(evidence, { recursive: true });

const route = [
  [26, '', { moveY: 1, look: 305 }],
  [34, '', { aim: true }],
  [16, '举枪站姿', { aim: true }],
  [75, '持续左移 · A', { aim: true, moveX: -1 }],
  [58, '换向右移 · A → D', { aim: true, moveX: 1 }],
  [26, '松键急停', { aim: true }],
  [108, '左移贴墙 · 持续按 A', { aim: true, moveX: -1 }],
  [24, '松键保持站姿', { aim: true }],
].flatMap(([ticks, label, input]) => Array.from({ length: ticks }, (_, index) =>
  ({ label, input: { ...input, look: index === 0 ? input.look : undefined } })));

function installCapture() {
  if (window !== window.top) return;
  const frames = new Map();
  let key = 0;
  let tick = -1;
  let previous = {};
  window.requestAnimationFrame = (callback) => { frames.set(++key, callback); return key; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '#viewport { position: fixed; inset: 0; width: 100vw; height: 100vh; border: 0; z-index: 10; }';
    document.head.append(style);
  });
  const picture = document.createElement('canvas');
  picture.width = 960;
  picture.height = 540;
  const ctx = picture.getContext('2d');
  function draw() {
    const callbacks = Array.from(frames.values());
    frames.clear();
    tick += 1;
    for (const callback of callbacks) callback(tick * 1000 / 60);
  }
  window.strafeRecord = {
    prime: draw,
    record(steps, title) {
      const canvas = document.querySelector('#viewport canvas');
      return steps.flatMap(({ label, input }) => {
        for (const [code, axis, value] of [['KeyW', 'moveY', 1], ['KeyA', 'moveX', -1], ['KeyD', 'moveX', 1]]) {
          const down = input[axis] === value;
          if (down !== (previous[axis] === value)) window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
        }
        if (Boolean(input.aim) !== Boolean(previous.aim)) {
          document.dispatchEvent(new MouseEvent(input.aim ? 'mousedown' : 'mouseup', { button: 2 }));
        }
        if (input.look) document.dispatchEvent(new MouseEvent('mousemove', { movementY: input.look }));
        previous = input;
        draw();
        const snapshot = document.querySelector('#snapshot').value;
        if (!snapshot.startsWith(`步号 ${tick} `)) throw new Error(`Unexpected fixed step at ${tick}: ${snapshot}`);
        if (!label || tick % 2) return [];
        ctx.drawImage(canvas, 0, 0, picture.width, picture.height);
        ctx.fillStyle = '#11191de6';
        ctx.fillRect(16, 16, 364, 60);
        ctx.fillStyle = '#eaf5f7';
        ctx.font = '20px "Microsoft YaHei", sans-serif';
        ctx.fillText(title, 27, 41);
        ctx.font = '15px "Microsoft YaHei", sans-serif';
        ctx.fillText(label, 27, 64);
        return [{ tick, label, snapshot, jpeg: picture.toDataURL('image/jpeg', 0.87).split(',')[1] }];
      });
    },
  };
}

const server = await preview({ root: fileURLToPath(project),
  build: { outDir: fileURLToPath(new URL(variant + '-dist/', evidence)) }, preview: { host: '127.0.0.1', port: 0 } });
try {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(installCapture);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.waitForFunction(() => !document.querySelector('#enter').disabled &&
      !document.querySelector('#player-appearance [value=leon]').disabled, null, { polling: 50 });
    const buildId = await page.locator('[data-build-id]').textContent();
    await page.locator('#player-appearance').selectOption('leon');
    await page.locator('#enter').click();
    await page.waitForFunction(() => document.pointerLockElement?.id === 'viewport', null, { polling: 50 });
    await page.evaluate(() => window.strafeRecord.prime());
    const title = variant === 'before' ? '改前 · 程序步态' : '改后 · 100/122 左移 · 100/126 右移';
    const frames = [];
    const images = [];
    for (let start = 0; start < route.length; start += 18) {
      const batch = await page.evaluate(({ steps, title }) => window.strafeRecord.record(steps, title),
        { steps: route.slice(start, start + 18), title });
      for (const { jpeg, ...rest } of batch) {
        images.push(Buffer.from(jpeg, 'base64'));
        frames.push(rest);
      }
    }
    assert.deepEqual(errors, []);
    assert.ok(frames.some(({ label, snapshot }) => label.includes('贴墙') && snapshot.includes('权重 0.000')));
    const input = new URL(variant + '.mjpeg', evidence);
    await writeFile(input, Buffer.concat(images));
    const ffmpeg = spawn(process.env.CAMERA_FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '30',
      '-c:v', 'mjpeg', '-i', fileURLToPath(input), '-c:v', 'libvpx', '-b:v', '1M', '-crf', '19',
      '-pix_fmt', 'yuv420p', fileURLToPath(new URL(variant + '.webm', evidence)),
    ], { stdio: 'inherit', windowsHide: true });
    const [code] = await once(ffmpeg, 'exit');
    assert.equal(code, 0);
    await unlink(input);
    await writeFile(new URL(variant + '-browser.json', evidence), JSON.stringify({ buildId, fps: 30, frames }, null, 2) + '\n');
    console.log(`${variant}: ${frames.length} frames, ${buildId}`);
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
