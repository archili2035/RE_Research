import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { testRoomRoute } from './test-room-route.mjs';

const require = createRequire(import.meta.url);
export const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
export const project = new URL('../', import.meta.url);
export const evidenceDirectory = new URL('../../runtime/web-3c-m8.tmp/', import.meta.url);
export const viewport = { width: 1440, height: 1000 };

export async function readFixedRoute() {
  const path = new URL('fixed-route.json', evidenceDirectory);
  const data = await readFile(path, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Generate fixed-route.json with LEON_ROUTE_EVIDENCE and npm test before running M8.', { cause: error });
  });
  const fixed = JSON.parse(data);
  assert.equal(fixed.tickCount, testRoomRoute.reduce((total, [, steps]) => total + steps, 0));
  assert.deepEqual(fixed.checkpoints.map(({ label }) => label), testRoomRoute.map(([label]) => label));
  return fixed;
}

// Drive the same control handlers as the playable page, supplying each stage after
// a published fixed step so frame jitter cannot change the input tick.
function observe({ mode, route }) {
  if (window !== window.top) return;
  const m = window.m8 = { frames: [], events: [], points: [], indices: 0, unfocusedFrames: 0 };
  // A visible window also receives physical mouse input, including cursor
  // adjustment on pointer-lock acquisition. Keep the scripted ticks isolated.
  for (const type of ['mousemove', 'mousedown', 'mouseup', 'keydown', 'keyup']) {
    window.addEventListener(type, event => {
      if (m.armed && !m.done && event.isTrusted && (type === 'mousemove' || m.started)) {
        event.stopImmediatePropagation();
      }
    }, { capture: true });
  }
  const output = Object.getOwnPropertyDescriptor(HTMLOutputElement.prototype, 'value');
  const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  Object.defineProperty(Node.prototype, 'textContent', {
    ...text, set(value) {
      text.set.call(this, value);
      if (this.id === 'events') {
        for (const line of value.split('\n')) if (!m.events.includes(line)) m.events.push(line);
      }
    },
  });
  let stage = 0;
  let remaining = 0;
  let old = {};
  function inputs(input) {
    function key(keyCode, pressed, wasPressed) {
      if (pressed !== wasPressed) window.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', { code: keyCode }));
    }
    function button(code, down) {
      document.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button: code }));
    }
    key('KeyW', input.moveY === 1, old.moveY === 1);
    key('KeyS', input.moveY === -1, old.moveY === -1);
    if (Boolean(input.aimHeld) !== Boolean(old.aimHeld)) button(2, input.aimHeld);
    if (input.firePressed) { button(0, true); button(0, false); }
    for (const [pressed, code] of [[input.reloadPressed, 'KeyR'], [input.interactPressed, 'KeyE']]) {
      if (pressed) { key(code, true, false); key(code, false, true); }
    }
    if (input.lookDeltaX || input.lookDeltaY) {
      const event = new MouseEvent('mousemove');
      Object.defineProperties(event, {
        movementX: { value: input.lookDeltaX ?? 0 }, movementY: { value: input.lookDeltaY ?? 0 },
      });
      document.dispatchEvent(event);
    }
    old = input;
  }
  function next() {
    const entry = route[stage++];
    if (entry) {
      remaining = entry[1];
      inputs(entry[2]);
    } else {
      inputs({});
      m.done = true;
    }
  }
  Object.defineProperty(HTMLOutputElement.prototype, 'value', {
    ...output, set(value) {
      output.set.call(this, value);
      if (this.id !== 'snapshot') return;
      if (m.armed && !m.started && document.pointerLockElement?.id === 'viewport') {
        m.started = true;
        m.startTick = Number(value.match(/步号 (\d+)/)[1]);
        m.events.length = 0;
        m.start = performance.now();
        next();
      } else if (m.started && !m.done && --remaining === 0) {
        m.points.push([route[stage - 1][0], value, document.querySelector('#ammo').textContent]);
        next();
      }
    },
  });
  for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Context) continue;
    const draw = Context.prototype.drawElements;
    Context.prototype.drawElements = function (drawMode, count, ...rest) {
      if (this.canvas.parentElement?.id === 'viewport') {
        if (!m.mainRenderer) {
          const ext = this.getExtension('WEBGL_debug_renderer_info');
          m.mainRenderer = ext ? this.getParameter(ext.UNMASKED_RENDERER_WEBGL) : this.getParameter(this.RENDERER);
        }
        m.indices = Math.max(m.indices, count);
        if (!m.firstOriginal && mode === 'original') m.firstOriginal = performance.now();
        if (!m.firstLeon && count > 10000) m.firstLeon = performance.now();
      }
      return draw.call(this, drawMode, count, ...rest);
    };
  }
  let reference;
  let previousReferenceTime;
  let last;
  function frame(now) {
    const appearance = document.querySelector('#player-appearance');
    const ref = document.querySelector('#reference-view');
    if (mode !== 'original' && appearance && !appearance.options[1].disabled && appearance.value !== 'leon') {
      if (mode === 'leon') {
        ref.style.visibility = 'hidden';
        document.querySelector('#reference-follow').checked = false;
      }
      appearance.value = 'leon';
      appearance.dispatchEvent(new Event('change'));
    }
    if (mode === 'both' && !reference && !document.querySelector('#reference-follow')?.disabled &&
        ref?.contentWindow?.player) {
      reference = ref.contentWindow.player;
      const play = ref.contentDocument.querySelector('#play');
      document.querySelector('#reference-follow').checked = false;
      if (!reference.selectClip(100, 1200)) throw new Error('Reload clip unavailable');
      ref.contentDocument.querySelector('#loop').checked = true;
      if (!reference.playing) play.click();
      m.referenceStart = performance.now();
    }
    if (m.started && !m.finished) {
      if (last !== undefined && now > last) {
        m.frames.push(now - last);
        if (!document.hasFocus() || document.visibilityState !== 'visible') m.unfocusedFrames++;
      }
      last = now;
      if (m.done) m.finished = performance.now();
    }
    if (reference && m.started && !m.finished) {
      m.referenceFrames = (m.referenceFrames || 0) + Number(reference.playing);
      if (previousReferenceTime !== undefined && reference.time !== previousReferenceTime) {
        m.referenceAdvances = (m.referenceAdvances ?? 0) + 1;
      }
      previousReferenceTime = reference.time;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export function formatRouteEvent(event) {
  let detail = event.action || '';
  if (event.type === 'ammo.committed') detail = event.magazine + '/' + event.reserve;
  if (event.type === 'target.hit') detail = event.subjectId;
  if (event.type === 'door.changed') detail = event.subjectId + (event.open ? ' open' : ' closed');
  return (event.tick + '.' + event.order + '  ' + event.type + ' ' + detail).trimEnd();
}

function details(m, fixed) {
  const events = m.events.map(line => line.replace(/^\d+/, tick => Number(tick) - m.startTick));
  assert.deepEqual(events, fixed.events.map(formatRouteEvent));
  const ordered = [...m.frames].sort((a, b) => a - b);
  assert.ok(ordered.length > 60);
  const percentile = (p) => ordered[Math.ceil(ordered.length * p) - 1];
  const point = name => m.points.find(([label]) => label === name);
  const positionZ = text => Number(text.match(/坐标 [^,]+, [^,]+, ([\d.-]+)/)[1]);
  const [, approach] = point('door-blocked');
  const [, inside] = point('next-room');
  const [, blocked] = point('return-blocked');
  const [label, returned, ammo] = m.points.at(-1);
  assert.equal(label, 'return');
  assert.equal(ammo, '8 / 15');
  assert.ok(Math.abs(positionZ(approach) - 0.44) < 0.06, approach);
  assert.ok(positionZ(inside) < -0.75, inside);
  assert.ok(Math.abs(positionZ(blocked) + 0.44) < 0.06, blocked);
  assert.ok(positionZ(returned) > 0.5, returned);
  return {
    loadMs: Math.round(Math.max(m.firstOriginal || m.firstLeon, m.referenceStart || 0)),
    renderer: m.mainRenderer, samples: ordered.length, routeMs: Math.round(m.finished - m.start),
    p50: percentile(0.5), p95: percentile(0.95), max: ordered.at(-1),
    over50: ordered.filter((delta) => delta > 50).length,
    over100: ordered.filter((delta) => delta > 100).length,
    referenceFrames: m.referenceFrames || 0, referenceAdvances: m.referenceAdvances || 0,
    indices: m.indices, unfocusedFrames: m.unfocusedFrames,
    events, points: m.points, frameMs: m.frames,
  };
}

export async function checkRoute(browser, url, mode, fixed, { intercept = false, warmup = 600 } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    const network = [];
    const errors = [];
    const consoleErrors = [];
    const warnings = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
      if (message.type() === 'warning') warnings.push(message.text());
    });
    page.on('response', response => network.push([new URL(response.url()).pathname, response.status()]));
    if (intercept && mode === 'original') {
      await page.route('**/__re9-reference/**', request => request.fulfill({ status: 200, body: '' }));
    }
    await page.addInitScript(observe, { mode, route: testRoomRoute });
    await page.goto(url);
    await page.waitForFunction(mode => {
      const m = window.m8;
      return !document.querySelector('#enter').disabled &&
        (mode === 'original' ? m.firstOriginal : m.firstLeon) &&
        (mode !== 'both' || m.referenceStart);
    }, mode);
    await page.bringToFront();
    if (warmup) await page.waitForTimeout(warmup);
    const cfg = await page.evaluate(() => {
      const canvas = document.querySelector('#viewport canvas');
      const r = document.querySelector('#reference-view');
      const canvas2 = r.contentDocument?.querySelector('#view');
      return {
        dpr: devicePixelRatio,
        viewport: [innerWidth, innerHeight],
        browserWindow: [outerWidth, outerHeight],
        screen: [screen.width, screen.height],
        visibility: document.visibilityState,
        canvas: [canvas.width, canvas.height],
        referenceCanvas: canvas2 && [canvas2.width, canvas2.height],
        referenceAvailable: !r.hidden,
        referenceVisible: !r.hidden && getComputedStyle(r).visibility !== 'hidden',
        referenceText: document.querySelector('#reference-status').textContent,
        leonEnabled: !document.querySelector('#player-appearance').options[1].disabled,
      };
    });
    await page.evaluate(() => { window.m8.armed = true; });
    await page.locator('#enter').click();
    await page.waitForFunction(() => window.m8.finished, null, { timeout: 60000 });
    const observed = await page.evaluate(() => window.m8);
    assert.deepEqual(errors, []);
    const probeMissing = network.some(([pathname, status]) =>
      pathname.endsWith('/__re9-reference/player_index.html') && status === 404);
    assert.deepEqual(consoleErrors.filter(error => !(probeMissing && /404 \(File not found\)/.test(error))), []);
    const result = details(observed, fixed);
    if (mode === 'both') {
      assert.ok(result.referenceFrames >= result.samples - 2, 'The reference player paused during the route');
      assert.ok(result.referenceAdvances > 0, 'The reference animation time did not advance');
    }
    return { mode, cfg, ...result, network, errors, consoleErrors, warnings };
  } finally { await context.close(); }
}
