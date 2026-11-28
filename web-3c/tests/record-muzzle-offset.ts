// Projects the wp0100 muzzle (vfx_muzzle1) against the crosshair after the standing aim used by the
// M4 video calibration (reports/web-3c/m4-video-calibration.md: reference muzzle about 9–10% W left, 4–5% H below).
// Run from web-3c: node tests/record-muzzle-offset.ts
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { PerspectiveCamera, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom, defaultFeel, testRoom } from '../src/level.ts';
import { createLeonView } from '../src/leon-view.ts';
import { createPlayerView } from '../src/player-view.ts';
import { createSimulation } from '../src/simulation.ts';
const ctx = createContext({ window: {} });
for (const f of ['model.js','motions.js','masks.js','math.js','skinning.js']) runInContext(readFileSync(new URL('../../docs/player/' + f, import.meta.url), 'utf8'), ctx);
const assets = { ...ctx.window, MotionMath: ctx.MotionMath, LeonSkinning: ctx.LeonSkinning };
const glb = readFileSync(process.env.LEON_WEAPON_GLB ?? new URL('../../docs/player/wp0100.glb', import.meta.url));
const { scene: weapon } = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
const rows = [];
const neutral = createInputBuffer().sample(0);
for (const offsetDeg of [0, -9, 9]) {
  const feel = { ...defaultFeel, movement: { ...defaultFeel.movement, holdYawOffsetRad: { ...defaultFeel.movement.holdYawOffsetRad, value: offsetDeg * Math.PI / 180 } } };
  const room = await createTestRoom(testRoom, undefined, feel);
  const leon = createLeonView(assets, weapon.clone(true));
  const player = createPlayerView(leon);
  const course = [...Array.from({ length: 140 }, () => ({ moveY: 1 })), ...Array.from({ length: 90 }, () => ({ aimHeld: true }))];
  const step = createSimulation(room.initial, room.queries, { ...room.stages, sampleInput: (t) => ({ ...neutral, ...course[t - 1], tick: t }), publish() {} });
  let s; for (const _ of course) s = step();
  player.draw(s.character.position, s.character.yawRad, room.readActionPose(), s.camera.position);
  player.root.updateMatrixWorld(true);
  const muzzle = new Vector3(); player.root.getObjectByName('vfx_muzzle1').getWorldPosition(muzzle);
  const cam = new PerspectiveCamera(s.camera.verticalFovRad * 180 / Math.PI, 16 / 9, 0.045, 45);
  cam.position.set(s.camera.position.x, s.camera.position.y, s.camera.position.z);
  cam.rotation.set(s.camera.pitchRad, s.camera.yawRad, 0, 'YXZ'); cam.updateMatrixWorld();
  const p = muzzle.clone().project(cam);
  // Muzzle in the character frame (right, up, forward from the feet), used by the two-segment shot ray.
  const d = muzzle.clone().sub(new Vector3(s.character.position.x, s.character.position.y, s.character.position.z));
  const yaw = s.character.yawRad;
  const local = { rightM: +(Math.cos(yaw) * d.x - Math.sin(yaw) * d.z).toFixed(3), upM: +d.y.toFixed(3),
    forwardM: +(-Math.sin(yaw) * d.x - Math.cos(yaw) * d.z).toFixed(3) };
  rows.push({ offsetDeg, xPercentW: +(p.x * 50).toFixed(2), yPercentH: +(p.y * 50).toFixed(2), muzzle: local });
  console.log('muzzle local', JSON.stringify(local));
  console.log('offset', offsetDeg, 'muzzle vs crosshair: x', (p.x * 50).toFixed(1) + '% W', 'y', (p.y * 50).toFixed(1) + '% H (positive = right/up)');
}
import { mkdirSync, writeFileSync } from 'node:fs';
const out = new URL('../../reports/web-3c/evidence/muzzle-offset.json', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
writeFileSync(out, JSON.stringify({ reference: { xPercentW: [-10, -9], yPercentH: [-5, -4] }, rows }, null, 2) + '\n');