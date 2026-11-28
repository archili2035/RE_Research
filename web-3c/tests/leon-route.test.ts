import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import reference from '../fixtures/route.replay.json' with { type: 'json' };
import { createActionView } from '../src/action-view.ts';
import { loadClipAssets } from '../src/clip-assets.ts';
import type { GameEvent, InputSnapshot, LevelDefinition } from '../src/contracts.ts';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom, testRoom } from '../src/level.ts';
import { LEON_WALK, leonWalkBlend, leonWalkTime } from '../src/leon-locomotion.ts';
import { createLeonView } from '../src/leon-view.ts';
import type { LeonAssets } from '../src/leon-view.ts';
import { createPlayerView } from '../src/player-view.ts';
import { createSimulation } from '../src/simulation.ts';
import manifest from '../public/assets/clips.json' with { type: 'json' };
import { testRoomRoute } from './test-room-route.mjs';

const source = new URL('../../docs/player/', import.meta.url);

async function rehearsalClips() {
  const bytes = readFileSync(new URL('../public/assets/m2-rehearsal.glb', import.meta.url));
  const glb = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
  const entries = manifest.clips.map((clip) => ({
    ...clip, glb, referencePose: clip.referencePose && { ...clip.referencePose, glb },
  }));
  const url = new URL(`data:application/json,${encodeURIComponent(JSON.stringify({ ...manifest, clips: entries }))}`);
  if (globalThis.ProgressEvent) return loadClipAssets(url);
  Object.defineProperty(globalThis, 'ProgressEvent', { value: Event, configurable: true });
  try {
    return await loadClipAssets(url);
  } finally {
    Reflect.deleteProperty(globalThis, 'ProgressEvent');
  }
}

function loadLeonAssets(): LeonAssets {
  const context = createContext({ window: {} }) as unknown as
    Pick<LeonAssets, 'MotionMath' | 'LeonSkinning'> & { window: Pick<LeonAssets, 'MODEL_DATA' | 'MOTION_DATA' | 'MASK_DATA'> };
  for (const file of ['model.js', 'motions.js', 'masks.js', 'math.js', 'skinning.js']) {
    runInContext(readFileSync(new URL(file, source), 'utf8'), context, { filename: file });
  }
  return {
    ...context.window,
    MotionMath: context.MotionMath,
    LeonSkinning: context.LeonSkinning,
  };
}

function sourceJointPose(assets: LeonAssets, clip: LeonAssets['MOTION_DATA']['clips'][number], name: string, timeS: number) {
  const index = clip.bones.findIndex((bone) => bone.name === name);
  const bone = clip.bones[index];
  const track = clip.tracks.find(({ bone }) => bone === index);
  return {
    p: new Vector3().fromArray(assets.MotionMath.sample(track?.position, timeS, bone.position)),
    q: new Quaternion().fromArray(assets.MotionMath.sample(track?.rotation, timeS, bone.rotation, true)).normalize(),
  };
}

const weaponFile = process.env.LEON_WEAPON_GLB;
const aimedUpperPairs = [
  ['Spine_0', 'Hip'], ['Spine_1', 'Spine_0'], ['Spine_2', 'Spine_1'],
  ['L_Arm_Clavicle', 'Spine_2'], ['R_Arm_Clavicle', 'Spine_2'],
  ['L_Arm_Upper', 'L_Arm_Clavicle'], ['R_Arm_Upper', 'R_Arm_Clavicle'],
  ['L_Arm_Hand', 'L_Arm_Lower'], ['R_Arm_Hand', 'R_Arm_Lower'], ['R_Wep', 'R_Arm_Hand'],
] as const;

async function loadWeapon() {
  if (!weaponFile) return;
  const buffer = Uint8Array.from(readFileSync(weaponFile)).buffer;
  return (await new GLTFLoader().parseAsync(buffer, '')).scene;
}

function readGrip(leon: ReturnType<typeof createLeonView>) {
  const grip = leon.root.getObjectByName('C_Attach_Hand_A');
  const muzzle = leon.root.getObjectByName('vfx_muzzle1');
  assert.ok(grip && muzzle);
  const socket = leon.readJoint('R_Wep')!;
  grip.updateWorldMatrix(true, false);
  muzzle.updateWorldMatrix(true, false);
  const error = Math.max(...socket.elements.map((value, i) => Math.abs(value - grip.matrixWorld.elements[i])));
  const origin = grip.getWorldPosition(new Vector3());
  const hand = new Vector3().setFromMatrixPosition(leon.readJoint('R_Arm_Hand')!);
  const muzzleDirection = new Vector3(0, 0, 1).transformDirection(muzzle.matrixWorld);
  assert.ok(error < 1e-6, `grip matrix error ${error}`);
  assert.ok(origin.distanceTo(hand) < 0.16, 'grip stays close to the right hand');
  return { error, origin: origin.toArray(), muzzleDirection: muzzleDirection.toArray(), handDistanceM: origin.distanceTo(hand) };
}

test('local wp0100 binds to R_Wep in stand, raise, strafe, fire and reload', { skip: !weaponFile }, async () => {
  const leon = createLeonView(loadLeonAssets(), await loadWeapon());
  const room = await createTestRoom(undefined, manifest);
  const player = createPlayerView(leon);
  const neutral = createInputBuffer().sample(0);
  const stages = new Map<number, string>([[1, 'stand'], [14, 'raise'], [57, 'strafe'], [71, 'fire'], [131, 'reload']]);
  const samples = [];
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages,
    sampleInput: (tick) => ({
      ...neutral, tick, aimHeld: tick >= 8, moveX: tick >= 36 && tick <= 61 ? 1 : 0,
      firePressed: tick === 67, reloadPressed: tick === 89,
    }),
    publish: () => {},
  });
  for (let i = 1; i <= 131; i++) {
    const state = step();
    const label = stages.get(i);
    if (!label) continue;
    const pose = room.readActionPose();
    player.draw(state.character.position, state.character.yawRad, pose, { x: -10, y: 1.5, z: 5 });
    const grip = readGrip(leon);
    const yaw = state.character.yawRad;
    const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const muzzleDotForward = forward.dot(new Vector3().fromArray(grip.muzzleDirection));
    samples.push({ label, tick: i, phase: state.action.phase, pose, grip, muzzleDotForward });
  }
  assert.deepEqual(samples.map(({ phase }) => phase), ['ready', 'raising', 'aiming', 'firing', 'reloading']);
  assert.ok(samples[2].pose.walk.blend > 0.9, 'sample taken during strafe');
  assert.ok(samples[2].muzzleDotForward > 0.95, 'aimed strafe keeps the barrel pointing forward');
  for (let i = 1; i < samples.length; i++) {
    assert.notDeepEqual(samples[i].grip.origin, samples[i - 1].grip.origin);
  }
  if (process.env.LEON_WEAPON_EVIDENCE) {
    writeFileSync(process.env.LEON_WEAPON_EVIDENCE, JSON.stringify(samples, null, 2) + '\n');
  }
});

