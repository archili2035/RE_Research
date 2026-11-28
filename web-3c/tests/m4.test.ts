import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import feel from '../src/feel.json' with { type: 'json' };
import { castCrosshair, createCamera } from '../src/camera.ts';
import type { InputSnapshot, SceneHit, SceneQueries, Vec3 } from '../src/contracts.ts';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom, defaultFeel, testRoom } from '../src/level.ts';
import { withLegacyMovement } from '../src/preview-stages.ts';
import { createFixedLoop, createSimulation } from '../src/simulation.ts';
import type { SimulationState } from '../src/simulation.ts';

const defaults = feel.camera;
const neutral = createInputBuffer().sample(0);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

interface Segment {
  name: string;
  count: number;
  input: Partial<InputSnapshot>;
}

async function run(spawn: typeof testRoom.spawn, segments: Segment[], renderHz = 60) {
  const room = await createTestRoom({ ...testRoom, spawn }, undefined, withLegacyMovement(defaultFeel));
  const course = segments.flatMap(({ name, count, input }) => Array.from({ length: count }, () => ({ name, input })));
  const panel = room.scene.getObjectByName(testRoom.doors[0].colliderId)!;
  let anchor = room.initial.character.position;
  let desired = room.initial.camera.position;
  let hit: SceneHit | null = null;
  let recordedSweep = false;
  const queries: SceneQueries = {
    ...room.queries,
    sweepSphere(from, to, radius) {
      const result = room.queries.sweepSphere(from, to, radius);
      if (!recordedSweep) {
        anchor = from;
        desired = to;
        hit = result;
        recordedSweep = true;
      }
      return result;
    },
  };
  const samples: {
    name: string; state: SimulationState; boomM: number;
    desiredM: number; clearanceM: number; collider: string;
  }[] = [];
  const step = createSimulation(room.initial, queries, {
    ...room.stages,
    sampleInput(tick) {
      recordedSweep = false;
      return { ...neutral, ...course[tick - 1].input, tick };
    },
    publish(state) {
      const { position } = state.camera;
      const clearanceM = Math.min(...testRoom.colliders.filter(({ id }) => id !== panel.name || panel.visible)
        .map(({ center, size }) => Math.hypot(
          Math.max(0, Math.abs(position.x - center.x) - size.x / 2),
          Math.max(0, Math.abs(position.y - center.y) - size.y / 2),
          Math.max(0, Math.abs(position.z - center.z) - size.z / 2),
        )));
      assert.ok(clearanceM >= defaults.sphereRadiusM.value, `camera clearance at tick ${state.tick}: ${clearanceM}`);
      assert.equal(room.queries.sweepSphere(anchor, position, defaults.sphereRadiusM.value), null);
      samples.push({
        name: course[state.tick - 1].name, state, boomM: distance(anchor, position),
        desiredM: distance(anchor, desired), clearanceM, collider: hit?.colliderId ?? '',
      });
    },
  });
  const loop = createFixedLoop(step, () => {});
  const frames = Math.ceil(course.length * renderHz / 60);
  for (let frame = 0; frame <= frames; frame += 1) loop.frame(frame * 1000 / renderHz);
  assert.equal(samples.length, course.length);
  return { room, samples };
}

type Samples = Awaited<ReturnType<typeof run>>['samples'];
const m4Trace: Samples = [];
const at = (samples: Samples, tick: number) => samples[tick - 1];

function assertSmoothRecovery(samples: Samples, start: number, end: number, maxStepM: number) {
  let reverseTravelM = 0;
  for (let tick = start + 1; tick <= end; tick += 1) {
    const before = at(samples, tick - 1);
    const after = at(samples, tick);
    const delta = after.boomM - before.boomM;
    // Catching up with the live sweep anchor can slightly shorten a recovering boom.
    assert.ok(delta >= -0.004, `boom reversed by ${delta} m at tick ${tick}`);
    assert.ok(delta < maxStepM, `boom jumped at tick ${tick}`);
    reverseTravelM += Math.max(0, -delta);
  }
  assert.ok(reverseTravelM < 0.025, `boom repeatedly reversed for ${reverseTravelM} m`);
}

