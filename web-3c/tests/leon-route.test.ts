import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import reference from '../fixtures/route.replay.json' with { type: 'json' };
import { createActionView } from '../src/action-view.ts';
import { loadClipAssets } from '../src/clip-assets.ts';
import type { GameEvent, InputSnapshot, LevelDefinition } from '../src/contracts.ts';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom, testRoom } from '../src/level.ts';
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

function loadLeon(omitStrafeId?: number) {
  const context = createContext({ window: {} }) as unknown as
    Pick<LeonAssets, 'MotionMath' | 'LeonSkinning'> & { window: Pick<LeonAssets, 'MODEL_DATA' | 'MOTION_DATA' | 'MASK_DATA'> };
  for (const file of ['model.js', 'motions.js', 'masks.js', 'math.js', 'skinning.js']) {
    runInContext(readFileSync(new URL(file, source), 'utf8'), context, { filename: file });
  }
  return createLeonView({
    ...context.window,
    MOTION_DATA: {
      clips: context.window.MOTION_DATA.clips.filter(({ bank, id }) => bank !== 100 || id !== omitStrafeId),
    },
    MotionMath: context.MotionMath,
    LeonSkinning: context.LeonSkinning,
  });
}

test('Leon uses full-body forward travel with a short stop blend, stable aimed hands and the original shot tick', async () => {
  const leon = loadLeon();
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
      walkFrame: ((0.70 + 1.6 * pose.walk.cycles) % 1.6) * 60,
      leftFoot: point('L_Leg_Toes'), rightFoot: point('R_Leg_Toes'),
      hip: rotation('Hip'), spine: rotation('Spine_2'), shoulder: rotation('R_Arm_Clavicle'),
      rightHand, leftHand: rotation('L_Arm_Hand'),
      grip: point('L_Arm_Hand').sub(point('R_Arm_Hand')).applyQuaternion(rightHand.clone().invert()),
    };
  });
  const out = process.env.LEON_FORWARD_EVIDENCE;
  const at = (tick: number) => samples[tick - 1];
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
  assert.ok(gripDriftM < 1e-5 && rightHandDriftRad < 1e-5 && leftHandDriftRad < 1e-5);
  assert.ok(at(245).rightHand.angleTo(aim.rightHand) > 0.02);
  assert.ok(at(245).grip.distanceTo(aim.grip) < 0.045);
  assert.ok(at(256).rightHand.angleTo(aim.rightHand) < 1e-5);
  assert.deepEqual(events.filter(({ type }) => type === 'weapon.fired' || type === 'ammo.committed')
    .map((event) => [event.tick, event.order, event.type, 'magazine' in event ? event.magazine : null]), [
    [245, 0, 'weapon.fired', null], [245, 1, 'ammo.committed', 7], [314, 0, 'ammo.committed', 8],
  ]);

  const compareLayer = (tick: number, clip: 'fire' | 'reload') => {
    const { pose, character } = at(tick);
    const draw = (actionClip: typeof clip | null) => {
      player.draw(character.position, character.yawRad, { ...pose, clip: actionClip }, { x: -10, y: 1.5, z: 5 });
      return { foot: point('L_Leg_Toes'), hip: rotation('Hip'), rightHand: rotation('R_Arm_Hand') };
    };
    const layered = draw(clip);
    const baseline = draw(null);
    assert.ok(Math.hypot(layered.foot.x - baseline.foot.x, layered.foot.z - baseline.foot.z) < 1e-6);
    assert.ok(layered.hip.angleTo(baseline.hip) < 1e-6);
    assert.ok(layered.rightHand.angleTo(baseline.rightHand) > 0.02);
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

  const supportDrift = (name: 'leftFoot' | 'rightFoot', from: number, to: number) => {
    const anchor = at(from)[name];
    return Math.max(...samples.slice(from, to).map(({ [name]: foot }) => Math.hypot(foot.x - anchor.x, foot.z - anchor.z)));
  };
  const startDriftM = supportDrift('leftFoot', 12, 20);
  const stopDriftM = supportDrift('rightFoot', 132, 140);
  assert.ok(startDriftM < 0.04, `start support drift ${startDriftM} m`);
  assert.ok(stopDriftM < 0.04, `stop support drift ${stopDriftM} m`);

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
      bodyMotion, startDriftM, stopDriftM, maxStrideDriftM, gripDriftM, rightHandDriftRad, leftHandDriftRad, samples, events,
    }, null, 2) + '\n', 'utf8');
  }
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
  const leon = loadLeon();
  const player = createPlayerView(leon);
  const neutral = createInputBuffer().sample(0);
  const directions = [
    ['W', 42, 0, 1], ['A', 42, -1, 0], ['S', 42, 0, -1], ['D', 42, 1, 0],
    ['W+D', 42, 1, 1], ['S+A', 42, -1, -1], ['reverse-A', 36, -1, 0], ['reverse-D', 36, 1, 0],
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
    const knees = footNames.map((side) => point(`${side}_Leg_Lower`));
    const hip = new Quaternion().setFromRotationMatrix(joint('Hip')).normalize();
    const hands = footNames.map((side) => new Quaternion().setFromRotationMatrix(joint(`${side}_Arm_Hand`)).normalize());
    const grip = point('L_Arm_Hand').sub(point('R_Arm_Hand')).applyQuaternion(hands[1].clone().invert());
    const shoulders = point('L_Arm_Clavicle').sub(point('R_Arm_Clavicle')).normalize();
    return { label, tick, character, action, pose, walk, legs, toes, knees, hip, hands, grip, shoulders, collision: room.readMovementDebug() };
  });

  if (out) mkdirSync(dirname(out), { recursive: true });
  const byLabel = (label: string) => samples.filter((sample) => sample.label === label);
  const perDirection = [];
  for (const [label, , x, y] of directions) {
    const run = byLabel(label);
    const start = run[0].character.position;
    const end = run.at(-1)!.character.position;
    const delta = new Vector3(end.x - start.x, 0, end.z - start.z);
    assert.ok(delta.length() > 0.8, label);
    assert.ok(delta.normalize().dot(new Vector3(x, 0, -y).normalize()) > 0.99, label);
    assert.ok(run.every(({ action }) => action.aiming === aimedRun));
    if (label === 'W') continue;
    const gait = run.slice(label === 'A' ? 8 : 0);
    perDirection.push({ label, feet: [0, 1].map((side) => {
      const toeY = gait.map(({ legs }) => legs[side][3].position.y);
      const thigh = gait[0].legs[side][0].rotation;
      return { liftM: Math.max(...toeY) - Math.min(...toeY), thighRad: Math.max(...gait.map(({ legs }) => legs[side][0].rotation.angleTo(thigh))) };
    }) });
  }

  const plantedDriftM: number[] = [];
  const planar = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
  for (const side of [0, 1]) {
    let contact: Vector3 | undefined;
    for (const sample of samples) {
      if (sample.walk.directional > 0.999 && sample.walk.blend > 0.999 && sample.walk.feet[side].planted) {
        contact ??= sample.toes[side];
        plantedDriftM.push(planar(contact, sample.toes[side]));
      } else contact = undefined;
    }
  }
  const maxPlantedDriftM = Math.max(...plantedDriftM);
  const steady = samples.filter(({ walk }) => walk.directional > 0.999 && walk.blend > 0.999);
  const minToeSpacingM = Math.min(...steady.map(({ legs }) => legs[1][3].position.x - legs[0][3].position.x));
  for (const [index, sample] of samples.entries()) {
    const previous = samples[index - 1];
    if (!previous) continue;
    const { yawRad, velocity } = sample.character;
    const speedMps = Math.hypot(velocity.x, velocity.z);
    const projectedMps = -Math.sin(yawRad) * velocity.x - Math.cos(yawRad) * velocity.z;
    const traveled = (sample.walk.directional === 0 ? projectedMps : speedMps) / 60;
    const advance = sample.walk.cycles - previous.walk.cycles;
    if (!sample.character.grounded || speedMps <= 0.1) assert.equal(advance, 0);
    else assert.ok(advance >= traveled / 1.76 - 1e-6 && advance <= traveled / 0.50 + 1e-6, `phase at ${sample.tick}`);
  }
  const reversal = byLabel('reverse-D')[0];
  const before = samples[reversal.tick - 2];
  assert.ok(reversal.walk.cycles > before.walk.cycles && reversal.walk.cycles - before.walk.cycles < 0.085);
  const retained = [0, 1].filter((side) => before.walk.feet[side].planted && reversal.walk.feet[side].planted);
  assert.ok(retained.length > 0, 'at least one support foot survives the reversal');
  const reversalDriftM = Math.max(...retained.map((side) => planar(before.toes[side], reversal.toes[side])));

  const blocked = byLabel('wall').slice(-12);
  assert.ok(blocked.every(({ character, walk }) => Math.hypot(character.velocity.x, character.velocity.z) < 0.1 &&
    walk.cycles === blocked[0].walk.cycles && walk.blend === 0));
  assert.ok(byLabel('wall').some(({ collision }) => collision?.contacts.some(({ colliderId }) => colliderId === wall.id)));
  const wallStop = byLabel('wall').find(({ walk }) => walk.blend < 0.999)!;
  const wallFade = samples.slice(wallStop.tick - 1, wallStop.tick + 7);
  const wallDriftM = Math.max(...wallFade.flatMap((sample) => [0, 1].filter((side) => wallStop.walk.feet[side].planted)
    .map((side) => planar(wallStop.toes[side], sample.toes[side]))));
  assert.ok(wallFade.every(({ walk }) => walk.cycles === wallStop.walk.cycles));

  const stop = byLabel('stop');
  let suddenStop: { tick: number; fadeTicks: number; supportDriftM: number } | undefined;
  if (stop.length) {
    const stopped = stop.find(({ character }) => Math.hypot(character.velocity.x, character.velocity.z) <= 0.1)!;
    const settled = stop.find(({ walk }) => walk.blend === 0)!;
    const fade = stop.filter(({ tick }) => tick >= stopped.tick && tick <= settled.tick);
    const support = [0, 1].filter((side) => stopped.walk.feet[side].planted);
    suddenStop = { tick: stopped.tick, fadeTicks: settled.tick - stopped.tick,
      supportDriftM: Math.max(...fade.flatMap(({ toes }) => support.map((side) => planar(stopped.toes[side], toes[side])))) };
    assert.ok(support.length > 0 && suddenStop.fadeTicks > 0 && suddenStop.fadeTicks <= 8);
    assert.ok(fade.every(({ walk }) => walk.cycles === stopped.walk.cycles));
    assert.ok(suddenStop.supportDriftM < 0.025, `sudden stop drift ${suddenStop.supportDriftM} m`);
  }

  const stance = byLabel('idle').at(-1)!;
  const steadyStance = aimedRun ? samples.slice(30) : steady.filter(({ action }) => action.phase === 'ready');
  const shoulderDriftRad = Math.max(...steadyStance.map(({ shoulders }) => shoulders.angleTo(stance.shoulders)));
  const gripDriftM = Math.max(...steadyStance.map(({ grip }) => grip.distanceTo(stance.grip)));
  const handDriftRad = Math.max(...steadyStance.flatMap(({ hands }) => hands.map((hand, side) => hand.angleTo(stance.hands[side]))));
  const hipTravelRad = Math.max(...steadyStance.map(({ hip }) => hip.angleTo(stance.hip)));
  const transitionSamples = [...byLabel('raise-moving'), ...byLabel('lower-moving')];
  const transitions = transitionSamples.map((sample) => {
    const previous = samples[sample.tick - 2];
    const support = [0, 1].filter((side) => previous.walk.feet[side].planted && sample.walk.feet[side].planted);
    return {
      tick: sample.tick, phase: sample.action.phase, aiming: sample.action.aiming, pace: sample.walk.pace,
      advance: sample.walk.cycles - previous.walk.cycles, support,
      supportDriftM: Math.max(0, ...support.map((side) => planar(previous.toes[side], sample.toes[side]))),
      shoulderStepRad: previous.shoulders.angleTo(sample.shoulders),
    };
  });
  const clipDeltasM = [];
  if (aimedRun) {
    for (const [label, id] of [['A', 122], ['D', 126]] as const) {
      const fallback = loadLeon(id);
      const fallbackPlayer = createPlayerView(fallback);
      let deltaM = 0;
      for (const sample of byLabel(label).slice(12).filter((_, index) => index % 5 === 0)) {
        const { position, yawRad } = sample.character;
        fallbackPlayer.draw(position, yawRad, sample.pose, { x: -10, y: 1.5, z: 5 });
        footNames.forEach((side, index) => {
          const knee = new Vector3().setFromMatrixPosition(fallback.readJoint(`${side}_Leg_Lower`)!);
          deltaM = Math.max(deltaM, knee.distanceTo(sample.knees[index]));
        });
      }
      clipDeltasM.push({ label, id, deltaM });
    }
  }
  if (out) {
    writeFileSync(out, JSON.stringify({ maxPlantedDriftM, reversalDriftM, wallDriftM, minToeSpacingM,
      shoulderDriftRad, gripDriftM, handDriftRad, hipTravelRad, clipDeltasM, perDirection, transitions, suddenStop, samples, events }, null, 2) + '\n');
  }
  assert.ok(minToeSpacingM > 0.075, `toe spacing ${minToeSpacingM} m`);
  clipDeltasM.forEach(({ label, id, deltaM }) => assert.ok(deltaM > 0.025, `${label} uses the 100/${id} lower-body pose`));
  for (const { label, feet } of perDirection) feet.forEach(({ liftM, thighRad }, index) => {
    assert.ok(liftM > 0.055, `${label} foot ${index} lifts`);
    assert.ok(thighRad > 0.12, `${label} thigh ${index} travels`);
  });
  assert.ok(plantedDriftM.length > 150 && maxPlantedDriftM < 0.055, `planted drift ${maxPlantedDriftM} m`);
  assert.ok(reversalDriftM < 0.025, `reversal drift ${reversalDriftM} m`);
  assert.ok(wallDriftM < 0.015, `wall support drift ${wallDriftM} m`);
  assert.ok(hipTravelRad > 0.1);
  assert.ok(shoulderDriftRad < 1e-5 && gripDriftM < 1e-5 && handDriftRad < 1e-5);
  if (!aimedRun) {
    assert.equal(byLabel('raise-moving').at(-1)!.action.phase, 'aiming');
    assert.equal(byLabel('lower-moving').at(-1)!.action.phase, 'ready');
    assert.ok(transitions.every(({ advance, support, supportDriftM, shoulderStepRad }) =>
      advance > 0 && support.length > 0 && supportDriftM < 0.025 && shoulderStepRad < 0.2));
    assert.ok(transitionSamples.every(({ walk }) => walk.blend > 0.999 && walk.directional > 0.999));
    assert.ok(byLabel('raise-moving').at(-1)!.walk.pace < 0.05);
    assert.ok(byLabel('lower-moving').at(-1)!.walk.pace > 0.95);
  }
}

test('Leon uses the decoded aimed strafe clips and resumes support through reversal, sudden stop and wall contact', async () => {
  await checkDirectionalGait(true, process.env.LEON_DIRECTION_EVIDENCE);
});

test('Leon ready directional gait survives diagonals, reversal, wall contact and aiming while moving', async () => {
  await checkDirectionalGait(false, process.env.LEON_READY_EVIDENCE);
});

test('Leon follows the full fixed route without altering collisions or ordered weapon and ammo events', async () => {
  const clips = await rehearsalClips();
  const leon = loadLeon();
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
        assert.equal(leon.root.children[0].position.y + skin.bounds.min[1], 0);
        leon.root.updateWorldMatrix(true, true);
        const direction = new Vector3(0, 0, 1).transformDirection(leon.root.children[0].matrixWorld);
        assert.ok(direction.distanceTo(new Vector3(-Math.sin(yawRad), 0, -Math.cos(yawRad))) < 1e-12);
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
      ticks: modeled.ticks, appearancesEqual: true,
    }, null, 2) + '\n', 'utf8');
  }
});
