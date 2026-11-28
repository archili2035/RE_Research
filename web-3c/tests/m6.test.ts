import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEP_S } from '../src/contracts.ts';
import type { GameEvent, InputSnapshot } from '../src/contracts.ts';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom, defaultFeel, testRoom } from '../src/level.ts';
import { withLegacyMovement } from '../src/preview-stages.ts';
import { createSimulation } from '../src/simulation.ts';
import { targetLook } from './test-room-route.mjs';

test('M6 fixed route hits the target, reloads and crosses a repeatable collision door', async () => {
  // The hand-written route below keeps the v4 step counts; the shipped v5 route is covered by M7.
  const room = await createTestRoom(testRoom, undefined, withLegacyMovement(defaultFeel));
  const door = testRoom.doors[0];
  const target = testRoom.targets[0];
  const panel = room.scene.getObjectByName(door.colliderId)!;
  const face = room.scene.getObjectByName(target.colliderId) as import('three').Mesh<
    import('three').BoxGeometry, import('three').MeshStandardMaterial
  >;
  const neutral = createInputBuffer().sample(0);
  let controls: Partial<InputSnapshot> = {};
  let events: readonly GameEvent[] = [];
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages,
    sampleInput: (tick) => ({ ...neutral, ...controls, tick }),
    publish: (_state, _input, batch) => { events = batch; },
  });
  const advance = (input: Partial<InputSnapshot> = {}, count = 1) => {
    controls = input;
    let state = step();
    for (let i = 1; i < count; i += 1) state = step();
    return state;
  };
  const rayThroughDoor = () => room.queries.raycast({ x: 9, y: 1.35, z: 1 }, { x: 0, y: 0, z: -1 }, 3);

  assert.deepEqual(events, []);
  assert.deepEqual(room.initial.character.position, testRoom.spawn.position);
  advance({ interactPressed: true, firePressed: true });
  assert.deepEqual(events.map((event) => event.type), ['input.request', 'input.request']);

  const turn = advance({ moveY: 1 }, 277);
  assert.ok(Math.abs(turn.character.position.x - 9) < 0.1);
  advance({ lookDeltaX: -Math.PI / (2 * 0.0022) });
  const stop = advance({ moveY: 1 }, 64);
  assert.ok(stop.character.position.z > 2.2 && stop.character.position.z < 2.4);

  const raise = advance({ aimHeld: true, firePressed: true, ...targetLook });
  assert.equal(raise.action.phase, 'raising');
  assert.deepEqual([raise.action.magazine, raise.action.reserve], [8, 16]);
  advance({ aimHeld: true }, 27);
  assert.deepEqual(events.map(({ type }) => type), ['action.recovered', 'action.accepted']);
  const fire = advance({ aimHeld: true }, 4);
  assert.deepEqual([fire.action.magazine, fire.action.reserve], [7, 16]);
  assert.deepEqual(events.map(({ type }) => type), ['weapon.fired', 'ammo.committed', 'target.hit']);
  assert.equal(events.at(-1)?.subjectId, target.id);
  assert.equal(face.material.emissiveIntensity, 1);
  advance({ aimHeld: true }, 11);
  assert.deepEqual(events.map(({ type }) => type), ['action.recovered']);
  advance({ aimHeld: true, reloadPressed: true });
  const reloading = advance({ aimHeld: true }, 43);
  assert.deepEqual([reloading.action.magazine, reloading.action.reserve], [7, 16]);
  const reload = advance({ aimHeld: true });
  assert.deepEqual([reload.action.magazine, reload.action.reserve], [8, 15]);
  assert.deepEqual(events.map(({ type }) => type), ['ammo.committed']);
  assert.equal(face.material.emissiveIntensity, 0);
  advance({ aimHeld: true }, 40);
  assert.deepEqual(events.map(({ type }) => type), ['action.recovered']);

  advance({ lookDeltaX: -targetLook.lookDeltaX });
  const blocked = advance({ moveY: 1 }, 60);
  assert.ok(blocked.character.position.z > 0.39 && blocked.character.position.z < 0.5);
  assert.equal(room.doorPrompt(blocked.character.position), 'E 开门');
  assert.equal(rayThroughDoor()?.colliderId, door.colliderId);
  assert.equal(panel.visible, true);

  const opened = advance({ interactPressed: true });
  assert.deepEqual(events.map(({ type, order }) => [type, order]), [
    ['input.request', 0], ['action.accepted', 1], ['door.changed', 2], ['action.recovered', 3],
  ]);
  assert.deepEqual(events[2], {
    type: 'door.changed', open: true, subjectId: door.id, tick: opened.tick, timeS: opened.tick * STEP_S, order: 2,
  });
  assert.equal(rayThroughDoor(), null);
  assert.equal(panel.visible, false);
  const threshold = advance({ moveY: 1 }, 10);
  assert.ok(Math.abs(threshold.character.position.z) < 0.15);
  assert.equal(room.doorPrompt(threshold.character.position), '离开门槛后可关门');
  advance({ interactPressed: true });
  assert.deepEqual(events.map((event) => event.type), ['input.request']);

  const entered = advance({ moveY: 1 }, 20);
  assert.ok(entered.character.position.z < -0.75);
  assert.equal(entered.character.grounded, true);
  advance({ interactPressed: true });
  assert.equal(panel.visible, true);
  assert.ok(events.some((event) => event.type === 'door.changed' && !event.open));
  assert.equal(rayThroughDoor()?.colliderId, door.colliderId);
  const blockedReturn = advance({ moveY: -1 }, 25);
  assert.ok(blockedReturn.character.position.z < -0.39);
  advance({ interactPressed: true });
  const returned = advance({ moveY: -1 }, 25);
  assert.ok(returned.character.position.z > 0.5);
});