test('M4 aims beside a wall, then recovers as M3 walks away', async () => {
  const spawn = { position: { x: -3.58, y: 0.025, z: 4 }, yawRad: -Math.PI / 2 };
  const { samples } = await run(spawn, [
    { name: 'wall-move', count: 1, input: {} },
    { name: 'wall-aim', count: 44, input: { aimHeld: true } },
    { name: 'wall-depart', count: 90, input: { aimHeld: true, moveY: 1 } },
    { name: 'wall-recovered', count: 90, input: { aimHeld: true } },
  ]);
  const move = at(samples, 1);
  const raise = at(samples, 2);
  const aim = at(samples, 45);
  const recovered = at(samples, 225);
  assert.equal(move.collider, 'wall-r07-west');
  assert.equal(aim.collider, move.collider);
  assert.ok(aim.boomM < 0.2);
  assert.ok(move.state.camera.verticalFovRad - raise.state.camera.verticalFovRad > 0);
  assert.ok(raise.state.camera.verticalFovRad > aim.state.camera.verticalFovRad);
  assert.ok(Math.abs(aim.state.camera.verticalFovRad - defaults.aimVerticalFovRad.value) < 0.001);
  assert.ok(at(samples, 135).state.character.position.x > spawn.position.x + 2);
  assert.equal(recovered.state.camera.obstructed, false);
  assert.ok(Math.abs(recovered.boomM - recovered.desiredM) < 0.001);
  assertSmoothRecovery(samples, 45, 135, 0.05);
  // After stopping, the filtered framing origin catches up with the live sweep anchor.
  for (let tick = 136; tick <= 225; tick += 1) {
    const before = at(samples, tick - 1).state.camera.position;
    const after = at(samples, tick).state.camera.position;
    assert.ok(distance(before, after) < 0.03 && after.x >= before.x - 0.001);
  }
  m4Trace.push(...samples);
});

test('M4 exits aim with the optical field and unobstructed boom easing together', () => {
  const scene: SceneQueries = {
    moveCapsule: ({ displacement }) => ({ displacement, grounded: true }),
    sweepSphere: () => null,
    raycast: () => null,
  };
  const character = { ...testRoom.spawn, velocity: { x: 0, y: 0, z: 0 }, grounded: true };
  const ready = { id: 'player', phase: 'ready', aiming: false, magazine: 8, reserve: 16 } as const;
  const camera = createCamera(character, { ...ready, phase: 'aiming', aiming: true }, scene);
  const move = createCamera(character, ready, scene).initial;
  const aim = camera.initial;
  let pose = aim;
  let previousProgress = 0;
  for (let tick = 1; tick <= 24; tick++) {
    pose = camera.update({ ...neutral, tick }, character, ready, pose, scene);
    const fovProgress = (pose.verticalFovRad - aim.verticalFovRad) / (move.verticalFovRad - aim.verticalFovRad);
    const boomProgress = (pose.position.x - aim.position.x) / (move.position.x - aim.position.x);
    assert.ok(fovProgress > previousProgress && Math.abs(fovProgress - boomProgress) < 1e-8);
    assert.equal(pose.obstructed, false);
    assert.equal(pose.pitchRad, aim.pitchRad);
    previousProgress = fovProgress;
  }
  assert.ok(previousProgress > 0.95);
});

