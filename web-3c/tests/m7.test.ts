import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mesh, MeshStandardMaterial } from 'three';
import routeJson from '../fixtures/route.replay.json' with { type: 'json' };
import manifest from '../public/assets/clips.json' with { type: 'json' };
import type { FeelConfig, ReplayTrace } from '../src/contracts.ts';
import { createTestRoom, defaultFeel as feel, testRoom } from '../src/level.ts';
import { createRoutePlayback, matchesReferenceEvents } from '../src/m7-replay.ts';
import { createFixedLoop } from '../src/simulation.ts';
import { routeTick } from './test-room-route.mjs';
import type { SimulationState } from '../src/simulation.ts';

const route = routeJson as ReplayTrace;
const door = testRoom.doors[0];
const ammo = ({ action }: SimulationState) => [action.magazine, action.reserve];
const T = routeTick;
const last = route.inputs.length;

async function setup(config = feel) {
  const room = await createTestRoom(testRoom, manifest);
  const panel = room.scene.getObjectByName(door.colliderId)!;
  const target = room.scene.getObjectByName(testRoom.targets[0].colliderId);
  assert.ok(target instanceof Mesh && target.material instanceof MeshStandardMaterial);
  const targetMaterial = target.material;
  const samples: {
    state: SimulationState;
    pose: ReturnType<typeof room.readActionPose>;
    contacts: string[];
    doorClosed: boolean;
    flash: number;
  }[] = [];
  const playback = createRoutePlayback(route, room, config, (state) => {
    samples.push({
      state, pose: room.readActionPose(),
      contacts: room.readMovementDebug()!.contacts.map(({ colliderId }) => colliderId),
      doorClosed: panel.visible, flash: targetMaterial.emissiveIntensity,
    });
  });
  const loop = createFixedLoop(() => playback.step(), () => {});

  return {
    room, panel, targetMaterial, playback,
    run(renderHz: number) {
      loop.resetClock();
      const frameCount = Math.ceil((route.inputs.length - playback.state.tick) * route.stepS * renderHz);
      for (let frame = 0; frame <= frameCount; frame += 1) loop.frame(frame * 1000 / renderHz);
      assert.ok(playback.done);
      assert.equal(samples.length, last);
      playback.step();
      assert.equal(samples.length, last, 'stepping after completion must not publish');
      return { samples: [...samples], trace: playback.trace() };
    },
    reset() {
      playback.reset();
      samples.length = 0;
    },
  };
}

test('M7 publishes the test-room baseline at 60 and 120 Hz', async () => {
  assert.deepEqual(route.level, { id: 'test-room', version: 1 });
  assert.equal(route.feelVersion, feel.version);
  const a = (await setup()).run(60);
  const b = (await setup()).run(120);
  assert.deepEqual(a, b);
  assert.deepEqual(a.trace, route);
  assert.ok(matchesReferenceEvents(a.trace, route));
  assert.equal(a.trace.events.length, 31);
  const at = (tick: number) => a.samples[tick - 1];
  const cornerVelocity = at(T.turn).state.character.velocity;
  assert.ok(Math.hypot(cornerVelocity.x, cornerVelocity.z) < 0.002);
  assert.equal(at(T['fire-start']).state.camera.obstructed, false);
  assert.deepEqual(a.trace.events.filter(({ tick }) => tick === T.shot).map(({ order, type, subjectId }) =>
    [order, type, subjectId]), [
    [0, 'weapon.fired', 'preview-player'],
    [1, 'ammo.committed', 'preview-player'],
    [2, 'target.hit', 'target-practice'],
  ]);
  assert.deepEqual(a.trace.events.flatMap((event) => event.type === 'ammo.committed'
    ? [[event.tick, event.order, event.magazine, event.reserve]] : []), [[T.shot, 1, 7, 16], [T['reload-commit'], 0, 8, 15]]);
  assert.deepEqual(ammo(at(T.shot - 1).state), [8, 16]);
  assert.deepEqual(ammo(at(T['reload-commit'] - 1).state), [7, 16]);
  assert.equal(at(T.shot).flash, 1);
  assert.equal(at(T.shot + 24).flash, 0);
  assert.deepEqual(a.trace.events.flatMap((event) => event.type === 'door.changed'
    ? [[event.tick, event.order, event.subjectId, event.open]] : []), [
    [T['door-opened'], 2, door.id, true], [T['door-closed'], 2, door.id, false], [T['return-opened'], 2, door.id, true],
  ]);
  for (const tick of [T['door-blocked'], T['return-blocked']]) {
    assert.ok(at(tick).doorClosed && at(tick).contacts.includes(door.colliderId));
    assert.ok(Math.abs(at(tick).state.character.velocity.z) < 0.01);
  }
  assert.ok(at(T['door-blocked']).state.character.position.z > 0.4);
  assert.ok(at(T['return-blocked']).state.character.position.z < -0.4);
  assert.deepEqual(a.trace.events.filter(({ tick }) => tick === T['threshold-denied']).map(({ type }) => type), ['input.request']);
  assert.ok(!at(T['next-room']).doorClosed && at(T['next-room']).state.character.position.z < -0.75);
  assert.ok(!at(last).doorClosed && at(last).state.character.position.z > 0.5);
  assert.deepEqual(ammo(at(last).state), [8, 15]);
});

