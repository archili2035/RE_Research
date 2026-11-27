import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { createActionView } from '../src/action-view.ts';
import { createActions } from '../src/actions.ts';
import type { ActionPose } from '../src/actions.ts';
import { loadClipAssets } from '../src/clip-assets.ts';
import { STEP_S } from '../src/contracts.ts';
import type { ClipManifest, GameEvent, InputSnapshot, SceneQueries } from '../src/contracts.ts';
import feel from '../src/feel.json' with { type: 'json' };
import manifest from '../public/assets/clips.json' with { type: 'json' };
import { createInputBuffer } from '../src/input.ts';
import { createFixedLoop, createSimulation } from '../src/simulation.ts';
import type { SimulationState } from '../src/simulation.ts';

const origin = { x: 0, y: 0, z: 0 };
const neutral = createInputBuffer().sample(0);
const scene: SceneQueries = {
  moveCapsule: ({ displacement }) => ({ displacement, grounded: true }),
  sweepSphere: () => null,
  raycast: () => null,
};
const clips = manifest as ClipManifest;
const trace: string[] = [];

function run(
  count: number, inputs: (tick: number) => Partial<InputSnapshot>,
  options: { renderHz?: number; magazine?: number; reserve?: number; manifest?: ClipManifest; traceName?: string } = {},
) {
  const actions = createActions(feel.actions, options.manifest ?? clips);
  const initial: SimulationState = {
    tick: 0,
    character: { position: origin, velocity: origin, yawRad: 0, grounded: true },
    action: { ...actions.initial, magazine: options.magazine ?? actions.initial.magazine,
      reserve: options.reserve ?? actions.initial.reserve },
    camera: { position: origin, yawRad: 0, pitchRad: 0, verticalFovRad: 1, obstructed: false },
  };
  const states: SimulationState[] = [];
  const events: GameEvent[] = [];
  const poses: ActionPose[] = [];
  const step = createSimulation(initial, scene, {
    sampleInput: (tick) => ({ ...neutral, ...inputs(tick), tick }),
    move: (input, previous) => ({ ...previous.character, velocity: { ...origin, z: -input.moveY } }),
    act: actions.act,
    camera: (_input, _character, _action, previous) => previous,
    publish(state, frame, emitted) {
      assert.ok(state.action.magazine >= 0 && state.action.magazine <= actions.initial.magazine);
      assert.ok(state.action.reserve >= 0);
      emitted.forEach((event, order) => {
        assert.equal(event.order, order);
        assert.equal(event.tick, state.tick);
        assert.equal(event.timeS, state.tick * STEP_S);
      });
      states.push(state);
      poses.push(actions.readPose());
      events.push(...emitted);
      if (options.traceName) {
        const batch = emitted.map((event) => `${event.order}:${event.type}${'action' in event ? '/' + event.action : ''}`);
        trace.push([options.traceName, state.tick, state.tick * STEP_S, Number(frame.aimHeld), Number(frame.firePressed),
          Number(frame.reloadPressed), Number(frame.sprintHeld), Math.abs(state.character.velocity.z), state.action.phase,
          state.action.magazine, state.action.reserve, actions.readPose().gaitWeight, batch.join('|')].join(','));
      }
    },
  });
  const hz = options.renderHz ?? 60;
  const loop = createFixedLoop(() => { if (states.length < count) step(); }, () => {});
  for (let frame = 0; frame <= Math.ceil(count * hz / 60); frame += 1) loop.frame(frame * 1000 / hz);
  assert.equal(states.length, count);
  return { states, poses, events };
}

function eventLog(events: readonly GameEvent[]) {
  return events.map((event) => [event.tick, event.type, ...('action' in event ? [event.action] :
    event.type === 'ammo.committed' ? [event.magazine, event.reserve] : [])]);
}