test('Leon stationary aim loops, rejects jitter, turns with signed camera yaw and keeps the original shot delta', async () => {
  const assets = loadLeonAssets();
  const leon = createLeonView(assets);
  const room = await createTestRoom({ ...testRoom, spawn: { ...testRoom.spawn, yawRad: Math.PI - 0.03 } }, manifest);
  const player = createPlayerView(leon);
  const neutral = createInputBuffer().sample(0);
  const segments = [
    ['raise', 36, 0], ['idle', 42, 0], ['jitter', 20, 0], ['left', 60, -2], ['stop-left', 42, 0],
    ['right', 60, 2], ['stop-right', 42, 0], ['fire', 32, 0], ['loop', 40, 0],
  ] as const;
  const course = segments.flatMap(([label, length, yaw]) => Array.from({ length }, (_, index) => ({
    label, aimHeld: true, lookDeltaX: label === 'jitter' ? (index % 2 ? 1 : -1) : yaw,
    firePressed: label === 'fire' && index === 0,
  })));
  const events: GameEvent[] = [];
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages, sampleInput: (tick) => ({ ...neutral, ...course[tick - 1], tick }),
    publish(_state, _input, batch) { events.push(...batch); },
  });
  type SamplePose = ReturnType<typeof room.readActionPose>;
  const draw = (character: typeof room.initial.character, pose: SamplePose) =>
    player.draw(character.position, character.yawRad, pose, { x: -10, y: 1.5, z: 5 });
  const joint = (name: string) => leon.readJoint(name)!;
  const relative = (name: string, parent = 'root') => joint(parent).invert().multiply(joint(name));
  const rotation = (matrix: Matrix4) => new Quaternion().setFromRotationMatrix(matrix).normalize();
  const position = (matrix: Matrix4) => new Vector3().setFromMatrixPosition(matrix);
  const upper = () => ({
    spine: rotation(relative('Spine_2')),
    shoulder: rotation(relative('R_Arm_Clavicle')),
    hand: rotation(relative('R_Arm_Hand')),
    grip: relative('L_Arm_Hand', 'R_Arm_Hand'),
  });
  const samples = course.map(({ label }) => {
    const { tick, character, camera } = step();
    const pose = room.readActionPose();
    draw(character, pose);
    return { label, tick, character, yaw: camera.yawRad, pose, ...upper() };
  });
  const byLabel = (label: string) => samples.filter((sample) => sample.label === label);
  const idle = byLabel('idle');
  assert.ok(Math.max(...idle.map(({ shoulder }) => shoulder.angleTo(idle[0].shoulder))) > 0.004);
  assert.ok(idle.every(({ pose }) => pose.aim.stationaryBlend === 1 && pose.aim.turn === 0));
  assert.ok(byLabel('jitter').every(({ pose }) => pose.aim.turn === 0));
  assert.ok(samples.every(({ pose }) => pose.walk.cycles === 0 && pose.walk.blend === 0));
  // The left pan crosses +pi to -pi without selecting the right track.
  assert.ok(byLabel('left').some(({ yaw }) => yaw < -3));

  const sourceClip = (id: number) => assets.MOTION_DATA.clips.find((clip) => clip.bank === 100 && clip.id === id)!;
  const hold = sourceClip(160);
  const sampleJoint = (clip: typeof hold, name: string, timeS: number) => sourceJointPose(assets, clip, name, timeS);
  const turnMetrics = [];
  for (const [label, sign, id] of [['left', 1, 165], ['right', -1, 167]] as const) {
    const run = byLabel(label);
    const peak = Math.max(...run.map(({ pose }) => sign * pose.aim.turn));
    assert.ok(peak > 0.35 && run.every(({ pose }) => sign * pose.aim.turn >= 0));
    assert.ok(byLabel(`stop-${label}`).slice(-12).every(({ pose }) => pose.aim.turn === 0));
    const clip = sourceClip(id);
    let spineDeltaRad = 0;
    let shoulderDeltaRad = 0;
    for (const { character, pose, spine, shoulder } of run.filter((_, i) => i % 5 === 4)) {
      const { turn, turnTimeS, idleTimeS } = pose.aim;
      const whole = sampleJoint(hold, 'Spine_1', idleTimeS % hold.duration).q
        .slerp(sampleJoint(clip, 'Spine_1', turnTimeS % clip.duration).q, Math.abs(turn));
      draw(character, pose);
      assert.ok(rotation(relative('Spine_1', 'Spine_0')).angleTo(whole) < 1e-6, `uses ${id}`);
      draw(character, { ...pose, aim: { ...pose.aim, turn: 0 } });
      const unstirred = upper();
      spineDeltaRad = Math.max(spineDeltaRad, spine.angleTo(unstirred.spine));
      shoulderDeltaRad = Math.max(shoulderDeltaRad, shoulder.angleTo(unstirred.shoulder));
    }
    turnMetrics.push({ id, peak, spineDeltaRad, shoulderDeltaRad });
    assert.ok(spineDeltaRad > 0.006 && shoulderDeltaRad > 0.006);
  }

  const stable = samples.filter(({ pose, label }) => pose.lift === 1 && (label !== 'raise') && pose.clip !== 'fire');
  const neutralGrip = stable[0].grip;
  const gripDriftM = Math.max(...stable.map(({ grip }) => position(grip).distanceTo(position(neutralGrip))));
  const gripDriftRad = Math.max(...stable.map(({ grip }) => rotation(grip).angleTo(rotation(neutralGrip))));
  const idleStepRad = Math.max(...stable.slice(1).filter(({ tick }, index) => tick === stable[index].tick + 1)
    .map(({ tick, shoulder }) => shoulder.angleTo(samples[tick - 2].shoulder)));
  assert.ok(gripDriftM < 0.003 && gripDriftRad < 0.02);
  assert.ok(idleStepRad < 0.035);
  assert.ok(stable.at(-1)!.pose.aim.idleTimeS > hold.duration, 'covers the hold loop seam');

  const accepted = events.find((event) => event.type === 'action.accepted' && event.action === 'fire')!;
  assert.deepEqual(events.filter(({ type }) => type === 'weapon.fired' || type === 'ammo.committed')
    .map((event) => [event.tick - accepted.tick, event.order, event.type, 'magazine' in event ? event.magazine : null]),
  [[4, 0, 'weapon.fired', null], [4, 1, 'ammo.committed', 7]]);
  const shot = samples[accepted.tick + 3];
  const fixed = assets.MotionMath.previewOnBasePose(sourceClip(1100), hold);
  draw(shot.character, { ...shot.pose, aim: { ...shot.pose.aim, idleTimeS: 0, stationaryBlend: 0 } });
  for (const [name, parent] of [['Spine_1', 'Spine_0'], ['R_Arm_Clavicle', 'Spine_2'], ['R_Arm_Hand', 'R_Arm_Lower']]) {
    const expected = sampleJoint(fixed, name, fixed.duration * shot.pose.progress);
    const actual = relative(name, parent);
    assert.ok(position(actual).distanceTo(expected.p) < 1e-6 && rotation(actual).angleTo(expected.q) < 1e-6,
      `fixed reference shot: ${name}`);
  }
  const start = samples[accepted.tick - 1];
  const recovered = samples[accepted.tick + 14];
  draw(start.character, { ...start.pose, clip: null });
  const entryDeltaRad = start.hand.angleTo(upper().hand);
  const exitStepRad = recovered.hand.angleTo(samples[recovered.tick - 2].hand);
  assert.ok(entryDeltaRad < 1e-5 && exitStepRad < 0.06);

  const out = process.env.LEON_AIM_EVIDENCE;
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ turnMetrics, gripDriftM, gripDriftRad, idleStepRad, entryDeltaRad, exitStepRad, samples, events }, null, 2) + '\n');
  }
});

