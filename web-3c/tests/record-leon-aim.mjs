import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const mode = process.argv[2];
assert.ok(['audit', 'before', 'after'].includes(mode));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const project = new URL('../', import.meta.url);
const out = new URL('../../runtime/web-3c-leon-aim.tmp/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--enable-unsafe-swiftshader'] });

async function audit() {
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
  await page.goto(new URL('../../docs/player_index.html?embed=web-3c', import.meta.url).href);
  const routes = [];
  for (const id of [160, 165, 167]) {
    const meta = await page.evaluate((id) => {
      if (!window.player.selectClip(100, id)) throw new Error(`Missing ${id}`);
      const { name, frames, fps, duration } = window.player.clip;
      return { id, name, frames, fps, duration };
    }, id);
    const samples = [];
    for (let start = 0; start <= meta.frames; start += 30) {
      samples.push(...await page.evaluate(({ start, count }) => {
        const { clip } = window.player;
        const next = document.querySelector('#next');
        const bones = ['root', 'Hip', 'Spine_0', 'Spine_1', 'Spine_2', 'L_Arm_Clavicle', 'R_Arm_Clavicle',
          'L_Arm_Upper', 'R_Arm_Upper', 'L_Arm_Hand', 'R_Arm_Hand', 'R_Wep'];
        return Array.from({ length: count }, (_, i) => {
          const frame = start + i;
          const { time, pose } = window.player;
          if (Math.round(time * clip.fps) !== frame) throw new Error(`Player did not reach frame ${frame}`);
          const joints = Object.fromEntries(bones.map((name) => {
            const index = clip.bones.findIndex((bone) => bone.name === name);
            const bone = clip.bones[index];
            const track = clip.tracks.find(({ bone }) => bone === index);
            return [name, { ...pose[index], localP: MotionMath.sample(track?.position, time, bone.position),
              localQ: MotionMath.sample(track?.rotation, time, bone.rotation, true) }];
          }));
          if (frame < clip.frames) next.click();
          return { frame, time, joints };
        });
      }, { start, count: Math.min(30, meta.frames + 1 - start) }));
    }
    routes.push({ ...meta, samples });
  }
  await writeFile(new URL('source-frames.json', out), JSON.stringify(routes) + '\n');
  console.log(routes.map(({ id, samples }) => `${id}: ${samples.length} player frames`).join(', '));
  await page.close();
}

const course = [
  [24, '', { walk: true }], [36, '', { aim: true, pitch: 20 }],
  [36, '站定举枪', { aim: true }], [60, '慢向左转', { aim: true, yaw: -2 }],
  [42, '停住', { aim: true }], [60, '慢向右转', { aim: true, yaw: 2 }],
  [42, '停住', { aim: true }], [36, '单发', { aim: true, fire: true }],
].flatMap(([ticks, label, input]) => Array.from({ length: ticks }, (_, index) => ({
  label, input: { ...input, fire: index === 0 && input.fire, pitch: index === 0 ? input.pitch : 0 },
})));

function installCapture() {
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
    const callbacks = [...frames.values()];
    frames.clear();
    tick += 1;
    for (const callback of callbacks) callback(tick * 1000 / 60);
  }
  window.aimRecord = {
    prime: draw,
    record(steps, title) {
      const canvas = document.querySelector('#viewport canvas');
      return steps.flatMap(({ label, input }) => {
        if (Boolean(input.walk) !== Boolean(previous.walk)) {
          window.dispatchEvent(new KeyboardEvent(input.walk ? 'keydown' : 'keyup', { code: 'KeyW' }));
        }
        if (Boolean(input.aim) !== Boolean(previous.aim)) {
          document.dispatchEvent(new MouseEvent(input.aim ? 'mousedown' : 'mouseup', { button: 2 }));
        }
        if (input.fire) {
          document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
          document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
        }
        if (input.yaw || input.pitch) {
          document.dispatchEvent(new MouseEvent('mousemove', { movementX: input.yaw || 0, movementY: input.pitch || 0 }));
        }
        previous = input;
        draw();
        const snapshot = document.querySelector('#snapshot').value;
        if (!snapshot.startsWith(`步号 ${tick} `)) throw new Error(`Unexpected fixed step: ${snapshot}`);
        if (!label || tick % 2) return [];
        ctx.drawImage(canvas, 0, 0, picture.width, picture.height);
        ctx.fillStyle = '#11191de6';
        ctx.fillRect(16, 16, 390, 60);
        ctx.fillStyle = '#eaf5f7';
        ctx.font = '20px "Microsoft YaHei", sans-serif';
        ctx.fillText(title, 27, 41);
        ctx.font = '15px "Microsoft YaHei", sans-serif';
        ctx.fillText(label, 27, 64);
        return [{ tick, label, snapshot, jpeg: picture.toDataURL('image/jpeg', 0.88).split(',')[1] }];
      });
    },
  };
}

async function record() {
  assert.ok(process.env.CAMERA_FFMPEG, 'Set CAMERA_FFMPEG to ffmpeg with MJPEG and VP8 support');
  const dist = mode === 'before' ? new URL('before-dist/', out) : new URL('dist/', project);
  const server = await preview({ root: fileURLToPath(project), build: { outDir: fileURLToPath(dist) },
    preview: { host: '127.0.0.1', port: 0 } });
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
    await page.evaluate(() => window.aimRecord.prime());
    const title = mode === 'before' ? '改前 · 100/160 首帧' : '改后 · 持枪循环与转向混合';
    const frames = [];
    const images = [];
    for (let start = 0; start < course.length; start += 18) {
      const batch = await page.evaluate(({ steps, title }) => window.aimRecord.record(steps, title),
        { steps: course.slice(start, start + 18), title });
      for (const { jpeg, ...rest } of batch) {
        images.push(Buffer.from(jpeg, 'base64'));
        frames.push(rest);
      }
    }
    assert.deepEqual(errors, []);
    const events = await page.locator('#events').textContent();
    assert.match(events, /weapon\.fired/);
    assert.match(events, /ammo\.committed 7\/16/);
    const input = new URL(mode + '.mjpeg', out);
    await writeFile(input, Buffer.concat(images));
    const ffmpeg = spawn(process.env.CAMERA_FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe',
      '-framerate', '30', '-c:v', 'mjpeg', '-i', fileURLToPath(input), '-c:v', 'libvpx', '-b:v', '1M', '-crf', '19',
      '-pix_fmt', 'yuv420p', fileURLToPath(new URL(mode + '.webm', out))], { stdio: 'inherit', windowsHide: true });
    const [code] = await once(ffmpeg, 'exit');
    assert.equal(code, 0);
    await unlink(input);
    await writeFile(new URL(mode + '-browser.json', out), JSON.stringify({ buildId, fps: 30, frames, events }, null, 2) + '\n');
    console.log(`${mode}: ${frames.length} frames, ${buildId}`);
    await page.close();
  } finally {
    await server.close();
  }
}

try {
  await (mode === 'audit' ? audit() : record());
} finally {
  await browser.close();
}
