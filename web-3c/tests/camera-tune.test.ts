import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import manifest from '../public/assets/clips.json' with { type: 'json' };
import { castCrosshair, createCamera } from '../src/camera.ts';
import type { SceneQueries, Vec3 } from '../src/contracts.ts';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom, defaultFeel, testRoom } from '../src/level.ts';
import { withLegacyMovement } from './legacy-fixtures.ts';
import { createSimulation } from '../src/simulation.ts';
import { cameraTuneSteps } from './camera-tune-route.mjs';

const neutral = createInputBuffer().sample(0);
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('a height change is damped while mouse angles update on the input tick', () => {
  const scene: SceneQueries = {
    moveCapsule: ({ displacement }) => ({ displacement, grounded: true }),
    raycast: () => null,
    sweepSphere: () => null,
  };
  const spawn = {
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yawRad: 0, grounded: true,
  };
  const action = { id: 'player', aiming: false, phase: 'ready', magazine: 8, reserve: 16 } as const;
  const rig = createCamera(spawn, action, scene);
  const raised = { ...spawn, position: { ...spawn.position, y: 0.04 } };
  let pose = rig.update({ ...neutral, tick: 1 }, raised, action, rig.initial, scene);
  assert.ok(pose.position.y - rig.initial.position.y > 0);
  assert.ok(pose.position.y - rig.initial.position.y < 0.008);
  for (let tick = 2; tick <= 60; tick++) {
    const next = rig.update({ ...neutral, tick }, raised, action, pose, scene);
    assert.ok(next.position.y >= pose.position.y);
    pose = next;
  }
  assert.ok(Math.abs(pose.position.y - rig.initial.position.y - 0.04) < 0.001);
  const turn = rig.update({ ...neutral, tick: 61, lookDeltaX: 20, lookDeltaY: -10 }, raised, action, pose, scene);
  const look = defaultFeel.camera.lookRadPerPx.value;
  assert.ok(Math.abs(turn.yawRad + 20 * look) < 1e-10);
  assert.ok(Math.abs(turn.pitchRad - pose.pitchRad - 10 * look) < 1e-10);
});

test('camera tune route stays clear and the shot after the doorway projects to the crosshair', async () => {
  const room = await createTestRoom(testRoom, manifest, withLegacyMovement(defaultFeel));
  const door = room.scene.getObjectByName(testRoom.doors[0].colliderId)!;
  const samples = [];
  const radius = defaultFeel.camera.sphereRadiusM.value;
  let previousCamera = room.initial.camera;
  let basePitch = previousCamera.pitchRad;
  let shots = 0;
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages,
    sampleInput: (tick) => ({ ...neutral, ...cameraTuneSteps[tick - 1].input, tick }),
    publish(state, input, events) {
      room.syncView(state.tick);
      const { tick, camera, character } = state;
      const { position, yawRad, pitchRad } = camera;
      const sensitivity = defaultFeel.camera.lookRadPerPx.value;
      const expectedYaw = previousCamera.yawRad - input.lookDeltaX * sensitivity;
      assert.ok(Math.abs(Math.sin((yawRad - expectedYaw) / 2)) < 1e-10, `yaw lag at tick ${tick}`);
      // Mouse pitch is applied without lag. After a shot the weapon kick adds a temporary, bounded offset.
      basePitch -= input.lookDeltaY * sensitivity;
      const kick = pitchRad - basePitch;
      assert.ok(kick > -1e-10 && kick < (shots ? defaultFeel.camera.recoilPitchRad.value : 0) + 1e-10,
        `pitch lag at tick ${tick}: ${kick}`);
      const clearanceM = Math.min(...testRoom.colliders.filter(({ id }) => door.visible || id !== door.name)
        .map(({ center, size }) => Math.hypot(
          Math.max(0, Math.abs(position.x - center.x) - size.x / 2),
          Math.max(0, Math.abs(position.y - center.y) - size.y / 2),
          Math.max(0, Math.abs(position.z - center.z) - size.z / 2),
        )));
      assert.ok(clearanceM >= radius - 0.0001, `camera sphere intersects a collider at tick ${tick}: ${clearanceM}`);
      let shotPoint: Vec3 | undefined;
      if (events.some(({ type }) => type === 'weapon.fired')) {
        shots++;
        assert.ok(character.position.z < -0.7 && !door.visible);
        assert.equal(input.lookDeltaX, 1);
        assert.equal(input.lookDeltaY, -1);
        const hit = castCrosshair(room.queries, camera, testRoom.targets[0].interactionRangeM);
        assert.equal(hit?.colliderId, testRoom.targets[0].colliderId);
        assert.equal(events.find(({ type }) => type === 'target.hit')?.subjectId, testRoom.targets[0].id);
        shotPoint = hit!.point;
        const view = new PerspectiveCamera(camera.verticalFovRad * 180 / Math.PI, 16 / 9, 0.045, 45);
        view.position.set(position.x, position.y, position.z);
        view.rotation.set(pitchRad, yawRad, 0, 'YXZ');
        view.updateMatrixWorld();
        const { x, y } = new Vector3(shotPoint.x, shotPoint.y, shotPoint.z).project(view);
        assert.ok(Math.hypot(x, y) < 1e-6);
      }
      samples.push({
        tick, phase: cameraTuneSteps[tick - 1].phase, feet: character.position, camera,
        clearanceM, stepM: distance(previousCamera.position, position), shotPoint,
      });
      previousCamera = camera;
    },
  });
  for (let tick = 1; tick <= cameraTuneSteps.length; tick++) step();
  assert.equal(shots, 1);
  const straight = samples.filter(({ phase }) => phase === '直走').at(-1)!;
  const brake = samples.filter(({ phase }) => phase === '急停');
  assert.ok(brake[0].stepM / straight.stepM > 0.6 && brake[0].stepM < straight.stepM);
  assert.ok(brake.at(-1)!.stepM < 0.001);
  const turn = samples.filter(({ phase }) => phase === '擦墙转 L 角');
  assert.ok(turn.some(({ camera }) => camera.obstructed));
  assert.ok(Math.max(...turn.map(({ stepM }) => stepM)) <= 0.145);
  if (process.env.CAMERA_TUNE_TRACE) writeFileSync(process.env.CAMERA_TUNE_TRACE, JSON.stringify(samples, null, 2) + '\n');
});