test('Leon aimed movement transitions keep the weapon attached, feet on the same gait and the original action events', async () => {
  const assets = loadLeonAssets();
  const weapon = await loadWeapon();
  const leon = createLeonView(assets, weapon);
  const player = createPlayerView(leon);
  const size = { x: 14, y: 0.2, z: 14 };
  const floor = { x: 0, y: -0.1, z: 0 };
  const room = await createTestRoom({
    id: 'aimed-full-body', version: 1, spawn: { position: { x: 0, y: 0.025, z: 0 }, yawRad: 0 },
    render: [{ id: 'floor', kind: 'box', position: floor, size, yawRad: 0, color: '#718284' }],
    colliders: [{ id: 'floor', center: floor, size, yawRad: 0 }], doors: [], targets: [],
  }, manifest);
  const segments = [
    ['hold', 42, 0, 0, true], ['left', 50, -1, 0, true], ['right', 50, 1, 0, true],
    ['diagonal', 50, 1, 1, true], ['stop', 18, 0, 0, true], ['lower', 20, 0, 0, false],
    ['ready-left', 14, -1, 0, false], ['raise-left', 38, -1, 0, true],
    ['fire-left', 19, -1, 0, true], ['reload-left', 92, -1, 0, true],
  ] as const;
  const course = segments.flatMap(([label, length, moveX, moveY, aimHeld]) => Array.from({ length }, (_, index) => ({
    label, moveX, moveY, aimHeld, firePressed: label === 'fire-left' && index === 0,
    reloadPressed: label === 'reload-left' && index === 0,
  })));
  const neutral = createInputBuffer().sample(0);
  const events: GameEvent[] = [];
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages, sampleInput: (tick) => ({ ...neutral, ...course[tick - 1], tick }),
    publish(_state, _input, batch) { events.push(...batch); },
  });
  const model = leon.root.children[0];
  const calibrationM = model.position.y;
  const joint = (name: string) => leon.readJoint(name)!;
  const point = (name: string) => new Vector3().setFromMatrixPosition(joint(name));
  const draw = (character: typeof room.initial.character, pose: ReturnType<typeof room.readActionPose>) =>
    player.draw(character.position, character.yawRad, pose, { x: -10, y: 1.5, z: 5 });
  const measure = () => {
    const grip = joint('R_Arm_Hand').invert().multiply(joint('L_Arm_Hand'));
    return {
      upper: Object.fromEntries(aimedUpperPairs.map(([name, parent]) => [name, joint(parent).invert().multiply(joint(name)).toArray()])),
      shoulderLine: point('R_Arm_Clavicle').sub(point('L_Arm_Clavicle')).normalize(),
      muzzle: new Vector3(0, 0, 1).transformDirection(joint('R_Wep')),
      gripPosition: new Vector3().setFromMatrixPosition(grip),
      gripRotation: new Quaternion().setFromRotationMatrix(grip).normalize(),
      toes: [point('L_Leg_Toes'), point('R_Leg_Toes')],
    };
  };
  const samples = course.map(({ label }) => {
    const { tick, action, character } = step();
    const pose = room.readActionPose();
    draw(character, pose);
    return { label, tick, action, character, pose, ...measure(), mount: weapon && readGrip(leon),
      modelOffsetM: model.position.y, skinMinYM: leon.readSkin().bounds!.min[1] };
  });
  const phase = (sample: typeof samples[number]) => sample.pose.walk.cycles % 1;
  const steady = (sample: typeof samples[number]) => sample.pose.walk.blend === 1;
  const planars = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
  const metrics = segments.map(([label]) => {
    const run = samples.filter((sample) => sample.label === label);
    const first = run[0];
    const maxStep = (joint: 'shoulderLine' | 'muzzle') => Math.max(0, ...run.slice(1).map((s, i) => s[joint].angleTo(run[i][joint])),
      first.tick > 1 ? first[joint].angleTo(samples[first.tick - 2][joint]) : 0);
    let supportToeTravelM = 0;
    let supportSamples = 0;
    // Compare consecutive samples inside the aligned mid-support windows, away from foot strike and toe-off.
    for (const [side, from, to] of [[0, 0.08, 0.35], [1, 0.63, 0.88]] as const) {
      let anchor: Vector3 | undefined;
      for (const sample of run) {
        if (steady(sample) && phase(sample) >= from && phase(sample) <= to) {
          anchor ??= sample.toes[side];
          supportToeTravelM = Math.max(supportToeTravelM, planars(sample.toes[side], anchor));
          supportSamples++;
        } else anchor = undefined;
      }
    }
    return { label, ticks: [first.tick, run.at(-1)!.tick], shoulderStepRad: maxStep('shoulderLine'), muzzleStepRad: maxStep('muzzle'),
      supportSamples, supportToeTravelM,
      gripTravelM: Math.max(...run.map(({ gripPosition }) => gripPosition.distanceTo(first.gripPosition))),
      gripTravelRad: Math.max(...run.map(({ gripRotation }) => gripRotation.angleTo(first.gripRotation))) };
  });
  const out = process.env.LEON_AIM_WALK_EVIDENCE;
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ calibrationM, metrics, events, samples }, null, 2) + '\n');
  }
  assert.ok(samples.every(({ modelOffsetM }) => modelOffsetM === calibrationM));
  const walking = metrics.filter(({ label }) => ['left', 'right', 'diagonal'].includes(label));
  assert.ok(walking.every(({ supportSamples, gripTravelM }) => supportSamples > 10 && gripTravelM < 0.003));
  assert.ok([...walking, metrics.find(({ label }) => label === 'stop')!].every(({ shoulderStepRad, muzzleStepRad }) =>
    shoulderStepRad < 0.05 && muzzleStepRad < 0.05));
  const reversal = samples.find(({ label }) => label === 'right')!;
  const previous = samples[reversal.tick - 2];
  assert.ok(reversal.pose.walk.cycles > previous.pose.walk.cycles);
  assert.ok(reversal.pose.walk.weights[1] > 0 && reversal.pose.walk.weights[3] > 0);
  const stop = samples.filter(({ label }) => label === 'stop');
  assert.ok(stop.every(({ pose }) => pose.walk.cycles === stop[0].pose.walk.cycles));
  assert.equal(stop.at(-1)!.pose.walk.blend, 0);
  const fired = samples.find(({ label }) => label === 'fire-left')!.tick;
  const reloaded = samples.find(({ label }) => label === 'reload-left')!.tick;
  assert.deepEqual(events.filter(({ type }) => type === 'weapon.fired' || type === 'ammo.committed')
    .map((event) => [event.tick, event.order, event.type, 'magazine' in event ? event.magazine : null]),
  [[fired + 4, 0, 'weapon.fired', null], [fired + 4, 1, 'ammo.committed', 7], [reloaded + 44, 0, 'ammo.committed', 8]]);
  const raise = events.find((e) => e.type === 'action.recovered' && e.action === 'raise' && samples[e.tick - 1].label === 'raise-left')!;
  const previousRaisePose = samples[raise.tick - 2];
  const raisedPose = samples[raise.tick - 1];
  assert.ok(raisedPose.shoulderLine.angleTo(previousRaisePose.shoulderLine) < 0.035);
  assert.ok(raisedPose.muzzle.angleTo(previousRaisePose.muzzle) < 0.035);
  const leftClip = assets.MOTION_DATA.clips.find(({ bank, id }) => bank === 100 && id === 122)!;
  for (const tick of [raise.tick, fired + 15, reloaded + 84]) {
    const sample = samples[tick - 1];
    assert.equal(sample.action.phase, 'aiming');
    assert.equal(sample.pose.walk.blend, 1);
    assert.deepEqual(sample.pose.walk.weights, [0, 1, 0, 0]);
    const timeS = leonWalkTime(sample.pose.walk.cycles, 1, leftClip.duration);
    for (const [name] of aimedUpperPairs) {
      const expected = sourceJointPose(assets, leftClip, name, timeS);
      const actual = new Matrix4().fromArray(sample.upper[name]);
      assert.ok(new Vector3().setFromMatrixPosition(actual).distanceTo(expected.p) < 1e-6);
      assert.ok(new Quaternion().setFromRotationMatrix(actual).normalize().angleTo(expected.q) < 1e-6);
    }
  }
});

