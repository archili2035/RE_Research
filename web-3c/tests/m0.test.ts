import assert from 'node:assert/strict';
import test from 'node:test';
import { STEP_S } from '../src/contracts.ts';
import type { GameEvent, InputSnapshot } from '../src/contracts.ts';
import { createInputBuffer } from '../src/preview-input.ts';
import { createPreviewScene } from '../src/preview-scene.ts';
import { actPreview, cameraPreview, movePreview, previewInitialState } from '../src/preview-stages.ts';
import { createFixedLoop, createSimulation } from '../src/simulation.ts';

test('snapshot consumes deltas and edges once, preserves holds, and clears on reset', () => {
  const input = createInputBuffer();
  input.keyDown('KeyW', false);
  input.keyDown('ShiftRight', false);
  input.keyDown('KeyR', false);
  input.keyDown('KeyR', true);
  input.keyDown('KeyE', false);
  input.keyUp('KeyE');
  input.button(2, true);
  input.button(0, true);
  input.look(5, -3);
  input.look(-2, -4);

  const first = input.sample(1);
  assert.deepEqual(first, {
    tick: 1, moveX: 0, moveY: 1, lookDeltaX: 3, lookDeltaY: -7,
    sprintHeld: true, aimHeld: true, firePressed: true, reloadPressed: true, interactPressed: true,
  });
  assert.ok(Object.isFrozen(first));

  input.keyDown('KeyR', true);
  input.button(0, true);
  assert.deepEqual(input.sample(2), {
    ...first, tick: 2, lookDeltaX: 0, lookDeltaY: 0, firePressed: false, reloadPressed: false, interactPressed: false,
  });
  input.keyUp('KeyR');
  input.keyDown('KeyR', false);
  input.button(0, false);
  input.button(0, true);
  input.look(-4, 1);
  input.clear();
  assert.deepEqual(input.sample(3), {
    ...first, tick: 3, moveY: 0, lookDeltaX: 0, lookDeltaY: 0, sprintHeld: false,
    aimHeld: false, firePressed: false, reloadPressed: false, interactPressed: false,
  });
});

test('fixed-step clock bounds stalls and drops paused time on reset', () => {
  let ticks = 0;
  let alpha = 0;
  const loop = createFixedLoop(() => { ticks += 1; }, (value) => { alpha = value; });
  loop.frame(100);
  loop.frame(100 + 500 * STEP_S);
  assert.equal(ticks, 0);
  assert.ok(Math.abs(alpha - 0.5) < 1e-9);
  loop.frame(1100);
  assert.equal(ticks, 15);
  loop.resetClock();
  loop.frame(2100);
  assert.equal(ticks, 15);
  assert.equal(alpha, 0);
  loop.frame(2100 + 1000 * STEP_S);
  assert.equal(ticks, 16);
});

test('identical tick input at 60/120 render Hz produces identical state and ordered events', async () => {
  const input = createInputBuffer();
  const emptyInput = input.sample(0);
  async function run(renderHz: number) {
    const { queries } = await createPreviewScene();
    const events: GameEvent[] = [];
    const order: string[] = [];
    const snapshots: InputSnapshot[] = [];
    let current = previewInitialState;
    const step = createSimulation(current, queries, {
      sampleInput(tick) {
        order.push('input');
        return {
          ...emptyInput, tick, moveY: tick <= 45 ? 1 : 0, aimHeld: tick >= 2 && tick < 70,
          lookDeltaX: tick === 2 ? 100 : 0, firePressed: tick === 2,
          reloadPressed: tick === 40, interactPressed: tick === 80,
        };
      },
      move(frame, previous, scene) {
        order.push('movement');
        assert.equal(previous.tick, frame.tick - 1);
        if (frame.tick === 2) {
          assert.equal(previous.action.aiming, false);
          assert.equal(previous.camera.yawRad, 0);
        }
        if (frame.tick === 3) {
          assert.equal(previous.action.aiming, true);
          assert.ok(previous.camera.yawRad < 0);
        }
        return movePreview(frame, previous, scene);
      },
      act(...args) {
        order.push('action');
        return actPreview(...args);
      },
      camera(...args) {
        order.push('camera');
        return cameraPreview(...args);
      },
      publish(state, frame, emitted) {
        assert.deepEqual(order.splice(0), ['input', 'movement', 'action', 'camera']);
        assert.equal(state.tick, frame.tick);
        for (const [index, event] of emitted.entries()) {
          assert.equal(event.tick, frame.tick);
          assert.equal(event.timeS, frame.tick * STEP_S);
          assert.equal(event.order, index);
          assert.equal(event.subjectId, 'preview-player');
        }
        current = state;
        snapshots.push(frame);
        events.push(...emitted);
      },
    });
    const loop = createFixedLoop(step, (alpha) => assert.ok(alpha >= 0 && alpha < 1));
    for (let frame = 0; frame <= 2 * renderHz; frame += 1) {
      loop.frame(frame * 1000 / renderHz);
    }
    return { current, snapshots, events };
  }

  const sixty = await run(60);
  assert.deepEqual(sixty, await run(120));
  assert.deepEqual(sixty.snapshots.map((frame) => frame.tick), Array.from({ length: 120 }, (_, index) => index + 1));
  assert.equal(sixty.current.tick, 120);
  assert.ok(sixty.current.character.position.z < 2);
  assert.ok(sixty.current.character.grounded);
  assert.deepEqual(sixty.events.filter((event) => event.tick === 2).map((event) => event.type), [
    'input.request', 'action.accepted', 'action.recovered',
    'input.request', 'action.accepted', 'weapon.fired', 'ammo.committed', 'action.recovered',
  ]);
  assert.deepEqual(sixty.events.filter((event) => event.type === 'ammo.committed')
    .map(({ tick, magazine, reserve }) => [tick, magazine, reserve]), [[2, 7, 16], [40, 8, 15]]);
  assert.equal(sixty.events.at(-1)?.type, 'input.request');
});

test('greybox scene queries return metre distances and stable IDs', async () => {
  const { queries } = await createPreviewScene();
  const origin = { x: 0, y: 1.2, z: 3 };
  const ray = queries.raycast(origin, { x: -5, y: 0, z: 0 }, 3);
  const sweep = queries.sweepSphere(origin, { ...origin, x: -3 }, 0.25);
  assert.equal(ray?.colliderId, 'west-wall');
  assert.equal(sweep?.colliderId, 'west-wall');
  assert.ok(Math.abs(ray!.distanceM - 2.38) < 0.001);
  assert.ok(Math.abs(sweep!.distanceM - 2.13) < 0.001);
  assert.ok(ray!.normal.x > 0.99);
  assert.ok(sweep!.normal.x > 0.99);
});
