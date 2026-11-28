import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import manifest from '../public/assets/clips.json' with { type: 'json' };
import { castCrosshair, interpolatePosition } from '../src/camera.ts';
import type { CameraPose, InputSnapshot, LevelDefinition, SceneHit, Vec3 } from '../src/contracts.ts';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom, defaultFeel, testRoom } from '../src/level.ts';
import { createPlayerView } from '../src/player-view.ts';
import { createRenderSampler } from '../src/render-sampler.ts';
import type { RenderSnapshot } from '../src/render-sampler.ts';
import { createFixedLoop, createSimulation } from '../src/simulation.ts';
import { cameraTuneSteps } from './camera-tune-route.mjs';

const neutral = createInputBuffer().sample(0);
const radiusM = defaultFeel.camera.sphereRadiusM.value;
const floor = { id: 'floor', center: { x: 0, y: -0.15, z: 0 }, size: { x: 40, y: 0.3, z: 40 }, yawRad: 0 };
const flat: LevelDefinition = {
  ...testRoom, spawn: { position: { x: 0, y: 0.025, z: 0 }, yawRad: 0 },
  render: [], colliders: [floor], doors: [], targets: [],
};
const axes = [['W', 0, 1], ['A', -1, 0], ['S', 0, -1], ['D', 1, 0]] as const;
const camera = new PerspectiveCamera(32, 16 / 9, 0.045, 45);
const vector = new Vector3();

function pixel(point: Vec3, pose: CameraPose) {
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.rotation.set(pose.pitchRad, pose.yawRad, 0, 'YXZ');
  camera.fov = pose.verticalFovRad * 180 / Math.PI;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  vector.copy(point).project(camera);
  return { x: (vector.x + 1) * 640, y: (1 - vector.y) * 360 };
}

function referencePoint(feet: Vec3) {
  return { ...feet, y: feet.y + 1.45 };
}

function writeEvidence(name: string, contents: string) {
  const path = process.env.M4_RENDER_EVIDENCE;
  if (!path) return;
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, name), contents, 'utf8');
}

function range(values: number[]) {
  return Math.max(...values) - Math.min(...values);
}

test('M4 samples the camera and a rigid character marker together on flat W/A/S/D courses', async () => {
  const rows = ['hz,mode,key,frame,tick,alpha,before_x_px,before_y_px,after_x_px,after_y_px,fixed_feet_y_m,fixed_vx_mps,fixed_vz_mps'];
  const summary = [];
  for (const hz of [60, 120]) for (const aimHeld of [false, true]) for (const [key, moveX, moveY] of axes) {
    const room = await createTestRoom(flat);
    let current = room.initial;
    let previous = current;
    const render = createRenderSampler({
      ...current, cameraAnchor: room.readCameraAnchor(), actionPose: room.readActionPose(),
    }, room.queries, radiusM);
    let frame = 0;
    const step = createSimulation(current, room.queries, {
      ...room.stages,
      sampleInput: (tick) => ({ ...neutral, tick, aimHeld, moveX: tick > 60 ? moveX : 0, moveY: tick > 60 ? moveY : 0 }),
      publish(state) {
        previous = current;
        current = state;
        render.commit({ ...state, cameraAnchor: room.readCameraAnchor(), actionPose: room.readActionPose() }, false);
      },
    });
    const before = [];
    const after = [];
    const mode = aimHeld ? 'aim' : 'ready';
    const loop = createFixedLoop(step, (alpha) => {
      const view = render.sample(alpha);
      if (current.tick < 180) return;
      assert.equal(view.camera.obstructed, false);
      assert.ok(Math.abs(view.tick - (current.tick - 1 + alpha)) < 1e-8);
      const oldFeet = interpolatePosition(previous.character.position, current.character.position, alpha);
      const old = pixel(referencePoint(oldFeet), current.camera);
      const now = pixel(referencePoint(view.character.position), view.camera);
      before.push({ ...old, tick: current.tick });
      after.push({ ...now, tick: current.tick });
      rows.push([hz, mode, key, frame, current.tick, alpha.toFixed(6),
        old.x.toFixed(6), old.y.toFixed(6), now.x.toFixed(6), now.y.toFixed(6),
        current.character.position.y, current.character.velocity.x, current.character.velocity.z].join(','));
    });
    for (frame = 0; frame <= hz * 6; frame++) loop.frame(frame * 1000 / hz);
    const measure = (points: typeof before) => ({
      peakToPeakX: range(points.map(({ x }) => x)), peakToPeakY: range(points.map(({ y }) => y)),
    });
    const steady = (points: typeof before) => points.filter(({ tick }) => tick >= 300);
    summary.push({ hz, mode, key, steadyTicks: [300, 360], steadySamples: steady(after).length,
      before: measure(steady(before)), after: measure(steady(after)),
      recordedTicks: [180, 360], recordedSamples: after.length, fullBefore: measure(before), fullAfter: measure(after) });
  }
  writeEvidence('rigid-reference.csv', rows.join('\n') + '\n');
  writeEvidence('rigid-summary.json', JSON.stringify(summary, null, 2) + '\n');
  for (const row of summary.filter(({ key }) => key === 'A' || key === 'D')) {
    assert.ok(row.after.peakToPeakX < 3, `${row.hz} Hz ${row.mode} ${row.key}: ${row.after.peakToPeakX} px`);
  }
});