test('Leon uses full-body forward travel, layers actions on the moving pose and preserves the shot tick', async () => {
  const assets = loadLeonAssets();
  const leon = createLeonView(assets);
  const model = leon.root.children[0];
  const standingOffsetM = model.position.y;
  assert.equal(standingOffsetM + leon.readSkin().bounds!.min[1], 0);
  const room = await createTestRoom(undefined, manifest);
  const player = createPlayerView(leon);
  const neutral = createInputBuffer().sample(0);
  const events: GameEvent[] = [];
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages,
    sampleInput: (tick) => ({
      ...neutral, tick, moveY: (tick >= 13 && tick <= 132) || tick >= 152 ? 1 : 0,
      aimHeld: tick >= 152, firePressed: tick === 241, reloadPressed: tick === 270,
    }),
    publish: (_state, _input, batch) => { events.push(...batch); },
  });

  const joint = (name: string) => leon.readJoint(name)!;
  const point = (name: string) => new Vector3().setFromMatrixPosition(joint(name));
  const rotation = (name: string) => new Quaternion().setFromRotationMatrix(joint(name)).normalize();
  const samples = Array.from({ length: 365 }, () => {
    const { tick, character, action } = step();
    const pose = room.readActionPose();
    player.draw(character.position, character.yawRad, pose, { x: -10, y: 1.5, z: 5 });
    const rightHand = rotation('R_Arm_Hand');
    return {
      tick, character, action, pose,
      modelOffsetM: model.position.y,
      skinMinYM: leon.readSkin().bounds!.min[1],
      walkFrame: leonWalkTime(pose.walk.cycles, 0, 1.6) * 60,
      leftFoot: point('L_Leg_Toes'), rightFoot: point('R_Leg_Toes'),
      hip: rotation('Hip'), spine: rotation('Spine_2'), shoulder: rotation('R_Arm_Clavicle'),
      rightHand, leftHand: rotation('L_Arm_Hand'),
      grip: point('L_Arm_Hand').sub(point('R_Arm_Hand')).applyQuaternion(rightHand.clone().invert()),
    };
  });
  const out = process.env.LEON_FORWARD_EVIDENCE;
  const at = (tick: number) => samples[tick - 1];
  assert.ok(samples.every(({ modelOffsetM }) => modelOffsetM === standingOffsetM));
  const skinMinYs = samples.map(({ skinMinYM }) => skinMinYM);
  const skinMinYSpanM = Math.max(...skinMinYs) - Math.min(...skinMinYs);
  assert.ok(skinMinYSpanM > 0.005, 'the moving mesh exercises the vertical anchor');
  assert.equal(at(12).pose.walk.blend, 0);
  assert.ok(at(13).pose.walk.blend > 0 && at(13).pose.walk.blend < 1);
  assert.ok(at(20).pose.walk.blend > 0.999);
  assert.ok(at(133).pose.walk.blend > 0 && at(133).pose.walk.blend < 1);
  assert.equal(at(140).pose.walk.blend, 0);
  assert.equal(at(133).pose.walk.cycles, at(132).pose.walk.cycles);
  assert.equal(at(140).pose.walk.cycles, at(132).pose.walk.cycles);
  assert.ok(at(110).pose.walk.cycles > at(100).pose.walk.cycles);
  for (const { tick, pose, character } of samples.slice(20, 132)) {
    const { yawRad, velocity } = character;
    const forwardMps = -Math.sin(yawRad) * velocity.x - Math.cos(yawRad) * velocity.z;
    const distance = character.grounded && forwardMps > 0.1 && forwardMps >= 0.9 * Math.hypot(velocity.x, velocity.z) ? forwardMps / 60 : 0;
    assert.ok(Math.abs((pose.walk.cycles - at(tick - 1).pose.walk.cycles) * 1.75998 - distance) < 1e-6, `distance at ${tick}`);
  }
  const bodyMotion = (['hip', 'spine', 'shoulder', 'rightHand'] as const).map((bone) => Math.max(
    ...samples.slice(20, 132).map((sample) => sample[bone].angleTo(at(30)[bone])),
  ));
  bodyMotion.forEach((angle) => assert.ok(angle > 0.025));
  const aim = at(181);
  const gripDriftM = Math.max(...samples.slice(180, 240).map(({ grip }) => grip.distanceTo(aim.grip)));
  const rightHandDriftRad = Math.max(...samples.slice(180, 240).map(({ rightHand }) => rightHand.angleTo(aim.rightHand)));
  const leftHandDriftRad = Math.max(...samples.slice(180, 240).map(({ leftHand }) => leftHand.angleTo(aim.leftHand)));
  assert.ok(gripDriftM < 0.003, `two-handed grip drift ${gripDriftM} m`);
  assert.ok(rightHandDriftRad > 0.004 && leftHandDriftRad > 0.004,
    `forward stride hand travel ${rightHandDriftRad}, ${leftHandDriftRad} rad`);
  assert.ok(at(245).grip.distanceTo(aim.grip) < 0.045);
  assert.equal(at(256).action.phase, 'aiming');
  assert.ok(at(256).rightHand.angleTo(at(255).rightHand) < 0.035);
  assert.deepEqual(events.filter(({ type }) => type === 'weapon.fired' || type === 'ammo.committed')
    .map((event) => [event.tick, event.order, event.type, 'magazine' in event ? event.magazine : null]), [
    [245, 0, 'weapon.fired', null], [245, 1, 'ammo.committed', 7], [314, 0, 'ammo.committed', 8],
  ]);

  const compareLayer = (tick: number, clip: 'fire' | 'reload') => {
    const { pose, character } = at(tick);
    const draw = (actionClip: typeof clip | null) => {
      player.draw(character.position, character.yawRad, { ...pose, clip: actionClip }, { x: -10, y: 1.5, z: 5 });
      return { foot: point('L_Leg_Toes'), hip: rotation('Hip'), spine: rotation('Spine_2'), rightHand: rotation('R_Arm_Hand'),
        handLocal: joint('R_Arm_Lower').invert().multiply(joint('R_Arm_Hand')) };
    };
    const layered = draw(clip);
    const baseline = draw(null);
    assert.ok(Math.hypot(layered.foot.x - baseline.foot.x, layered.foot.z - baseline.foot.z) < 1e-6);
    assert.ok(layered.hip.angleTo(baseline.hip) < 1e-6);
    assert.ok(layered.rightHand.angleTo(baseline.rightHand) > 0.02);
    if (clip === 'reload') {
      assert.ok(layered.spine.angleTo(baseline.spine) < 1e-6, 'Mask 2 keeps the animated spine');
      return;
    }
    const source = assets.MOTION_DATA.clips.find(({ id, bank }) => bank === 100 && id === 1100)!;
    const hand = source.bones.findIndex(({ name }) => name === 'R_Arm_Hand');
    const track = source.tracks.find(({ bone }) => bone === hand);
    const timeS = source.duration * pose.progress;
    const expectedRotation = new Quaternion().setFromRotationMatrix(baseline.handLocal)
      .multiply(new Quaternion().fromArray(assets.MotionMath.sample(track?.rotation, timeS, [0, 0, 0, 1], true))).normalize();
    const expectedPosition = new Vector3().setFromMatrixPosition(baseline.handLocal)
      .add(new Vector3().fromArray(assets.MotionMath.sample(track?.position, timeS, [0, 0, 0])));
    assert.ok(new Quaternion().setFromRotationMatrix(layered.handLocal).normalize().angleTo(expectedRotation) < 1e-6);
    assert.ok(new Vector3().setFromMatrixPosition(layered.handLocal).distanceTo(expectedPosition) < 1e-6);
  };
  compareLayer(245, 'fire');
  compareLayer(309, 'reload');

  // These toe intervals avoid heel strike and toe-off in the authored 96-frame clip.
  const strideDriftM: number[] = [];
  for (const [jointName, start, end] of [['leftFoot', 42, 70], ['rightFoot', 3, 31]] as const) {
    let plant: Vector3 | undefined;
    for (const sample of samples.slice(20, 132)) {
      if (sample.walkFrame >= start && sample.walkFrame <= end) {
        plant ??= sample[jointName];
        strideDriftM.push(Math.hypot(sample[jointName].x - plant.x, sample[jointName].z - plant.z));
      } else plant = undefined;
    }
  }
  const maxStrideDriftM = Math.max(...strideDriftM);
  assert.ok(strideDriftM.length > 35 && maxStrideDriftM < 0.03);

  const toeStep = (from: number, to: number) => Math.max(...samples.slice(from, to).flatMap((sample) =>
    (['leftFoot', 'rightFoot'] as const).map((foot) => sample[foot].distanceTo(at(sample.tick - 1)[foot]))));
  const startToeStepM = toeStep(12, 20);
  const stopToeStepM = toeStep(132, 140);

  // Keep holding forward into the end wall. Contact must eventually freeze phase and fade out the walk.
  let blocked;
  for (let index = 0; index < 300; index++) blocked = step();
  assert.ok(blocked && Math.hypot(blocked.character.velocity.x, blocked.character.velocity.z) < 0.1);
  assert.equal(room.readActionPose().walk.blend, 0);
  const blockedCycles = room.readActionPose().walk.cycles;
  for (let index = 0; index < 10; index++) step();
  assert.equal(room.readActionPose().walk.cycles, blockedCycles);

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({
      bodyMotion, startToeStepM, stopToeStepM, maxStrideDriftM, gripDriftM, rightHandDriftRad, leftHandDriftRad,
      standingOffsetM, skinMinYSpanM, samples, events,
    }, null, 2) + '\n', 'utf8');
  }
  assert.ok(startToeStepM < 0.14, `start toe step ${startToeStepM} m`);
  assert.ok(stopToeStepM < 0.14, `stop toe step ${stopToeStepM} m`);
});

