import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { Quaternion } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from '../public/assets/clips.json' with { type: 'json' };
import routeJson from '../fixtures/route.replay.json' with { type: 'json' };
import cameraSource from '../src/camera-source.json' with { type: 'json' };
import { reDamping } from '../src/camera.ts';
import type { FeelConfig, InputSnapshot, LevelDefinition, ReplayTrace } from '../src/contracts.ts';
import { createInputBuffer, MAX_LOOK_EVENT_PX } from '../src/input.ts';
import { createTestRoom, defaultFeel, testRoom } from '../src/level.ts';
import { LEON_START_TRAVEL_M, raiseWeights, startLeg } from '../src/leon-locomotion.ts';
import { createLeonView } from '../src/leon-view.ts';
import type { LeonAssets } from '../src/leon-view.ts';
import { createRoutePlayback } from '../src/m7-replay.ts';
import { createSimulation } from '../src/simulation.ts';
import type { SimulationState } from '../src/simulation.ts';

const neutral = createInputBuffer().sample(0);
const floor = { id: 'floor', size: { x: 40, y: 0.2, z: 40 }, position: { x: 0, y: -0.1, z: 0 } };
const flat: LevelDefinition = {
  id: 'v6-flat', version: 1, spawn: { position: { x: 0, y: 0.025, z: 0 }, yawRad: 0 },
  render: [{ ...floor, kind: 'box', yawRad: 0 }], colliders: [{ id: 'floor', center: floor.position, size: floor.size, yawRad: 0 }],
  doors: [], targets: [],
};
const withMovement = (patch: Partial<Record<string, number>>): FeelConfig => ({
  ...defaultFeel,
  movement: { ...defaultFeel.movement, ...Object.fromEntries(Object.entries(patch).map(([key, value]) =>
    [key, { value: value!, source: 'test', evidence: 'tuned' as const, conditions: 'test' }])) },
});
const withCamera = (patch: Partial<Record<string, number>>): FeelConfig => ({
  ...defaultFeel,
  camera: { ...defaultFeel.camera, ...Object.fromEntries(Object.entries(patch).map(([key, value]) =>
    [key, { value: value!, source: 'test', evidence: 'tuned' as const, conditions: 'test' }])) },
});

async function drive(level: LevelDefinition, course: Partial<InputSnapshot>[], feel = defaultFeel) {
  const room = await createTestRoom(level, manifest, feel);
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages, sampleInput: (tick) => ({ ...neutral, ...course[tick - 1], tick }), publish() {},
  });
  return { room, run: course.map(() => ({ state: step(), pose: room.readActionPose() })) };
}

test('movement ramps the intended speed with accelS/decelS and the stop predicts the remaining travel', async () => {
  const course = [...Array.from({ length: 60 }, () => ({ moveY: 1 })), ...Array.from({ length: 40 }, () => ({}))];
  const { run } = await drive(flat, course);
  const speed = (i: number) => Math.hypot(run[i].state.character.velocity.x, run[i].state.character.velocity.z);
  const walk = defaultFeel.movement.walkSpeedMps.value;
  const ramp = Math.ceil(defaultFeel.movement.accelS.value * 60);
  assert.ok(speed(0) > 0 && speed(0) < walk / 4);
  assert.ok(Math.abs(speed(ramp) - walk) < 0.02, `reaches walk speed after ${ramp} steps`);
  assert.ok(speed(61) > 0.5 && speed(61) < walk, 'decelerates instead of stopping');
  assert.ok(speed(60 + ramp + 1) < 1e-3);
  const stop = run[60].pose.walk.transition;
  assert.equal(stop?.kind, 'stop');
  assert.ok(Math.abs(stop!.remainM - walk * defaultFeel.movement.decelS.value / 2) < 0.02);
  const start = run[0].pose.walk.transition;
  assert.equal(start?.kind, 'start');
  assert.equal(start!.dir, 0);
  assert.equal(start!.leg, startLeg(0));
  const lastStart = run.findLastIndex(({ pose }) => pose.walk.transition?.kind === 'start');
  assert.ok(run[lastStart].pose.walk.transition!.distanceM < LEON_START_TRAVEL_M[start!.leg][0]);
});

