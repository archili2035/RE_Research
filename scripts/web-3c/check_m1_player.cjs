const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'runtime/web-3c-m1.tmp/re9-browser.json');

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, 'docs/player_index.html')).href);
    await page.waitForFunction(() => window.ModelView?.stats.bounds);
    await page.locator('#play').click();
    const clips = [];
    for (const { bank, id } of [
      { bank: 100, id: 160 }, { bank: 100, id: 120 }, { bank: 100, id: 140 },
      { bank: 100, id: 1100 }, { bank: 100, id: 1200 }, { bank: 100, id: 161 },
      { bank: 2100, id: 1200 },
    ]) {
      const start = performance.now();
      const result = await page.evaluate(({ bank, id }) => {
        const clip = MOTION_DATA.clips.find(clip => clip.bank === bank && clip.id === id);
        player.choose(clip);
        const timeline = document.getElementById('timeline');
        const poses = [0, 0.25, 0.5, 0.75, 1].map(fraction => {
          timeline.value = clip.duration * fraction;
          timeline.dispatchEvent(new Event('input'));
          const { stats, parts } = ModelView;
          const positions = player.pose.flatMap(bone => [...bone.p, ...bone.q, ...bone.s]);
          if (clip.additive) return { timeS: player.time, finite: positions.every(Number.isFinite) };
          const bones = new Map(clip.bones.map((bone, index) => [bone.name, player.pose[index].p]));
          const differences = parts.flatMap(part => part.bones.flatMap(bone => {
            const position = bones.get(bone.name);
            if (!position) return [];
            const e = bone.world.elements;
            return [Math.hypot(e[12] - position[0], e[13] - position[1], e[14] - position[2])];
          }));
          return {
            timeS: player.time, finite: positions.every(Number.isFinite),
            bounds: stats.bounds, parts: stats.parts, vertices: stats.vertices,
            inverseBindError: stats.bindingError, matchingBones: differences.length,
            maxJointError: Math.max(...differences),
          };
        });
        return {
          bank, id, poses, additive: clip.additive,
          modelVisible: getComputedStyle(document.getElementById('modelview')).visibility === 'visible',
        };
      }, { bank, id });
      for (const pose of result.poses) {
        assert(pose.finite);
        if (result.additive) continue;
        assert.equal(pose.parts, 6);
        assert.equal(pose.vertices, 72346);
        assert(pose.matchingBones > 0 && pose.maxJointError < 1e-5);
        assert(pose.inverseBindError < 1e-5);
        assert(pose.bounds.min.concat(pose.bounds.max).every(Number.isFinite));
        const height = pose.bounds.max[1] - pose.bounds.min[1];
        assert(height > 0 && height < 3);
      }
      assert.equal(result.modelVisible, !result.additive);
      clips.push({ ...result, elapsedMs: performance.now() - start });
    }
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const crypto = require('node:crypto');
    const paths = ['docs/player_index.html', 'docs/player/model.js', 'docs/player/motions.js', 'docs/player/model-view.js'];
    const inputs = Object.fromEntries(paths.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    fs.writeFileSync(out, JSON.stringify({ chromium: browser.version(), inputs, errors, clips }, null, 2) + '\n');
    console.log(`RE9 player: ${clips.length} clips, ${clips.reduce((sum, clip) => sum + clip.poses.length, 0)} sampled poses, no page errors`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