function distanceToCollider(point: Vec3, { center, size, yawRad }: LevelDefinition['colliders'][number]) {
  const x = point.x - center.x;
  const z = point.z - center.z;
  return Math.hypot(
    Math.max(0, Math.abs(Math.cos(yawRad) * x - Math.sin(yawRad) * z) - size.x / 2),
    Math.max(0, Math.abs(point.y - center.y) - size.y / 2),
    Math.max(0, Math.abs(Math.sin(yawRad) * x + Math.cos(yawRad) * z) - size.z / 2),
  );
}

test('M4 clears the live scene and shows the exact firing frame at 60/120 Hz, including catch-up', async () => {
  const route = cameraTuneSteps.map(({ input }) => input);
  const catchUpRoute = route.map((input, index) => index === 645 ? { ...input, lookDeltaX: 12, lookDeltaY: 3 } : input);
  const cases = [
    { label: 'route-60', hz: 60, inputs: route, skip: [] },
    { label: 'route-120', hz: 120, inputs: route, skip: [] },
    { label: 'shot-catch-up', hz: 120, inputs: catchUpRoute, skip: [1290, 1291] },
    { label: 'spawn-S', hz: 120, inputs: Array.from({ length: 95 }, (_, i) => i < 75 ? { moveY: -1 } : {}), skip: [] },
    { label: 'spawn-D', hz: 120, inputs: Array.from({ length: 95 }, (_, i) => i < 75 ? { moveX: 1 } : {}), skip: [] },
  ];
  const evidence = [];
  for (const { label, hz, inputs, skip } of cases) {
    const room = await createTestRoom(testRoom, manifest);
    const door = room.scene.getObjectByName(testRoom.doors[0].colliderId)!;
    const actor = createPlayerView({ root: room.avatar });
    let current = room.initial;
    let previous = current;
    let shot: { tick: number; point: Vec3 } | undefined;
    let lastTime = -Infinity;
    let projected = 0;
    let shotFrame: { tick: number; fixedTick: number; x: number; y: number; baselineErrorPx: number } | undefined;
    let frame = 0;
    let lastOpacity: number | undefined;
    let lastOldOpacity: number | undefined;
    const snapshots = [];
    const render = createRenderSampler({
      ...current, cameraAnchor: room.readCameraAnchor(), actionPose: room.readActionPose(),
    }, room.queries, radiusM);
    const step = createSimulation(current, room.queries, {
      ...room.stages,
      sampleInput: (tick) => ({ ...neutral, ...inputs[tick - 1] as Partial<InputSnapshot>, tick }),
      publish(state, _input, events) {
        previous = current;
        current = state;
        const fired = events.some(({ type }) => type === 'weapon.fired');
        render.commit({ ...state, cameraAnchor: room.readCameraAnchor(), actionPose: room.readActionPose() }, fired);
        if (fired) {
          const hit = castCrosshair(room.queries, state.camera, testRoom.targets[0].interactionRangeM);
          assert.equal(hit?.colliderId, testRoom.targets[0].colliderId);
          assert.ok(events.some(({ type }) => type === 'target.hit'));
          shot = { tick: state.tick, point: hit!.point };
        }
      },
    });
    const loop = createFixedLoop(step, (alpha) => {
      const view = render.sample(alpha);
      assert.ok(view.tick + 1e-8 >= lastTime, `${label}: rendered time moved backwards at frame ${frame}`);
      lastTime = view.tick;
      const solids = testRoom.colliders.filter(({ id }) => door.visible || id !== door.name);
      const clearance = Math.min(...solids.map((solid) => distanceToCollider(view.camera.position, solid)));
      assert.ok(clearance >= radiusM - 0.0001, `${label} tick ${view.tick}: rendered clearance ${clearance}`);
      assert.equal(room.queries.sweepSphere(view.cameraAnchor, view.camera.position, radiusM), null);
      const oldFeet = interpolatePosition(previous.character.position, current.character.position, alpha);
      actor.draw(oldFeet, current.character.yawRad, view.actionPose, current.camera.position);
      const beforeOpacity = room.avatar.material.opacity;
      const beforeOpacityDelta = lastOldOpacity === undefined ? 0 : Math.abs(beforeOpacity - lastOldOpacity);
      lastOldOpacity = beforeOpacity;
      actor.draw(view.character.position, view.character.yawRad, view.actionPose, view.camera.position);
      const opacity = room.avatar.material.opacity;
      assert.equal(actor.root.visible, opacity > 0);
      assert.equal(room.avatar.material.transparent, opacity < 1);
      const opacityDelta = lastOpacity === undefined ? 0 : Math.abs(opacity - lastOpacity);
      lastOpacity = opacity;
      snapshots.push({ frame, fixedTick: current.tick, renderTick: view.tick, clearance,
        beforeOpacity, beforeOpacityDelta, opacity, opacityDelta });
      if (shot && !projected) {
        assert.equal(view.tick, shot.tick);
        const point = pixel(shot.point, view.camera);
        const baseline = pixel(shot.point, current.camera);
        assert.ok(Math.hypot(point.x - 640, point.y - 360) < 0.001);
        shotFrame = { tick: view.tick, fixedTick: current.tick, ...point, baselineErrorPx: Math.hypot(baseline.x - 640, baseline.y - 360) };
        projected++;
      }
    });
    for (frame = 0; frame <= Math.ceil(inputs.length * hz / 60); frame++) {
      if (!skip.includes(frame)) loop.frame(frame * 1000 / hz);
    }
    if (label.startsWith('spawn-')) {
      assert.ok(snapshots.some(({ opacity }) => opacity === 0));
      assert.ok(snapshots.some(({ opacity }) => opacity > 0 && opacity < 1));
      assert.ok(Math.max(...snapshots.map(({ opacityDelta }) => opacityDelta)) < 0.04);
      assert.equal(projected, 0);
    } else {
      assert.equal(projected, 1);
      assert.equal(shotFrame?.fixedTick, skip.length ? 646 : 645);
      if (skip.length) assert.ok(shotFrame!.baselineErrorPx > 10);
      assert.ok(snapshots.some(({ opacity }) => opacity === 0));
      assert.ok(snapshots.some(({ opacity }) => opacity === 1));
    }
    evidence.push({ label, shotFrame, lowestClearanceM: Math.min(...snapshots.map(({ clearance }) => clearance)),
      beforeMaxOpacityDelta: Math.max(...snapshots.map(({ beforeOpacityDelta }) => beforeOpacityDelta)),
      maxOpacityDelta: Math.max(...snapshots.map(({ opacityDelta }) => opacityDelta)), snapshots });
  }
  writeEvidence('near-wall-and-shot.json', JSON.stringify(evidence, null, 2) + '\n');
});