test('walkFacesCamera keeps the heading on the camera, starts by local direction and turns in place past 60°', async () => {
  const feel = withMovement({ walkFacesCamera: 1 });
  const course: Partial<InputSnapshot>[] = [
    ...Array.from({ length: 40 }, () => ({ moveX: 1 })),        // strafe right: heading stays on the camera
    ...Array.from({ length: 40 }, () => ({})),
    { lookDeltaX: (Math.PI / 2) / defaultFeel.camera.lookRadPerPx.value }, // camera swings 90° right
    ...Array.from({ length: 120 }, () => ({})),
  ];
  const { run } = await drive(flat, course, feel);
  assert.ok(Math.abs(run[39].state.character.yawRad) < 1e-6, 'faces the camera while strafing');
  assert.equal(run[0].pose.walk.transition?.dir, 3, 'right-strafe start');
  const turn = run[81].pose.walk.turn ?? run[82].pose.walk.turn;
  assert.ok(turn, 'in-place turn starts');
  assert.equal(turn!.clip, 315, 'R90');
  assert.ok(Math.abs(run[200].state.character.yawRad + Math.PI / 2) < 0.03, 'finishes the turn');
});

test('stopped stance feet settle to full support', async () => {
  // Instant stops (no deceleration) land at every point of the contact window; any foot kept planted must settle.
  const { accelS: _a, decelS: _d, ...instant } = defaultFeel.movement;
  void _a; void _d;
  let planted = 0;
  for (let walking = 40; walking <= 60; walking += 1) {
    const course = [...Array.from({ length: 40 }, () => ({ aimHeld: true })),
      ...Array.from({ length: walking }, () => ({ aimHeld: true, moveY: 1 })), ...Array.from({ length: 30 }, () => ({ aimHeld: true }))];
    const { run } = await drive(flat, course, { ...defaultFeel, movement: instant });
    const plants = run.at(-1)!.pose.walk.plants.filter(Boolean);
    planted += plants.length;
    assert.ok(plants.every((plant) => plant!.weight > 0.99), `${walking}: ${JSON.stringify(plants.map((p) => p!.weight))}`);
  }
  assert.ok(planted > 0);
});

test('raise clips blend by the heading change and the shot needs a clear muzzle line', async () => {
  assert.deepEqual(raiseWeights(0), [0, 0, 1, 0, 0]);
  assert.deepEqual(raiseWeights(Math.PI / 2), [0, 0, 0, 1, 0]);
  assert.deepEqual(raiseWeights(-Math.PI).map((w) => +w.toFixed(6)), [1, 0, 0, 0, 0]);
  assert.deepEqual(raiseWeights(Math.PI / 4).map((w) => +w.toFixed(6)), [0, 0, 0.5, 0.5, 0]);
  // A post between muzzle and target blocks the bullet even when the camera sees the target past it.
  const post = { id: 'post', center: { x: 0.19, y: 1.45, z: -1.2 }, size: { x: 0.06, y: 0.4, z: 0.1 }, yawRad: 0 };
  const face = { id: 'face', center: { x: 0, y: 1.45, z: -6 }, size: { x: 2, y: 2, z: 0.1 }, yawRad: 0 };
  const level: LevelDefinition = { ...flat, id: 'v6-shot', colliders: [...flat.colliders, post, face],
    render: [...flat.render, ...[post, face].map(({ id, center, size }) => ({ id, kind: 'box' as const, position: center, size, yawRad: 0 }))],
    targets: [{ id: 'target', colliderId: 'face', interactionRangeM: 14 }] };
  const room = await createTestRoom(level, manifest, withMovement({ holdYawOffsetRad: 0 }));
  const state = { ...room.initial, character: { ...room.initial.character, yawRad: 0 } } as SimulationState;
  const hit = room.resolveShot({ ...state, camera: { ...state.camera, position: { x: 0.5, y: 1.6, z: 1.5 }, yawRad: 0, pitchRad: 0 } });
  assert.equal(hit?.colliderId, 'post');
});