test('M7 resets the same room twice and clears live camera, action, door and target state', async () => {
  const session = await setup();
  const { playback, room, panel, targetMaterial } = session;
  const spawn = playback.state;
  const pose = room.readActionPose();
  const castDoor = () => room.queries.raycast({ x: 9, y: 1, z: 0.65 }, { x: 0, y: 0, z: -1 }, 1);
  const assertReset = () => {
    assert.deepEqual(playback.state, spawn);
    assert.deepEqual(room.readActionPose(), pose);
    assert.equal(room.readMovementDebug(), undefined);
    assert.ok(panel.visible);
    assert.equal(castDoor()?.colliderId, door.colliderId);
    assert.equal(targetMaterial.emissiveIntensity, 0);
    assert.deepEqual(playback.trace().events, []);
    assert.deepEqual(playback.trace().inputs, []);
  };
  const first = session.run(60);
  for (const hz of [120, 60]) {
    assert.equal(panel.visible, false);
    assert.equal(castDoor(), null);
    session.reset();
    assertReset();
    assert.deepEqual(session.run(hz), first);
    assert.deepEqual(ammo(playback.state), [8, 15]);
  }

  session.reset();
  while (playback.state.tick < T.shot) playback.step();
  assert.equal(playback.state.action.phase, 'firing');
  assert.ok(playback.state.camera.verticalFovRad < spawn.camera.verticalFovRad);
  assert.equal(targetMaterial.emissiveIntensity, 1);
  session.reset();
  assertReset();
});

test('M7 applies the tuned movement, camera, and ammo values on reset and stamps the trace', async () => {
  const tuned: FeelConfig = {
    ...feel, version: feel.version + 1,
    movement: { ...feel.movement, walkSpeedMps: { ...feel.movement.walkSpeedMps, value: 1 } },
    camera: { ...feel.camera, aimVerticalFovRad: { ...feel.camera.aimVerticalFovRad, value: 0.7 } },
    actions: { ...feel.actions, initialReserve: { ...feel.actions.initialReserve, value: 0 } },
  };
  const session = await setup();
  session.playback.reset(tuned);
  assert.deepEqual(ammo(session.playback.state), [8, 0]);
  const { samples, trace } = session.run(120);
  assert.equal(trace.feelVersion, tuned.version);
  assert.ok(!matchesReferenceEvents(trace, route));
  assert.ok(samples[29].state.character.position.x < -2.25);
  assert.ok(Math.abs(samples[T['fire-start'] + 10].state.camera.verticalFovRad - 0.7) < 0.001);
  assert.deepEqual(ammo(samples.at(-1)!.state), [7, 0]);
  assert.equal(trace.events.filter((event) => event.type === 'ammo.committed').length, 1);
  for (const group of [feel.movement, feel.camera, feel.actions]) {
    for (const value of Object.values(group)) {
      assert.ok(Number.isFinite(value.value));
      assert.ok(['measured', 'observed', 'tuned'].includes(value.evidence));
      assert.ok(value.source && value.conditions);
    }
  }
});

test('M7 rejects incompatible metadata and discontinuous input ticks', async () => {
  const room = await createTestRoom(testRoom, manifest);
  for (const incompatible of [
    { ...route, version: 99 }, { ...route, stepS: 1 / 120 },
    { ...route, level: { ...route.level, id: 'm7-preview-route' } },
    { ...route, level: { ...route.level, version: 99 } },
    { ...route, inputs: [] }, { ...route, inputs: route.inputs.slice(1) },
  ]) {
    assert.throws(() => createRoutePlayback(incompatible, room, feel, () => {}));
  }
});