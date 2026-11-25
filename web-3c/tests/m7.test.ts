import assert from 'node:assert/strict';
import { test } from 'node:test';
import routeJson from '../fixtures/route.replay.json' with { type: 'json' };
import feelJson from '../src/feel.json' with { type: 'json' };
import type { FeelConfig, ReplayTrace } from '../src/contracts.ts';
import { createRoutePlayback, matchesReferenceEvents } from '../src/m7-replay.ts';
import { createPreviewScene } from '../src/preview-scene.ts';
import { createFixedLoop } from '../src/simulation.ts';
import type { SimulationState } from '../src/simulation.ts';

const route = routeJson as ReplayTrace;
const feel = feelJson as FeelConfig;

async function run(renderHz: number, config = feel) {
  const { queries } = await createPreviewScene();
  const states: SimulationState[] = [];
  const playback = createRoutePlayback(route, config, queries, (state) => states.push(state));
  const loop = createFixedLoop(() => playback.step(), () => {});
  const frameCount = Math.ceil(route.inputs.length * route.stepS * renderHz);
  for (let frame = 0; frame <= frameCount; frame += 1) loop.frame(frame * 1000 / renderHz);
  assert.ok(playback.done);
  assert.equal(states.length, route.inputs.length);
  return { states, trace: playback.trace() };
}

test('M7 route replays all fixed steps and matches baseline at 60 and 120 Hz', async () => {
  const a = await run(60);
  const b = await run(120);
  assert.deepEqual(a, b);
  assert.deepEqual(a.trace, route);
  assert.ok(matchesReferenceEvents(a.trace, route));
  const at = (tick: number) => a.states[tick - 1];
  assert.ok(Math.hypot(at(137).character.velocity.x, at(137).character.velocity.z) < 0.002);
  assert.equal(at(159).camera.obstructed, true);
  assert.equal(at(197).camera.obstructed, false);
  assert.equal(at(207).action.magazine, 7);
  assert.deepEqual([at(235).action.magazine, at(235).action.reserve], [8, 15]);
  assert.ok(at(300).character.position.x > 3 && at(300).character.position.z < -5);
});

test('M7 tuned values feed the replay, retain evidence, and stamp the exported trace', async () => {
  const walk = feel.movement.walkSpeedMps;
  const tuned: FeelConfig = {
    ...feel, version: feel.version + 1,
    movement: { ...feel.movement, walkSpeedMps: { ...walk, value: 1 } },
    camera: { ...feel.camera, aimVerticalFovRad: { ...feel.camera.aimVerticalFovRad, value: 0.7 } },
    actions: { ...feel.actions, initialReserve: { ...feel.actions.initialReserve, value: 0 } },
  };
  const { states, trace } = await run(120, tuned);
  assert.equal(trace.feelVersion, tuned.version);
  assert.ok(!matchesReferenceEvents(trace, route));
  assert.ok(states[29].character.position.z > 2.4);
  assert.equal(states[197].camera.verticalFovRad, 0.7);
  assert.equal(states[234].action.magazine, 7);
  for (const group of [feel.movement, feel.camera, feel.actions]) {
    for (const value of Object.values(group)) {
      assert.ok(Number.isFinite(value.value));
      assert.equal(value.evidence, 'tuned');
      assert.ok(value.source && value.conditions);
    }
  }
});

test('M7 rejects incompatible level and discontinuous input ticks', async () => {
  const { queries } = await createPreviewScene();
  assert.throws(() => createRoutePlayback({ ...route, level: { ...route.level, version: 99 } }, feel, queries, () => {}));
  assert.throws(() => createRoutePlayback({ ...route, inputs: route.inputs.slice(1) }, feel, queries, () => {}));
});