test('doors open only from the lowered stance and big pointer-lock jumps are dropped', async () => {
  const buffer = createInputBuffer();
  buffer.look(MAX_LOOK_EVENT_PX + 1, 0);
  buffer.look(10, -4);
  const sample = buffer.sample(1);
  assert.deepEqual([sample.lookDeltaX, sample.lookDeltaY], [10, -4]);
  const spawn = { position: { x: 9.25, y: 0.025, z: 0.65 }, yawRad: Math.PI };
  const course = [...Array.from({ length: 40 }, () => ({ aimHeld: true })), { aimHeld: true, interactPressed: true },
    ...Array.from({ length: 30 }, () => ({})), { interactPressed: true }];
  const room = await createTestRoom({ ...testRoom, spawn }, manifest);
  const events: string[] = [];
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages, sampleInput: (tick) => ({ ...neutral, ...course[tick - 1], tick }),
    publish(_state, _input, batch) { events.push(...batch.filter(({ type }) => type === 'door.changed').map(({ tick }) => String(tick))); },
  });
  course.forEach(() => step());
  assert.deepEqual(events, [String(course.length)]);
});

test('seek restores keyframes and matches a linear replay at the same tick', async () => {
  const route = routeJson as ReplayTrace;
  const linearRoom = await createTestRoom(testRoom, manifest);
  const linear = createRoutePlayback(route, linearRoom, defaultFeel, () => {});
  const targetTick = 523;
  while (linear.state.tick < targetTick) linear.step();
  const seekRoom = await createTestRoom(testRoom, manifest);
  const seeking = createRoutePlayback(route, seekRoom, defaultFeel, () => {});
  while (!seeking.done) seeking.step();
  const sought = seeking.seek(targetTick);
  assert.deepEqual(sought, linear.state);
  assert.deepEqual(seekRoom.readActionPose(), linearRoom.readActionPose());
  assert.deepEqual(seeking.trace().events, linear.trace().events);
  seeking.seek(route.inputs.length);
  assert.equal(seeking.trace().events.length, route.events.length);
});

test('source camera profile keeps clearance, times the Hold curve and widens the field when pushed in', async () => {
  assert.ok(Math.abs(reDamping([0.1, 0.9]) - (1 - Math.pow(0.1, (1 / 60) / 0.1))) < 1e-12);
  const feel = withCamera({ cameraProfile: 1 });
  const course: Partial<InputSnapshot>[] = [
    ...Array.from({ length: 392 }, () => ({ moveY: 1 })), ...Array.from({ length: 30 }, () => ({})),
    ...Array.from({ length: 30 }, () => ({ lookDeltaX: -Math.PI / (2 * 30 * defaultFeel.camera.lookRadPerPx.value) })),
    ...Array.from({ length: 60 }, () => ({ aimHeld: true })),
  ];
  const { room, run } = await drive(testRoom, course, feel);
  const radius = cameraSource.normal.collision.radiusM;
  for (const { state } of run) {
    const p = state.camera.position;
    const clearance = Math.min(...testRoom.colliders.map(({ center, size }) => Math.hypot(
      Math.max(0, Math.abs(p.x - center.x) - size.x / 2), Math.max(0, Math.abs(p.y - center.y) - size.y / 2),
      Math.max(0, Math.abs(p.z - center.z) - size.z / 2))));
    assert.ok(clearance >= radius - 1e-3, `clearance ${clearance} at ${state.tick}`);
    assert.ok(Number.isFinite(state.camera.verticalFovRad) && state.camera.nearClipM! > 0);
  }
  const horizontal = 2 * Math.atan(Math.tan(63 * Math.PI / 360) / (16 / 9));
  const open = await drive(flat, Array.from({ length: 30 }, () => ({})), feel);
  const clear = open.run.at(-1)!;
  assert.equal(clear.state.camera.obstructed, false);
  assert.ok(Math.abs(clear.state.camera.verticalFovRad - horizontal) < 1e-6, 'FOV 63 read as horizontal at 16:9');
  assert.ok(Math.abs(clear.state.camera.nearClipM! - cameraSource.normal.fov.nearClipM) < 1e-6);
  // Hold input: 0.5 s timed curve, so 30 steps reach the Hold distance.
  const aimed = await drive(flat, Array.from({ length: 40 }, () => ({ aimHeld: true })), feel);
  const half = aimed.run[14].state.camera.position;
  const end = aimed.run[39].state.camera.position;
  const start = clear.state.camera.position;
  assert.ok(Math.hypot(half.x - start.x, half.z - start.z) > 0.05 && Math.hypot(end.x - start.x, end.z - start.z) > Math.hypot(half.x - start.x, half.z - start.z));
  const pushed = run.filter(({ state }) => state.camera.obstructed).map(({ state }) => state.camera.verticalFovRad);
  assert.ok(pushed.length && Math.max(...pushed) > horizontal + 0.01, 'avoid FOV widens the field');
  void room;
});