test('M4 sweeps around the L corner at 60/120 Hz and casts through the screen centre', async () => {
  const segments = [
    { name: 'corner-approach', count: 277, input: { moveY: 1 } },
    { name: 'corner-turn', count: 30, input: { lookDeltaX: -Math.PI / (2 * 30 * defaults.lookRadPerPx.value) } },
    { name: 'corner-exit', count: 64, input: { moveY: 1 } },
    { name: 'corner-target', count: 1, input: { aimHeld: true, lookDeltaX: 0.27 / 0.0022, lookDeltaY: -0.16 / 0.0022 } },
    { name: 'corner-clear', count: 12, input: { moveX: -1, moveY: 1, lookDeltaX: -0.27 / (12 * 0.0022) } },
    { name: 'corner-clear', count: 13, input: { moveY: 1 } },
  ];
  const { room, samples } = await run(testRoom.spawn, segments);
  assert.deepEqual((await run(testRoom.spawn, segments, 120)).samples, samples);
  assert.ok(samples.slice(277, 307).some(({ collider }) => collider === 'wall-c04-south'));
  assert.ok(samples.slice(277, 307).some(({ state }) => state.camera.obstructed));
  for (let tick = 278; tick <= 307; tick += 1) {
    const from = at(samples, tick - 1).state.camera.position;
    const to = at(samples, tick).state.camera.position;
    assert.ok(distance(from, to) < 0.2, `turn jumped at tick ${tick}: ${distance(from, to)} m`);
  }
  assert.ok(at(samples, 371).state.character.position.z < 2.4);
  assert.equal(at(samples, 397).state.camera.obstructed, false);

  const pose = at(samples, 372).state.camera;
  const camera = new PerspectiveCamera(pose.verticalFovRad * 180 / Math.PI, 2, 0.045, 45);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.rotation.set(pose.pitchRad, pose.yawRad, 0, 'YXZ');
  camera.updateMatrixWorld();
  const hit = castCrosshair(room.queries, pose, testRoom.targets[0].interactionRangeM);
  assert.equal(hit?.colliderId, testRoom.targets[0].colliderId);
  const { x, y } = new Vector3(hit!.point.x, hit!.point.y, hit!.point.z).project(camera);
  assert.ok(Math.hypot(x, y) < 1e-6, 'ray hit must project to the centre of the rendered viewport');
  m4Trace.push(...samples);
});

test('M4 shortens behind the closed door and eases outward while crossing the threshold', async () => {
  const spawn = { position: { x: 9.25, y: 0.025, z: 0.65 }, yawRad: Math.PI };
  const { samples } = await run(spawn, [
    { name: 'door-closed', count: 45, input: { aimHeld: true } },
    { name: 'door-opened', count: 1, input: { aimHeld: true, interactPressed: true } },
    { name: 'door-cross', count: 54, input: { aimHeld: true, moveY: -1 } },
    { name: 'door-recovered', count: 90, input: { aimHeld: true } },
  ]);
  const closed = at(samples, 45);
  const opened = at(samples, 46);
  const entered = at(samples, 100);
  const recovered = at(samples, 190);
  assert.equal(closed.collider, testRoom.doors[0].colliderId);
  assert.ok(closed.boomM < 0.4);
  assert.equal(opened.state.camera.obstructed, false);
  assert.ok(opened.boomM < opened.desiredM / 2);
  assert.ok(entered.state.character.position.z < -0.65);
  assert.ok(Math.abs(recovered.boomM - recovered.desiredM) < 0.001);
  assertSmoothRecovery(samples, 45, 190, 0.22);
  m4Trace.push(...samples);
});

test.after(() => {
  if (!process.env.M4_TRACE) return;
  const header = 'phase,tick,feet_x_m,feet_y_m,feet_z_m,camera_x_m,camera_y_m,camera_z_m,boom_m,desired_m,clearance_m,vfov_rad,obstructed,collider';
  const coords = ({ x, y, z }: Vec3) => [x, y, z];
  const rows = m4Trace.map(({ name, state, boomM, desiredM, clearanceM, collider }) => [
    name, state.tick,
    ...[...coords(state.character.position), ...coords(state.camera.position), boomM, desiredM, clearanceM, state.camera.verticalFovRad]
      .map((value) => value.toFixed(6)),
    Number(state.camera.obstructed), collider,
  ].join(','));
  writeFileSync(process.env.M4_TRACE, [header, ...rows, ''].join('\n'), 'utf8');
});