async function checkDirectionalGait(aimedRun: boolean, out: string | undefined) {
  const floor = { id: 'floor', size: { x: 14, y: 0.2, z: 14 }, position: { x: 0, y: -0.1, z: 0 } };
  const wall = { id: 'wall', size: { x: 0.16, y: 3, z: 10 }, position: { x: 2.15, y: 1.5, z: 0 } };
  const level: LevelDefinition = {
    id: 'directional-gait', version: 1, spawn: { position: { x: 0, y: 0.025, z: 0 }, yawRad: 0 },
    render: [floor, wall].map((box) => ({ ...box, kind: 'box', yawRad: 0, color: '#718284' })),
    colliders: [floor, wall].map(({ id, position: center, size }) => ({ id, center, size, yawRad: 0 })),
    doors: [], targets: [],
  };
  const room = await createTestRoom(level, manifest);
  const assets = loadLeonAssets();
  const leon = createLeonView(assets);
  const player = createPlayerView(leon);
  const neutral = createInputBuffer().sample(0);
  const directions = [
    ['W', 42, 0, 1], ['A', 42, -1, 0], ['S', 42, 0, -1], ['D', 42, 1, 0],
    ['W+D', 42, 1, 1], ['S+A', 42, -1, -1], ['W+A', 42, -1, 1], ['S+D', 42, 1, -1],
    ['reverse-A', 36, -1, 0], ['reverse-D', 36, 1, 0],
  ] as const;
  const segments: readonly (readonly [string, number, number, number, boolean?])[] = [
    ['idle', 30, 0, 0], ...directions, ['wall', 104, 1, 0],
    ...(aimedRun ? [['leave-wall', 36, -1, 0], ['stop', 24, 0, 0]] as const :
      [['leave-wall', 18, -1, 0, false], ['raise-moving', 32, -1, 0, true], ['lower-moving', 24, -1, 0, false]] as const),
  ];
  const course = segments.flatMap(([label, count, moveX, moveY, aimHeld = aimedRun]) =>
    Array.from({ length: count }, () => ({ label, moveX, moveY, aimHeld })));
  const events: GameEvent[] = [];
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages, sampleInput: (tick) => ({ ...neutral, ...course[tick - 1], tick }),
    publish(_state, _input, emitted) { events.push(...emitted); },
  });
  const footNames = ['L', 'R'] as const;
  const joint = (name: string) => leon.readJoint(name)!;
  const point = (name: string) => new Vector3().setFromMatrixPosition(joint(name));
  const upper = () => {
    const hands = footNames.map((side) => new Quaternion().setFromRotationMatrix(joint(`${side}_Arm_Hand`)).normalize());
    const grip = point('L_Arm_Hand').sub(point('R_Arm_Hand')).applyQuaternion(hands[1].clone().invert());
    const shoulders = point('L_Arm_Clavicle').sub(point('R_Arm_Clavicle')).normalize();
    return { hands, grip, shoulders };
  };
  const samples = course.map(({ label }) => {
    const { tick, character, action } = step();
    const { position, yawRad } = character;
    const pose = room.readActionPose();
    const { walk } = pose;
    player.draw(position, yawRad, pose, { x: -10, y: 1.5, z: 5 });
    player.root.updateWorldMatrix(true, false);
    const inverse = player.root.matrixWorld.clone().invert();
    const legs = footNames.map((side) => ['Upper', 'Lower', 'Ankle', 'Toes'].map((name) => {
      const matrix = new Matrix4().multiplyMatrices(inverse, joint(`${side}_Leg_${name}`));
      return { position: new Vector3().setFromMatrixPosition(matrix), rotation: new Quaternion().setFromRotationMatrix(matrix).normalize() };
    }));
    const toes = footNames.map((side) => point(`${side}_Leg_Toes`));
    const hip = new Quaternion().setFromRotationMatrix(joint('Hip')).normalize();
    return { label, tick, character, action, pose, walk, legs, toes, hip, ...upper(), collision: room.readMovementDebug() };
  });

  const byLabel = (label: string) => samples.filter((sample) => sample.label === label);
  const sourceTracks = LEON_WALK.map(({ id }) => {
    const clip = assets.MOTION_DATA.clips.find((motion) => motion.bank === 100 && motion.id === id)!;
    return { ...clip, byName: new Map(clip.bones.map((bone, index) => [
      bone.name, { bone, track: clip.tracks.find(({ bone }) => bone === index) },
    ])) };
  });
  const joints = ['Upper', 'Lower', 'Ankle', 'Foot', 'Toes'];
  const pairs = [['Hip', 'root'], ...footNames.flatMap((side) => joints.map((name, index) =>
    [`${side}_Leg_${name}`, index ? `${side}_Leg_${joints[index - 1]}` : 'Hip']))];
  const walkingPairs = aimedRun ? [...pairs, ...aimedUpperPairs] : pairs;
  const perDirection = [];
  for (const [label, , x, y] of directions.slice(0, 8)) {
    const run = byLabel(label);
    const start = run[0].character.position;
    const end = run.at(-1)!.character.position;
    const delta = new Vector3(end.x - start.x, 0, end.z - start.z);
    assert.ok(delta.length() > 0.8, label);
    assert.ok(delta.normalize().dot(new Vector3(x, 0, -y).normalize()) > 0.99, label);
    assert.ok(run.every(({ action }) => action.aiming === aimedRun));

    const rawWeights = [Math.max(y, 0), Math.max(-x, 0), Math.max(-y, 0), Math.max(x, 0)]
      .map((component, index) => component / LEON_WALK[index].distanceM);
    const sum = rawWeights.reduce((total, weight) => total + weight, 0);
    const clipWeights = rawWeights.flatMap((weight, index) => weight ? [{ index, weight: weight / sum }] : []);
    const steady = run.slice(22).filter(({ walk }) => walk.blend === 1 && walk.weights.every((weight, i) => rawWeights[i] > 0 ?
      Math.abs(weight - rawWeights[i] / sum) < 0.005 : weight === 0));
    assert.ok(steady.length >= 6, `${label} reaches the expected steady clip weights`);
    let positionErrorM = 0;
    let rotationErrorRad = 0;
    for (const sample of steady.filter((_, i) => i % 3 === 0)) {
      const { position, yawRad } = sample.character;
      player.draw(position, yawRad, sample.pose, { x: -10, y: 1.5, z: 5 });
      for (const [name, parent] of walkingPairs) {
        const expected = clipWeights.map(({ index }) => {
          const clip = sourceTracks[index];
          const time = leonWalkTime(sample.walk.cycles, index, clip.duration);
          const { bone, track } = clip.byName.get(name)!;
          return {
            position: new Vector3().fromArray(assets.MotionMath.sample(track?.position, time, bone.position)),
            rotation: new Quaternion().fromArray(assets.MotionMath.sample(track?.rotation, time, bone.rotation, true)),
          };
        });
        const [first, second] = expected;
        if (second) {
          const weight = sample.walk.weights[clipWeights[1].index];
          first.position.lerp(second.position, weight);
          first.rotation.slerp(second.rotation, weight);
        }
        const actual = joint(parent).invert().multiply(joint(name));
        positionErrorM = Math.max(positionErrorM, new Vector3().setFromMatrixPosition(actual).distanceTo(first.position));
        rotationErrorRad = Math.max(rotationErrorRad,
          new Quaternion().setFromRotationMatrix(actual).normalize().angleTo(first.rotation.normalize()));
      }
    }
    perDirection.push({ label, clips: clipWeights.map(({ index, weight }) => ({ id: LEON_WALK[index].id, weight })),
      positionErrorM, rotationErrorRad });
  }

  const toeStep = (sample: typeof samples[number], previous: typeof samples[number]) =>
    Math.max(...sample.toes.map((toe, side) => toe.distanceTo(previous.toes[side])));
  for (const [index, sample] of samples.entries()) {
    const previous = samples[index - 1];
    if (!previous) continue;
    const { yawRad, velocity } = sample.character;
    const speedMps = Math.hypot(velocity.x, velocity.z);
    const advance = sample.walk.cycles - previous.walk.cycles;
    const right = Math.cos(yawRad) * velocity.x - Math.sin(yawRad) * velocity.z;
    const forward = -Math.sin(yawRad) * velocity.x - Math.cos(yawRad) * velocity.z;
    if (!sample.character.grounded || speedMps <= 0.1) assert.equal(advance, 0);
    else assert.ok(Math.abs(advance * 60 - leonWalkBlend(right, forward).cyclesPerSecond) < 1e-8, `phase at ${sample.tick}`);
  }

  const reversal = byLabel('reverse-D')[0];
  const before = samples[reversal.tick - 2];
  assert.ok(reversal.walk.cycles > before.walk.cycles && reversal.walk.cycles - before.walk.cycles < 0.05);
  assert.deepEqual(before.walk.weights, [0, 1, 0, 0]);
  assert.ok(reversal.walk.weights[1] > 0 && reversal.walk.weights[3] > 0);
  const reversalToeStepM = Math.max(...byLabel('reverse-D').slice(0, 8)
    .map((sample) => toeStep(sample, samples[sample.tick - 2])));

  const wallSamples = byLabel('wall');
  const blocked = wallSamples.slice(-12);
  assert.ok(blocked.every(({ character, walk }) => Math.hypot(character.velocity.x, character.velocity.z) < 0.1 &&
    walk.cycles === blocked[0].walk.cycles && walk.blend === 0));
  assert.ok(wallSamples.some(({ collision }) => collision?.contacts.some(({ colliderId }) => colliderId === wall.id)));
  // A brief interruption may resume movement. Measure the fade into the final blocked phase.
  const stopIndex = wallSamples.findIndex(({ character, walk }) =>
    walk.cycles === blocked[0].walk.cycles && Math.hypot(character.velocity.x, character.velocity.z) < 0.1);
  assert.ok(stopIndex >= 0);
  const wallStop = wallSamples[stopIndex];
  const wallFade = wallSamples.slice(stopIndex, stopIndex + 8);
  assert.equal(wallFade.length, 8);
  assert.ok(wallStop.walk.blend > 0 && wallStop.walk.blend < 1);
  assert.equal(wallFade.at(-1)!.walk.blend, 0);
  const wallFadeToeTravelM = Math.max(...wallFade.map((sample) => toeStep(sample, wallStop)));
  assert.ok(wallFade.every(({ walk }) => walk.cycles === wallStop.walk.cycles && walk.weights === wallStop.walk.weights));

  const stop = byLabel('stop');
  let suddenStop: { tick: number; fadeTicks: number; toeTravelM: number } | undefined;
  if (stop.length) {
    const stopped = stop.find(({ character }) => Math.hypot(character.velocity.x, character.velocity.z) <= 0.1)!;
    const settled = stop.find(({ walk }) => walk.blend === 0)!;
    const fade = stop.filter(({ tick }) => tick >= stopped.tick && tick <= settled.tick);
    suddenStop = { tick: stopped.tick, fadeTicks: settled.tick - stopped.tick,
      toeTravelM: Math.max(...fade.map((sample) => toeStep(sample, stopped))) };
    assert.ok(suddenStop.fadeTicks > 0 && suddenStop.fadeTicks <= 8);
    assert.ok(fade.every(({ walk }) => walk.cycles === stopped.walk.cycles && walk.weights === stopped.walk.weights));
  }

  const idle = byLabel('idle').at(-1)!;
  const { position, yawRad } = idle.character;
  player.draw(position, yawRad, { ...idle.pose, aim: { ...idle.pose.aim, idleTimeS: 0, stationaryBlend: 0 } }, { x: -10, y: 1.5, z: 5 });
  const stance = upper();
  const steadyStance = aimedRun ? samples.filter(({ walk, pose }) => walk.blend === 1 && pose.aim.stationaryBlend === 0) :
    samples.filter(({ action, walk }) => action.phase === 'ready' && walk.blend > 0.999 && walk.weights[0] < 0.85);
  const shoulderDriftRad = Math.max(...steadyStance.map(({ shoulders }) => shoulders.angleTo(stance.shoulders)));
  const gripDriftM = Math.max(...steadyStance.map(({ grip }) => grip.distanceTo(stance.grip)));
  const handDriftRad = Math.max(...steadyStance.flatMap(({ hands }) => hands.map((hand, side) => hand.angleTo(stance.hands[side]))));
  const hipTravelRad = Math.max(...steadyStance.map(({ hip }) => hip.angleTo(idle.hip)));
  const transitionSamples = [...byLabel('raise-moving'), ...byLabel('lower-moving')];
  const transitions = transitionSamples.map((sample) => {
    const previous = samples[sample.tick - 2];
    return {
      tick: sample.tick, phase: sample.action.phase, aiming: sample.action.aiming,
      advance: sample.walk.cycles - previous.walk.cycles, toeStepM: toeStep(sample, previous),
      shoulderStepRad: previous.shoulders.angleTo(sample.shoulders),
    };
  });
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ reversalToeStepM, wallFadeToeTravelM,
      shoulderDriftRad, gripDriftM, handDriftRad, hipTravelRad, perDirection, transitions, suddenStop, samples, events }, null, 2) + '\n');
  }
  for (const { label, positionErrorM, rotationErrorRad } of perDirection) {
    assert.ok(positionErrorM < 1e-6 && rotationErrorRad < 1e-5, `${label} source pose error: ${positionErrorM} m, ${rotationErrorRad} rad`);
  }
  assert.ok(reversalToeStepM < 0.14, `reversal toe step ${reversalToeStepM} m`);
  assert.ok(hipTravelRad > 0.1);
  if (aimedRun) {
    assert.ok(gripDriftM < 0.003, `aimed grip drift ${gripDriftM} m`);
  } else {
    assert.ok(shoulderDriftRad < 1e-5 && gripDriftM < 1e-5 && handDriftRad < 1e-5);
  }
  if (!aimedRun) {
    assert.equal(byLabel('raise-moving').at(-1)!.action.phase, 'aiming');
    assert.equal(byLabel('lower-moving').at(-1)!.action.phase, 'ready');
    assert.ok(transitions.every(({ advance, toeStepM, shoulderStepRad }) =>
      advance > 0 && toeStepM < 0.18 && shoulderStepRad < 0.2));
    assert.ok(transitionSamples.every(({ walk }) => walk.blend === 1 && walk.weights[1] > 0.97));
    for (const { pose, character } of transitionSamples.filter((_, i) => i % 4 === 0)) {
      const readLowerBody = () => {
        const inverse = joint('root').invert();
        return pairs.map(([name]) => inverse.clone().multiply(joint(name)).toArray());
      };
      const draw = (layer: typeof pose) => player.draw(character.position, character.yawRad, layer, { x: -10, y: 1.5, z: 5 });
      draw(pose);
      const aimed = readLowerBody();
      draw({ ...pose, lift: 0, clip: null });
      const ready = readLowerBody();
      assert.ok(aimed.every((matrix, i) => matrix.every((element, j) => Math.abs(element - ready[i][j]) < 1e-6)));
    }
  }
}