test('M4 falls back to a swept pair on a blocked interpolation and does not rewind', async () => {
  const room = await createTestRoom(flat);
  const initial: RenderSnapshot = { ...room.initial, cameraAnchor: room.readCameraAnchor(), actionPose: room.readActionPose() };
  const hit: SceneHit = { colliderId: 'wall', distanceM: 1, point: initial.camera.position, normal: { x: 0, y: 0, z: 1 } };
  const shifted = (tick: number): RenderSnapshot => ({
    ...initial, tick, character: { ...initial.character, position: { ...initial.character.position, x: tick } },
    camera: { ...initial.camera, position: { ...initial.camera.position, x: tick + 0.46 } },
  });
  const render = createRenderSampler(initial, {
    sweepSphere: (_from, to) => to.x > 1.7 && to.x < 2 ? hit : null,
  }, radiusM);
  for (let tick = 1; tick <= 3; tick++) {
    const state = shifted(tick);
    render.commit(state, false);
    const view = render.sample(0.5);
    if (tick === 2) {
      assert.strictEqual(view, state);
      assert.strictEqual(render.sample(0.8), state);
    } else assert.equal(view.tick, tick - 0.5);
  }

  const catchUp = createRenderSampler(initial, {
    sweepSphere: (_from, to) => to.x < 2 ? hit : null,
  }, radiusM);
  const latest = shifted(2);
  catchUp.commit(shifted(1), true);
  catchUp.commit(latest, false);
  assert.strictEqual(catchUp.sample(0), latest);
});