test('M5 buffers fire during raise, fires once while moving, and ignores fire during reload at 60/120 Hz', () => {
  const inputs = (tick: number) => ({
    aimHeld: tick <= 130, moveY: tick <= 42 ? 1 : 0,
    firePressed: [1, 50, 96].includes(tick), reloadPressed: tick === 45,
  });
  const result = run(150, inputs, { traceName: 'moving-fire-reload' });
  assert.deepEqual(result, run(150, inputs, { renderHz: 120 }));
  assert.deepEqual(eventLog(result.events), [
    [1, 'input.request', 'raise'], [1, 'input.request', 'fire'], [1, 'action.accepted', 'raise'],
    [28, 'action.recovered', 'raise'], [28, 'action.accepted', 'fire'],
    [32, 'weapon.fired'], [32, 'ammo.committed', 7, 16], [43, 'action.recovered', 'fire'],
    [45, 'input.request', 'reload'], [45, 'action.accepted', 'reload'], [50, 'input.request', 'fire'],
    [89, 'ammo.committed', 8, 15], [96, 'input.request', 'fire'], [129, 'action.recovered', 'reload'],
    [131, 'input.request', 'lower'], [131, 'action.accepted', 'lower'], [149, 'action.recovered', 'lower'],
  ]);
  assert.equal(result.states[30].action.magazine, 8);
  assert.equal(result.poses[31].clip, 'fire');
  assert.ok(result.poses[31].gaitWeight > 0);
  assert.notEqual(result.poses[31].gaitPhaseRad, result.poses[30].gaitPhaseRad);
  assert.equal(result.states[88].action.phase, 'reloading');
  assert.equal(result.poses[88].gaitWeight, 0);
});

test('M5 release cancels buffered fire and a matching re-press reverses lowering', () => {
  const result = run(45, (tick) => ({ aimHeld: tick < 8 || tick >= 9, firePressed: tick === 1 }), {
    traceName: 'reverse-raise',
  });
  assert.equal(result.poses[7].clip, 'lower');
  assert.equal(result.poses[8].clip, 'raise');
  assert.ok(result.poses[8].lift < result.poses[7].lift);
  assert.ok(result.poses[9].lift > result.poses[8].lift);
  assert.ok(!result.events.some(({ type }) => type === 'weapon.fired' || type === 'ammo.committed'));
  assert.ok(!result.events.some((event) => event.type === 'action.recovered' && event.action === 'lower'));
  assert.equal(result.states.at(-1)?.action.phase, 'aiming');
});

test('M5 drops expired buffered fire and resolves simultaneous fire and reload by eligibility', () => {
  const slowRaise: ClipManifest = {
    ...clips, clips: clips.clips.map((clip) => clip.id === 'raise' ? { ...clip, durationS: 1 } : clip),
  };
  const expired = run(65, (tick) => ({ aimHeld: true, firePressed: tick === 1 }), { manifest: slowRaise });
  assert.equal(expired.states.at(-1)?.action.phase, 'aiming');
  assert.ok(!expired.events.some(({ type }) => type === 'weapon.fired'));

  const priority = run(130, (tick) => ({
    aimHeld: true, firePressed: tick === 29 || tick === 45, reloadPressed: tick === 29 || tick === 45,
  }), { magazine: 1, reserve: 1, traceName: 'single-edge-priority' });
  assert.deepEqual(priority.events.filter(({ type }) => type === 'action.accepted')
    .map(({ tick, action }) => [tick, action]), [[1, 'raise'], [29, 'fire'], [45, 'reload']]);
  assert.deepEqual(eventLog(priority.events.filter(({ type }) => type === 'ammo.committed')), [
    [33, 'ammo.committed', 0, 1], [89, 'ammo.committed', 1, 0],
  ]);
});

test('M5 moving sprint cancels reload across the commit boundary without rolling back ammo', () => {
  for (const cancelTick of [44, 45, 46]) {
    const result = run(90, (tick) => ({
      reloadPressed: tick === 1, sprintHeld: tick >= 30,
      moveY: tick >= cancelTick ? 1 : 0,
    }), { magazine: 6, reserve: 1, traceName: `sprint-${cancelTick}` });
    assert.equal(result.states[cancelTick - 2].action.phase, 'reloading');
    assert.equal(result.states[cancelTick - 1].action.phase, 'ready');
    assert.deepEqual(eventLog(result.events.filter(({ type }) => type === 'ammo.committed')),
      cancelTick === 44 ? [] : [[45, 'ammo.committed', 7, 0]]);
    assert.ok(!result.events.some((event) => event.type === 'action.recovered' && event.action === 'reload'));
    assert.equal(result.states.at(-1)?.action.magazine, cancelTick === 44 ? 6 : 7);
  }
});