const extraMotions = new URL('../../docs/player/motions-extra.js', import.meta.url);
test('v6 Leon layers: starts, stops, angled raise, 161, reload torso add and weapon clips', { skip: !existsSync(extraMotions) }, async () => {
  const context = createContext({ window: {} }) as unknown as Record<string, unknown> & { window: Record<string, unknown> };
  for (const file of ['model.js', 'motions.js', 'masks.js', 'math.js', 'skinning.js', 'motions-extra.js']) {
    runInContext(readFileSync(new URL(`../../docs/player/${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  const assets = { ...context.window, MotionMath: context.MotionMath, LeonSkinning: context.LeonSkinning } as unknown as LeonAssets;
  const glb = readFileSync(new URL('../../docs/player/wp0100.glb', import.meta.url));
  const { scene: weapon } = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  const leon = createLeonView(assets, weapon);
  const plain = createLeonView(assets, undefined, { sourceLayers: false });
  const course: Partial<InputSnapshot>[] = [
    ...Array.from({ length: 50 }, () => ({ moveY: 1 })), ...Array.from({ length: 60 }, () => ({})),
    { aimHeld: true, lookDeltaX: (Math.PI / 2) / defaultFeel.camera.lookRadPerPx.value }, ...Array.from({ length: 40 }, () => ({ aimHeld: true })),
    { aimHeld: true, firePressed: true }, ...Array.from({ length: 24 }, () => ({ aimHeld: true })),
    { aimHeld: true, reloadPressed: true }, ...Array.from({ length: 40 }, () => ({ aimHeld: true })),
    ...Array.from({ length: 50 }, () => ({ aimHeld: true })), ...Array.from({ length: 30 }, () => ({})),
  ];
  const { run } = await drive(flat, course);
  const hip = (view: typeof leon) => new Quaternion().setFromRotationMatrix(view.readJoint('Hip')!).normalize();
  const spine = (view: typeof leon) => new Quaternion().setFromRotationMatrix(view.readJoint('Spine_2')!).normalize();
  const differs = (index: number, joint = hip) => { leon.draw(run[index].pose); plain.draw(run[index].pose); return joint(leon).angleTo(joint(plain)); };
  const startIndex = run.findIndex(({ pose }) => pose.walk.transition?.kind === 'start' && pose.walk.transition.elapsedS > 0.2);
  const stopIndex = run.findIndex(({ pose }) => pose.walk.transition?.kind === 'stop' && pose.walk.transition.elapsedS > 0.4);
  assert.ok(startIndex >= 0 && differs(startIndex) > 1e-3, 'start clip changes the hips');
  assert.ok(stopIndex >= 0 && differs(stopIndex) > 1e-3, 'stop clip changes the hips');
  const raising = run.findIndex(({ pose }) => pose.clip === 'raise' && Math.abs(pose.raiseTurnRad) > 1);
  assert.ok(raising >= 0, 'raise records the heading change');
  const reloading = run.findIndex(({ pose }) => pose.clip === 'reload' && pose.progress > 0.3);
  assert.ok(differs(reloading, spine) > 1e-4, 'reload torso additive');
  const lowering = run.findIndex(({ pose }) => pose.lowerS > 0.2);
  assert.ok(lowering >= 0 && differs(lowering, spine) > 1e-3, '161 Hold_End');
  // Weapon slide moves during the shot.
  const firing = run.findIndex(({ pose }) => pose.clip === 'fire' && pose.progress > 0.1);
  leon.draw(run[firing - 6].pose);
  const slide = weapon.getObjectByName('Slide')!;
  const rest = slide.position.clone();
  leon.draw(run[firing].pose);
  assert.ok(slide.position.distanceTo(rest) > 1e-4, 'wp0100 slide animates');
});