test('Leon samples the decoded aimed gait in eight directions and blends through reversal, stop and wall contact', async () => {
  await checkDirectionalGait(true, process.env.LEON_DIRECTION_EVIDENCE);
});

test('Leon ready directional gait survives diagonals, reversal, wall contact and aiming while moving', async () => {
  await checkDirectionalGait(false, process.env.LEON_READY_EVIDENCE);
});

test('Leon follows the full fixed route without altering collisions or ordered weapon and ammo events', async () => {
  const clips = await rehearsalClips();
  const weapon = await loadWeapon();
  const leon = createLeonView(loadLeonAssets(), weapon);
  const standingOffsetM = leon.root.children[0].position.y;
  async function run(useLeon: boolean) {
    const room = await createTestRoom(undefined, manifest);
    const graybox = createActionView(clips);
    assert.ok(graybox);
    const player = createPlayerView(graybox);
    room.scene.remove(room.avatar);
    room.scene.add(player.root);
    if (useLeon) player.useAppearance(leon);
    const events: GameEvent[] = [];
    const inputs: InputSnapshot[] = [];
    const ticks = [];
    const checkpoints = [];
    const drawSamples = new Map<string, number[]>();
    const neutral = createInputBuffer().sample(0);
    let controls: Partial<InputSnapshot> = {};
    const step = createSimulation(room.initial, room.queries, {
      ...room.stages,
      sampleInput: (tick) => ({ ...neutral, ...controls, tick }),
      publish(state, input, batch) {
        inputs.push(input);
        events.push(...batch);
        ticks.push({ ...state, movement: room.readMovementDebug() });
      },
    });
    for (const [label, count, input] of testRoomRoute) {
      controls = input;
      for (let i = 0; i < count; i++) {
        const state = step();
        const { position: feet, yawRad } = state.character;
        const pose = room.readActionPose();
        player.draw(feet, yawRad, pose, state.camera.position);
        assert.deepEqual(player.root.position.toArray(), [feet.x, feet.y, feet.z]);
        assert.equal(player.root.rotation.y, yawRad);
        if (useLeon) assert.equal(leon.root.children[0].position.y, standingOffsetM);
        if (i !== count - 1) continue;
        const sample = { label, tick: state.tick, feet, yawRad, pose, visible: player.root.visible };
        checkpoints.push(sample);
        if (!useLeon || !player.root.visible) continue;

        const skin = leon.readSkin();
        assert.equal(leon.root.parent, player.root);
        assert.equal(skin.parts, 6);
        assert.equal(skin.vertices, 72346);
        assert.ok(skin.bindingError < 1e-6);
        assert.ok(skin.bounds);
        const height = skin.bounds.max[1] - skin.bounds.min[1];
        assert.ok(height > 1.4 && height < 2);
        leon.root.updateWorldMatrix(true, true);
        const direction = new Vector3(0, 0, 1).transformDirection(leon.root.children[0].matrixWorld);
        assert.ok(direction.distanceTo(new Vector3(-Math.sin(yawRad), 0, -Math.cos(yawRad))) < 1e-12);
        if (weapon) readGrip(leon);
        const samples: number[] = [];
        leon.root.traverse((node) => {
          if (!(node instanceof Mesh)) return;
          const positions = node.geometry.getAttribute('position').array;
          const normals = node.geometry.getAttribute('normal').array;
          const indices = node.geometry.index?.array;
          assert.ok(positions instanceof Float32Array, 'positions belong to the renderer realm');
          assert.ok(normals instanceof Float32Array, 'normals belong to the renderer realm');
          assert.ok(indices instanceof Uint16Array || indices instanceof Uint32Array, 'indices belong to the renderer realm');
          for (let j = 0; j < positions.length; j += 37) samples.push(positions[j]);
        });
        drawSamples.set(label, samples);
      }
    }
    return { ticks, events, inputs, checkpoints, drawSamples };
  }

  const graybox = await run(false);
  const modeled = await run(true);
  assert.deepEqual(modeled.ticks, graybox.ticks);
  assert.deepEqual(modeled.events, graybox.events);
  assert.deepEqual(modeled.inputs, reference.inputs);
  assert.deepEqual(modeled.events, reference.events);
  assert.deepEqual(modeled.checkpoints, graybox.checkpoints);
  const doorCollider = testRoom.doors[0].colliderId;
  assert.ok(modeled.ticks.some((tick) => tick.movement?.contacts.some((hit) => hit.colliderId === doorCollider)));
  assert.deepEqual(modeled.events.filter((event) => event.type === 'ammo.committed')
    .map((event) => [event.magazine, event.reserve]), [[7, 16], [8, 15]]);
  assert.equal(modeled.events.filter((event) => event.type === 'weapon.fired').length, 1);
  assert.equal(modeled.events.filter((event) => event.type === 'target.hit').length, 1);
  assert.ok(modeled.checkpoints.find(({ label }) => label === 'next-room')!.feet.z < -0.75);
  assert.ok(modeled.checkpoints.at(-1)!.feet.z > 0.5);
  for (const [a, b] of [['corner', 'by-target'], ['raise-start', 'raise-mid'],
    ['fire-start', 'shot'], ['reload-start', 'reload-commit']]) {
    assert.ok(modeled.drawSamples.has(a) && modeled.drawSamples.has(b), `visible at ${a} and ${b}`);
    assert.notDeepEqual(modeled.drawSamples.get(a), modeled.drawSamples.get(b), `deformed vertices changed from ${a} to ${b}`);
  }

  if (process.env.LEON_ROUTE_EVIDENCE) {
    const out = process.env.LEON_ROUTE_EVIDENCE;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({
      tickCount: modeled.ticks.length, events: modeled.events, checkpoints: modeled.checkpoints,
      ticks: modeled.ticks, appearancesEqual: true, weapon: weapon ? 'wp0100' : null,
    }, null, 2) + '\n', 'utf8');
  }
});
