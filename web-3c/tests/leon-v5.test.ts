import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { Quaternion } from 'three';
import source from '../../reports/web-3c/source-data/leon-3c-source.json' with { type: 'json' };
import type { InputSnapshot, LevelDefinition } from '../src/contracts.ts';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom, defaultFeel } from '../src/level.ts';
import { LEON_MOVE_RUN, LEON_MOVE_WALK, LEON_ROOT_SPEED, LEON_WALK, leonDirectionWeights, leonWalkBlend } from '../src/leon-locomotion.ts';
import { createLeonView } from '../src/leon-view.ts';
import type { LeonAssets } from '../src/leon-view.ts';
import { createSimulation } from '../src/simulation.ts';

const neutral = createInputBuffer().sample(0);
const extraMotions = new URL('../../docs/player/motions-extra.js', import.meta.url);
const near = (actual: number, expected: number, tolerance: number, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} vs ${expected}`);
const floor = { id: 'floor', size: { x: 40, y: 0.2, z: 40 }, position: { x: 0, y: -0.1, z: 0 } };
const flat: LevelDefinition = {
  id: 'v5-flat', version: 1, spawn: { position: { x: 0, y: 0.025, z: 0 }, yawRad: 0 },
  render: [{ ...floor, kind: 'box', yawRad: 0 }], colliders: [{ id: 'floor', center: floor.position, size: floor.size, yawRad: 0 }],
  doors: [], targets: [],
};

async function drive(course: Partial<InputSnapshot>[], feel = defaultFeel) {
  const room = await createTestRoom(flat, undefined, feel);
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages, sampleInput: (tick) => ({ ...neutral, ...course[tick - 1], tick }), publish() {},
  });
  return course.map(() => ({ state: step(), pose: room.readActionPose() }));
}

test('FeelConfig v5 speeds equal the decoded root speeds of the forward loops', () => {
  const speed = (bank: number, id: number) => source.clipRootSpeeds.find((clip) => clip.bank === bank && clip.id === id)!.horizontalMps;
  near(LEON_ROOT_SPEED.aim, speed(100, 120), 1e-4, 'aim loop');
  near(LEON_ROOT_SPEED.walk, speed(200, LEON_MOVE_WALK[0].id), 1e-4, 'walk loop');
  near(LEON_ROOT_SPEED.run, speed(200, LEON_MOVE_RUN.id), 1e-4, 'run loop');
  near(defaultFeel.movement.aimSpeedMps.value, LEON_ROOT_SPEED.aim, 0.01, 'aim feel');
  near(defaultFeel.movement.walkSpeedMps.value, LEON_ROOT_SPEED.walk, 0.01, 'walk feel');
  near(defaultFeel.movement.sprintSpeedMps.value, LEON_ROOT_SPEED.run, 0.01, 'sprint feel');
  for (const clip of LEON_WALK) near(speed(100, clip.id), 1.10, 0.02, `aim loop ${clip.id}`);
  // The exported tree keeps the circular four-way blend that the view reproduces.
  const tree = source.motionTrees.find(({ name }) => name === 'ch0100_Hold_strafe')!;
  const blend = tree.nodes.find(({ type }) => type === 'OctSyncBlendNode')!;
  assert.equal(blend.parameters.CircledBlend, true);
  assert.equal(blend.parameters.RootTransPolarBlend, true);
  assert.deepEqual(tree.nodes.filter(({ type }) => type === 'MotionNode').map(({ parameters }) => parameters.MotionID).sort(),
    [120, 122, 124, 126]);
  assert.deepEqual(leonDirectionWeights(1, 1).map((w) => +w.toFixed(6)), [0.5, 0, 0, 0.5]);
  assert.deepEqual(leonDirectionWeights(-1, 0), [0, 1, 0, 0]);
});

test('heading turns toward travel while lowered and to camera yaw plus the hold offset while aiming', async () => {
  const offset = defaultFeel.movement.holdYawOffsetRad.value;
  const turn = defaultFeel.movement.turnSpeedRadPerS.value / 60;
  const course: Partial<InputSnapshot>[] = [
    ...Array.from({ length: 40 }, () => ({ moveX: 1 })),        // walk right relative to the camera
    ...Array.from({ length: 20 }, () => ({})),                  // stop keeps the heading
    ...Array.from({ length: 240 }, () => ({ aimHeld: true })),  // raise turns back to the camera (aimChaseS lag)
  ];
  const run = await drive(course);
  const yaw = (i: number) => run[i].state.character.yawRad;
  for (let i = 1; i < run.length; i++) {
    const delta = Math.atan2(Math.sin(yaw(i) - yaw(i - 1)), Math.cos(yaw(i) - yaw(i - 1)));
    assert.ok(Math.abs(delta) <= turn + 1e-9, `turn rate at ${i}`);
  }
  near(yaw(39), -Math.PI / 2, 1e-6, 'faces right');
  near(yaw(59), -Math.PI / 2, 1e-6, 'keeps heading when idle');
  // The camera yaw carries the ±0.25° aim sway, so allow that much.
  near(yaw(299), run[299].state.camera.yawRad + offset, 0.006, 'aim heading');
  // While the body lags, the remaining difference is reported for the upper-body twist and the wheel blend.
  near(run[299].pose.aim.yawTwistRad, 0, 0.006, 'settled twist');
  assert.ok(Math.abs(run[95].pose.aim.yawTwistRad) > 0.1, 'twist covers the lag once the raise has finished');
  assert.ok(run.slice(0, 40).some(({ state }) => Math.abs(state.character.velocity.x - LEON_ROOT_SPEED.walk) < 0.02));
});

test('lowered travel uses the carry-gun phase, aimed travel the strafe phase, and run blends in with sprint', async () => {
  const course: Partial<InputSnapshot>[] = [
    ...Array.from({ length: 60 }, () => ({ moveY: 1 })),
    ...Array.from({ length: 60 }, () => ({ moveY: 1, sprintHeld: true })),
    ...Array.from({ length: 60 }, () => ({ moveY: 1, aimHeld: true })),
  ];
  const run = await drive(course);
  const walking = run.slice(30, 60);
  for (let i = 1; i < walking.length; i++) {
    const advance = walking[i].pose.walk.carryCycles - walking[i - 1].pose.walk.carryCycles;
    const { x, z } = walking[i].state.character.velocity;
    // Collision rounding and the direction crossfade allow about 1% between the step speed and the stride.
    near(advance, Math.hypot(x, z) / 60 / LEON_MOVE_WALK[0].distanceM, 0.01 * Math.hypot(x, z) / 60 / LEON_MOVE_WALK[0].distanceM, 'carry phase');
    assert.equal(walking[i].pose.walk.hold, 0);
  }
  assert.ok(run[119].pose.walk.run > 0.95, 'sprint reaches the run loop');
  const aimed = run.slice(160, 180);
  assert.ok(aimed.every(({ pose }) => pose.walk.hold === 1 && pose.walk.run < 0.01));
  for (let i = 1; i < aimed.length; i++) {
    // The hold offset turns the body 9° off the travel line, so the circular blend mixes in a side loop.
    const { velocity: { x, z }, yawRad } = aimed[i].state.character;
    const right = Math.cos(yawRad) * x - Math.sin(yawRad) * z;
    const forward = -Math.sin(yawRad) * x - Math.cos(yawRad) * z;
    near(aimed[i].pose.walk.cycles - aimed[i - 1].pose.walk.cycles, leonWalkBlend(right, forward).cyclesPerSecond / 60, 1e-6, 'strafe phase');
  }
});

test('camera kick follows the arm0000 recoil curve after the shot and never moves the shot ray', async () => {
  const kick = defaultFeel.camera.recoilPitchRad.value;
  const course: Partial<InputSnapshot>[] = [
    ...Array.from({ length: 40 }, () => ({ aimHeld: true })),
    { aimHeld: true, firePressed: true },
    ...Array.from({ length: 200 }, () => ({ aimHeld: true })),
  ];
  // Without the aim sway, the only pitch offset after the shot is the recoil kick.
  const { aimSwayDeg: _sway, ...camera } = defaultFeel.camera;
  void _sway;
  const run = await drive(course, { ...defaultFeel, camera });
  const base = run[39].state.camera.pitchRad;
  const fired = run.findIndex(({ state }) => state.action.magazine < 8);
  assert.ok(fired > 0);
  near(run[fired].state.camera.pitchRad, base, 1e-12, 'shot step is unkicked');
  const offsets = run.slice(fired).map(({ state }) => state.camera.pitchRad - base);
  const peak = Math.max(...offsets);
  near(peak, kick, kick * 0.05, 'peak');
  assert.ok(offsets.every((value) => value >= -1e-12 && value <= kick + 1e-12));
  const peakIndex = offsets.indexOf(peak);
  assert.ok(peakIndex > 0 && peakIndex <= Math.ceil(0.04 * 2.8 * 60) + 1);
});

test('optional carry-gun clips and the spine pitch layer drive the Leon view when present', { skip: !existsSync(extraMotions) }, async () => {
  const context = createContext({ window: {} }) as unknown as Record<string, unknown> & { window: Record<string, unknown> };
  for (const file of ['model.js', 'motions.js', 'masks.js', 'math.js', 'skinning.js']) {
    runInContext(readFileSync(new URL(`../../docs/player/${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
  runInContext(readFileSync(extraMotions, 'utf8'), context, { filename: 'motions-extra.js' });
  const assets = { ...context.window, MotionMath: context.MotionMath, LeonSkinning: context.LeonSkinning } as unknown as LeonAssets;
  const leon = createLeonView(assets);
  const run = await drive([...Array.from({ length: 60 }, () => ({ aimHeld: true, lookDeltaY: -3 })), ...Array.from({ length: 40 }, () => ({ moveY: 1 }))]);
  const spine = () => new Quaternion().setFromRotationMatrix(leon.readJoint('Spine_2')!).normalize();
  const aimed = run[59].pose;
  leon.draw(aimed);
  const pitched = spine();
  leon.draw({ ...aimed, aim: { ...aimed.aim, pitchRad: 0 } });
  // Waist, stomach and chest shares (0.25 + 0.25 + 0.5) add up to the full pitch at the top spine joint.
  near(pitched.angleTo(spine()), Math.abs(aimed.aim.pitchRad), 0.01, 'spine pitch');
  const walking = run[99].pose;
  assert.equal(walking.walk.hold, 0);
  leon.draw(walking);
  assert.ok(leon.readJoint('L_Leg_Toes'));
});