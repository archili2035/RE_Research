import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { cameraTuneSteps } from './camera-tune-route.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const variant = process.argv[2];
assert.ok(variant === 'before' || variant === 'after', 'Expected before or after.');
assert.ok(process.env.CAMERA_FFMPEG, 'Set CAMERA_FFMPEG to ffmpeg with MJPEG and VP8 support.');
const evidence = new URL('../../runtime/web-3c-camera-tune.tmp/', import.meta.url);
await mkdir(evidence, { recursive: true });

function installRecorder() {
  if (window !== window.top) return;
  const callbacks = new Map();
  let animationId = 0;
  let frame = 0;
  window.requestAnimationFrame = (callback) => {
    callbacks.set(++animationId, callback);
    return animationId;
  };
  window.cancelAnimationFrame = (id) => callbacks.delete(id);
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '#viewport { position: fixed; inset: 0; width: 100vw; height: 100vh; border: 0; z-index: 10; }';
    document.head.append(style);
  });

  const output = document.createElement('canvas');
  output.width = 768;
  output.height = 432;
  const ctx = output.getContext('2d', { willReadFrequently: true });
  const center = [output.width / 2, output.height / 2];
  let previous = {};
  let tick = 0;

  function draw() {
    const scheduled = [...callbacks.values()];
    callbacks.clear();
    for (const callback of scheduled) callback(frame * 1000 / 60);
    frame += 1;
  }

  function dispatch(input) {
    function key(code, down) {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    }
    for (const [code, axis, value] of [
      ['KeyW', 'moveY', 1], ['KeyS', 'moveY', -1], ['KeyA', 'moveX', -1], ['KeyD', 'moveX', 1],
    ]) {
      if ((input[axis] === value) !== (previous[axis] === value)) key(code, input[axis] === value);
    }
    function button(code, down) {
      document.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button: code }));
    }
    if (Boolean(input.aimHeld) !== Boolean(previous.aimHeld)) button(2, input.aimHeld);
    if (input.firePressed) { button(0, true); button(0, false); }
    if (input.interactPressed) { key('KeyE', true); key('KeyE', false); }
    if (input.lookDeltaX || input.lookDeltaY) {
      const event = new MouseEvent('mousemove');
      Object.defineProperties(event, {
        movementX: { value: input.lookDeltaX || 0 },
        movementY: { value: input.lookDeltaY || 0 },
      });
      document.dispatchEvent(event);
    }
    previous = input;
  }

  window.cameraRecord = {
    prime: draw,
    record(steps) {
      const viewport = document.querySelector('#viewport');
      const source = viewport.querySelector('canvas');
      const crosshair = viewport.querySelector('.crosshair').getBoundingClientRect();
      const bounds = source.getBoundingClientRect();
      if (Math.abs(crosshair.x + crosshair.width / 2 - bounds.x - bounds.width / 2) > 0.75 ||
          Math.abs(crosshair.y + crosshair.height / 2 - bounds.y - bounds.height / 2) > 0.75) {
        throw new Error('The DOM crosshair is not at the rendered viewport centre');
      }
      return steps.map(({ phase, input }) => {
        dispatch(input);
        draw();
        tick += 1;
        const snapshot = document.querySelector('#snapshot').value;
        if (!snapshot.startsWith('步号 ' + tick + ' ')) throw new Error('Unexpected fixed step: ' + snapshot);
        ctx.drawImage(source, 0, 0, output.width, output.height);
        const pixel = [...ctx.getImageData(...center, 1, 1).data];

        // Burn in the position of the actual DOM crosshair and the fixed-step labels.
        ctx.strokeStyle = '#eef8f9';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(...center, crosshair.width / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#11171be6';
        ctx.fillRect(12, 12, 232, 47);
        ctx.fillRect(676, 389, 80, 31);
        ctx.fillStyle = '#eef8f9';
        ctx.font = '16px "Microsoft YaHei", sans-serif';
        ctx.fillText(phase, 21, 33);
        ctx.font = '12px "Microsoft YaHei", sans-serif';
        ctx.fillText('步 ' + tick + '  ·  ' + snapshot.split('\n').at(-1), 21, 51);
        ctx.font = '18px monospace';
        ctx.fillText(document.querySelector('#ammo').value, 684, 410);
        return {
          snapshot, pixel,
          events: document.querySelector('#events').textContent.split('\n').filter(line => line.startsWith(tick + '.')),
          jpeg: output.toDataURL('image/jpeg', 0.88).split(',')[1],
        };
      });
    },
  };
}

const server = await preview({
  root: fileURLToPath(new URL('../', import.meta.url)),
  build: { outDir: fileURLToPath(new URL(variant + '-dist/', evidence)) },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true },
});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 768, height: 432 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(installRecorder);
  await page.goto('http://127.0.0.1:4175/');
  await page.waitForFunction(() => !document.querySelector('#enter').disabled, null, { polling: 50 });
  const enter = await page.locator('#enter').boundingBox();
  await page.mouse.click(enter.x + enter.width / 2, enter.y + enter.height / 2);
  await page.waitForFunction(() => document.pointerLockElement?.id === 'viewport', null, { polling: 50 });
  await page.evaluate(() => window.cameraRecord.prime());

  const frames = [];
  const images = [];
  for (let start = 0; start < cameraTuneSteps.length; start += 15) {
    const batch = await page.evaluate((steps) => window.cameraRecord.record(steps), cameraTuneSteps.slice(start, start + 15));
    for (const { jpeg, ...record } of batch) {
      const data = Buffer.from(jpeg, 'base64');
      if (record.events.some(line => line.includes('weapon.fired'))) {
        await writeFile(new URL(variant + '-fire.jpg', evidence), data);
      }
      images.push(data);
      frames.push(record);
    }
  }
  assert.deepEqual(errors, []);
  const shot = frames.findIndex(({ events }) => events.some(line => line.includes('weapon.fired')));
  assert.ok(frames[shot].events.some(line => line.includes('target.hit target-practice')));
  assert.match(frames[shot].snapshot, /鼠标 \[1, -1\]/);
  const [r, g, b] = frames[shot].pixel;
  const [oldR, oldG] = frames[shot - 1].pixel;
  assert.ok(g > 1.1 * r && g >= b && oldR > oldG, 'Centre pixel should change from orange target to green hit flash.');
  const input = new URL(variant + '.mjpeg', evidence);
  await writeFile(input, Buffer.concat(images));
  const ffmpeg = spawn(process.env.CAMERA_FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60',
    '-c:v', 'mjpeg', '-i', fileURLToPath(input), '-c:v', 'libvpx', '-b:v', '1M', '-crf', '18',
    '-pix_fmt', 'yuv420p', fileURLToPath(new URL(variant + '.webm', evidence)),
  ], { stdio: 'inherit' });
  const [exitCode] = await once(ffmpeg, 'exit');
  assert.equal(exitCode, 0);
  await unlink(input);
  await writeFile(new URL(variant + '-browser.json', evidence), JSON.stringify({
    chromium: browser.version(), fps: 60, shotTick: shot + 1, errors, frames,
  }, null, 2) + '\n');
  console.log(variant, frames.length, 'frames; confirmed centre hit and mouse input at tick', shot + 1);
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
