import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { Mesh, Quaternion, Vector3 } from 'three';
import reference from '../fixtures/route.replay.json' with { type: 'json' };
import { createActionView } from '../src/action-view.ts';
import { loadClipAssets } from '../src/clip-assets.ts';
import type { GameEvent, InputSnapshot } from '../src/contracts.ts';
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

function loadLeon() {
  const context = createContext({ window: {} }) as unknown as
    Pick<LeonAssets, 'MotionMath' | 'LeonSkinning'> & { window: Pick<LeonAssets, 'MODEL_DATA' | 'MOTION_DATA' | 'MASK_DATA'> };
  for (const file of ['model.js', 'motions.js', 'masks.js', 'math.js', 'skinning.js']) {
    runInContext(readFileSync(new URL(file, source), 'utf8'), context, { filename: file });
  }
  return createLeonView({
    ...context.window,
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
      walkFrame: ((0.70 + 1.6 * pose.forwardDistanceM / 1.75998) % 1.6) * 60,
      leftFoot: point('L_Leg_Toes'), rightFoot: point('R_Leg_Toes'),
      hip: rotation('Hip'), spine: rotation('Spine_2'), shoulder: rotation('R_Arm_Clavicle'),
      rightHand, leftHand: rotation('L_Arm_Hand'),
      grip: point('L_Arm_Hand').sub(point('R_Arm_Hand')).applyQuaternion(rightHand.clone().invert()),
    };
  });
  const out = process.env.LEON_FORWARD_EVIDENCE;
  const at = (tick: number) => samples[tick - 1];
  assert.equal(at(12).pose.forwardBlend, 0);
  assert.ok(at(13).pose.forwardBlend > 0 && at(13).pose.forwardBlend < 1);
  assert.ok(at(20).pose.forwardBlend > 0.999);
  assert.ok(at(133).pose.forwardBlend > 0 && at(133).pose.forwardBlend < 1);
  assert.equal(at(140).pose.forwardBlend, 0);
  assert.equal(at(133).pose.forwardDistanceM, at(132).pose.forwardDistanceM);
  assert.equal(at(140).pose.forwardDistanceM, at(132).pose.forwardDistanceM);
  assert.ok(at(110).pose.forwardDistanceM > at(100).pose.forwardDistanceM);
  for (const { tick, pose, character } of samples.slice(20, 132)) {
    const { yawRad, velocity } = character;
    const forwardMps = -Math.sin(yawRad) * velocity.x - Math.cos(yawRad) * velocity.z;
    const distance = character.grounded && forwardMps > 0.1 && forwardMps >= 0.9 * Math.hypot(velocity.x, velocity.z) ? forwardMps / 60 : 0;
    assert.ok(Math.abs(pose.forwardDistanceM - at(tick - 1).pose.forwardDistanceM - distance) < 1e-6, `distance at ${tick}`);
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
  assert.equal(room.readActionPose().forwardBlend, 0);
  const blockedDistanceM = room.readActionPose().forwardDistanceM;
  for (let index = 0; index < 10; index++) step();
  assert.equal(room.readActionPose().forwardDistanceM, blockedDistanceM);

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({
      bodyMotion, startDriftM, stopDriftM, maxStrideDriftM, gripDriftM, rightHandDriftRad, leftHandDriftRad, samples, events,
    }, null, 2) + '\n', 'utf8');
  }
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
