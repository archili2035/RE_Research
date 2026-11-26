import assert from 'node:assert/strict';

export async function checkDirections(browser, url, { fromHome = false, aimed = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const homeFavicon = new URL('/favicon.ico', url).href;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const missingHomeFavicon = fromHome && message.location().url === homeFavicon && message.text().includes('404');
    if (message.type() === 'error' && !missingHomeFavicon) errors.push(message.text());
  });
  try {
    // Hook the reference frame before the default Leon appearance creates its first skin.
    await page.addInitScript(() => {
      if (window === window.top) {
        window.leonToeFrames = [];
        return;
      }
      Object.defineProperty(window, 'LeonSkinning', {
        configurable: true,
        set(skinning) {
          const create = skinning.create;
          skinning.create = (...args) => {
            const skin = create(...args);
            const toes = ['L_Leg_Toes', 'R_Leg_Toes'].map((name) => skin.parts.flatMap(({ bones }) => bones)
              .find((bone) => bone.name === name));
            const update = skin.update;
            skin.update = (...pose) => {
              update(...pose);
              window.parent.leonToeFrames.push(toes.map(({ world }) => world.elements.slice(12, 15)));
            };
            return skin;
          };
          Object.defineProperty(window, 'LeonSkinning', { configurable: true, writable: true, value: skinning });
        },
      });
    });
    await page.goto(url);
    if (fromHome) await page.getByRole('link', { name: /打开 3C 灰盒试玩/ }).click();
    await page.waitForFunction(() => !document.querySelector('#enter').disabled &&
      !document.querySelector('#player-appearance [value=leon]').disabled);
    const entry = page.url();
    const buildId = await page.locator('[data-build-id]').textContent({ timeout: 3000 });
    await page.locator('#player-appearance').selectOption('leon');
    await page.locator('#enter').click();
    await page.waitForFunction(() => document.pointerLockElement?.id === 'viewport');
    const waitPhase = (phase) => page.waitForFunction((phase) =>
      document.querySelector('#snapshot').value.includes(`动作 ${phase}`), phase);
    if (aimed) await page.mouse.down({ button: 'right' });
    await waitPhase(aimed ? 'aiming' : 'ready');

    const read = () => page.locator('#snapshot').evaluate((element) => {
      const value = element.value;
      const [, x, , z] = value.match(/坐标 (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)/);
      const [, cycles, blend] = value.match(/步态 ([\d.]+) 周期  权重 ([\d.]+)/);
      return { x: Number(x), z: Number(z), cycles: Number(cycles), blend: Number(blend), aiming: value.includes('瞄准 是') };
    });
    const drive = async (label, keys, x, z, release = true) => {
      const before = await read();
      const offset = await page.evaluate(() => window.leonToeFrames.length);
      for (const key of keys) await page.keyboard.down(`Key${key}`);
      await page.waitForFunction(({ before, x, z }) => {
        const [, currentX, , currentZ] = document.querySelector('#snapshot').value.match(/坐标 (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)/);
        return (!x || (Number(currentX) - before.x) * Math.sign(x) >= Math.abs(x)) &&
          (!z || (Number(currentZ) - before.z) * Math.sign(z) >= Math.abs(z));
      }, { before, x, z });
      const after = await read();
      if (release) for (const key of keys) await page.keyboard.up(`Key${key}`);
      const frames = await page.evaluate((offset) => window.leonToeFrames.slice(offset), offset);
      assert.equal(before.aiming, aimed);
      assert.equal(after.aiming, aimed);
      assert.ok(after.cycles > before.cycles, `${label} advances the gait phase`);
      assert.ok(frames.length >= 2, `${label} drew multiple poses`);
      const toeTravelM = Math.max(...frames.slice(1).flatMap((frame) => frame.map((toe, side) =>
        Math.hypot(...toe.map((value, axis) => value - frames[0][side][axis])))));
      assert.ok(toeTravelM > 0.02, `${label} animates the actual legs: ${toeTravelM} m`);
      return { label, before, after, toeTravelM };
    };

    const passes = [
      await drive('W', ['W'], 0.20, 0), await drive('A', ['A'], 0, -0.23),
      await drive('S', ['S'], -0.20, 0), await drive('D', ['D'], 0, 0.23),
      await drive('W+D', ['W', 'D'], 0.15, 0.15), await drive('S+A', ['S', 'A'], -0.15, -0.15),
      await drive('reverse-A', ['A'], 0, -0.22, false),
    ];
    await page.keyboard.down('KeyD');
    await page.keyboard.up('KeyA');
    passes.push(await drive('reverse-D', ['D'], 0, 0.21, false));
    await page.waitForFunction(() => document.querySelector('#collision').value.includes('wall-r07-south') &&
      document.querySelector('#snapshot').value.includes('权重 0.000'));
    const blocked = await read();
    const tick = await page.locator('#snapshot').evaluate((element) => Number(element.value.match(/步号 (\d+)/)[1]));
    await page.waitForFunction((tick) => Number(document.querySelector('#snapshot').value.match(/步号 (\d+)/)[1]) >= tick + 12, tick);
    const later = await read();
    assert.equal(later.cycles, blocked.cycles);
    assert.equal(later.blend, 0);
    assert.ok(Math.hypot(later.x - blocked.x, later.z - blocked.z) <= 0.02);
    await page.keyboard.up('KeyD');
    const transitions = [];
    if (aimed) {
      await page.mouse.up({ button: 'right' });
    } else {
      await drive('leave-wall', ['A'], 0, -0.23, false);
      const before = await read();
      await page.mouse.down({ button: 'right' });
      await waitPhase('aiming');
      const raised = await read();
      await page.mouse.up({ button: 'right' });
      await waitPhase('ready');
      const lowered = await read();
      await page.keyboard.up('KeyA');
      assert.ok(raised.aiming && !lowered.aiming);
      for (const [from, to] of [[before, raised], [raised, lowered]]) {
        assert.ok(to.z < from.z - 0.35 && to.cycles > from.cycles && to.blend > 0.99);
      }
      transitions.push(before, raised, lowered);
    }
    assert.deepEqual(errors, []);
    return { entry, buildId, aimed, passes, blocked, later, transitions, errors };
  } finally {
    await page.close();
  }
}