test('M5 draws additive fire over moving legs and plays M2 baked reload as an absolute pose', async () => {
  const glb = readFileSync(new URL('../public/assets/m2-rehearsal.glb', import.meta.url));
  const rehearsal = `data:application/octet-stream;base64,${glb.toString('base64')}`;
  const data = {
    ...clips, clips: clips.clips.map((clip) => ({
      ...clip, glb: rehearsal, referencePose: clip.referencePose && { ...clip.referencePose, glb: rehearsal },
    })),
  };
  const url = new URL(`data:application/json,${encodeURIComponent(JSON.stringify(data))}`);
  const needsProgressEvent = !globalThis.ProgressEvent;
  // Three.js FileLoader emits this DOM event even when the test has no progress listener.
  if (needsProgressEvent) Object.defineProperty(globalThis, 'ProgressEvent', { value: Event, configurable: true });
  const loaded = await loadClipAssets(url).finally(() => {
    if (needsProgressEvent) Reflect.deleteProperty(globalThis, 'ProgressEvent');
  });
  const view = createActionView(loaded);
  assert.ok(view);
  const socket = view.root.getObjectByName('R_Wep')!;
  const leg = view.root.getObjectByName('R_Thigh')!;
  const hand = view.root.getObjectByName('L_Hand')!;
  const well = view.root.getObjectByName('MagazineWell')!;
  const magazine = view.root.getObjectByName('Magazine')!;
  const position = (node: typeof well) => node.getWorldPosition(new Vector3());
  const initialPose = createActions(feel.actions).readPose();
  const sample = (overrides: Partial<ActionPose>) => {
    view.draw({
      ...initialPose, lift: 1, gaitPhaseRad: Math.PI / 2, gaitWeight: 1, ...overrides,
    });
    view.root.updateMatrixWorld(true);
    const direction = new Vector3(0, 0, 1).applyQuaternion(socket.getWorldQuaternion(socket.quaternion.clone()));
    return {
      pitchDeg: Math.asin(direction.y) * 180 / Math.PI, thighRad: leg.rotation.x,
      handToWellM: position(hand).distanceTo(position(well)), magazineToWellM: position(magazine).distanceTo(position(well)),
    };
  };
  const aiming = sample({});
  const recoil = sample({ clip: 'fire', progress: 0.25 });
  const oppositeStep = sample({ clip: 'fire', progress: 0.25, gaitPhaseRad: 3 * Math.PI / 2 });
  const removedMagazine = sample({ clip: 'reload', progress: 0.30 / 1.40 });
  const reloadContact = sample({ clip: 'reload', progress: 0.72 / 1.40 });
  const recovered = sample({});
  const lowering = sample({ clip: 'lower', progress: 0.5, lift: 0.5, gaitWeight: 0 });
  const ready = sample({ lift: 0, gaitWeight: 0 });
  assert.ok(Math.abs(aiming.pitchDeg) < 0.01);
  assert.ok(Math.abs(recoil.pitchDeg - 13) < 0.01);
  assert.equal(aiming.thighRad, recoil.thighRad);
  assert.ok(recoil.thighRad > 0.29 && oppositeStep.thighRad < -0.29);
  assert.equal(recoil.pitchDeg, oppositeStep.pitchDeg);
  assert.ok(removedMagazine.magazineToWellM > 0.15);
  assert.ok(reloadContact.handToWellM < 1e-5 && reloadContact.magazineToWellM < 1e-5);
  assert.ok(Math.abs(reloadContact.thighRad) < 1e-5);
  assert.deepEqual(recovered, aiming);
  assert.ok(Math.abs(lowering.pitchDeg + 8) < 0.01);
  assert.ok(Math.abs(ready.pitchDeg + 18) < 0.01);
  if (process.env.M5_POSES) {
    const poses = { aiming, recoil, oppositeStep, removedMagazine, reloadContact, recovered, lowering, ready };
    writeFileSync(process.env.M5_POSES, JSON.stringify(poses, null, 2) + '\n', 'utf8');
  }
});

test.after(() => {
  if (!process.env.M5_TRACE) return;
  const header = 'case,tick,time_s,aim_held,fire_pressed,reload_pressed,sprint_held,speed_mps,phase,magazine,reserve,gait_weight,events';
  writeFileSync(process.env.M5_TRACE, [header, ...trace, ''].join('\n'), 'utf8');
});
