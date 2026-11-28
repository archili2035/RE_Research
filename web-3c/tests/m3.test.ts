import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import greyboxJson from '../fixtures/m3-greybox.json' with { type: 'json' };
import { STEP_S } from '../src/contracts.ts';
import type { FeelConfig, InputSnapshot, LevelDefinition, Vec3 } from '../src/contracts.ts';
import feelJson from '../src/feel.json' with { type: 'json' };
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom } from '../src/level.ts';
import { withLegacyMovement } from '../src/preview-stages.ts';
import { createSimulation } from '../src/simulation.ts';

const greybox = greyboxJson as LevelDefinition;
// Collision cases are laid out at the v4 speeds; the heading turns instantly without turnSpeedRadPerS.
const feel = withLegacyMovement(feelJson as FeelConfig);
const empty = createInputBuffer().sample(0);

async function run(
  level: LevelDefinition, position: Vec3, ticks: number, controls: (tick: number) => Partial<InputSnapshot>,
) {
  const spawn = { ...level.spawn, position };
  const { initial, stages, queries, readMovementDebug } = await createTestRoom({ ...level, spawn }, undefined, feel);
  const step = createSimulation(initial, queries, {
    ...stages,
    sampleInput: (tick) => ({ ...empty, ...controls(tick), tick }),
    publish() {},
  });
  return Array.from({ length: ticks }, () => {
    const state = step();
    const debug = readMovementDebug()!;
    const { displacement } = debug.result;
    assert.deepEqual(state.character.velocity, {
      x: displacement.x / STEP_S, y: displacement.y / STEP_S, z: displacement.z / STEP_S,
    });
    return { ...state, debug };
  });
}

const horizontalSpeed = ({ x, z }: Vec3) => Math.hypot(x, z);
const forward = () => ({ moveY: 1 });
const columns = ({ x, y, z }: Vec3) => [x, y, z].map((value) => value.toFixed(6));
const near = (actual: number, expected: number, tolerance = 0.005) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);

test('M3 uses committed view and aim, with normalized diagonal input', async () => {
  const [first, second] = await run(greybox, greybox.spawn.position, 2, (tick) => ({
    moveX: 1, moveY: 1, sprintHeld: true, aimHeld: true, lookDeltaX: tick === 1 ? 100 : 0,
  }));
  const sprint = feel.movement.sprintSpeedMps.value;
  const aim = feel.movement.aimSpeedMps.value;
  near(horizontalSpeed(first.debug.query.displacement) / STEP_S, sprint);
  near(horizontalSpeed(second.debug.query.displacement) / STEP_S, aim);
  assert.equal(first.character.yawRad, greybox.spawn.yawRad);
  assert.notEqual(first.camera.yawRad, first.character.yawRad);
  assert.equal(second.character.yawRad, first.camera.yawRad);
  near(first.debug.query.displacement.x / STEP_S, sprint / Math.SQRT2);
  near(first.debug.query.displacement.z / STEP_S, -sprint / Math.SQRT2);
});

test('M3 greybox brakes, slides, clears the doorway and crosses only the low step', async () => {
  const spawn = greybox.spawn.position;
  const stop = await run(greybox, spawn, 20, (tick) => ({ moveY: Number(tick <= 12), sprintHeld: true }));
  near(horizontalSpeed(stop[11].character.velocity), feel.movement.sprintSpeedMps.value, 0.05);
  for (const frame of stop.slice(12)) {
    near(horizontalSpeed(frame.character.velocity), 0, 0.002);
    near(frame.character.position.z, stop[11].character.position.z, 0.001);
  }

  const slide = await run(greybox, { ...spawn, x: -1.8, z: 4.5 }, 40, () => ({ moveX: -1, moveY: 1 }));
  const wall = slide.find(({ debug }) => debug.contacts.some(({ colliderId }) => colliderId === 'west-wall'));
  assert.ok(wall);
  const sliding = slide.slice(wall.tick + 1, wall.tick + 11);
  assert.equal(sliding.length, 10);
  for (const { character, debug } of sliding) {
    near(character.position.x, -2.035, 0.008);
    assert.ok(Math.abs(character.velocity.x) < 0.05 && character.velocity.z < -1.5);
    assert.ok(debug.contacts.some(({ colliderId, normal }) => colliderId === 'west-wall' && normal.x > 0.95));
  }

  const doorway = await run(greybox, { ...spawn, z: 0.85 }, 44, forward);
  assert.ok(doorway.at(-1)!.character.position.z < -0.9);
  assert.ok(doorway.every(({ character, debug }) => character.grounded &&
    !debug.contacts.some(({ colliderId }) => colliderId.startsWith('door-'))));
  const jamb = await run(greybox, { ...spawn, x: 0.8, z: 0.85 }, 28, () => ({ moveY: 1, sprintHeld: true }));
  near(jamb.at(-1)!.character.position.z, 0.505, 0.01);
  assert.ok(jamb.at(-1)!.debug.contacts.some(({ colliderId, normal }) => colliderId === 'door-jamb-right' && normal.z > 0.95));

  const low = await run(greybox, { ...spawn, z: -1.25 }, 84, forward);
  assert.ok(low.some(({ debug }) => debug.contacts.some(({ colliderId }) => colliderId === 'low-step')));
  assert.ok(low.some(({ character }) => character.grounded && Math.abs(character.position.y - 0.205) < 0.025));
  assert.ok(low.at(-1)!.character.position.z < -4.0 && low.at(-1)!.character.grounded);
  near(low.at(-1)!.character.position.y, 0.025, 0.01);
  const high = await run(greybox, { ...spawn, x: 1.65, z: -1.25 }, 32, forward);
  assert.ok(high.at(-1)!.debug.contacts.some(({ colliderId }) => colliderId === 'high-step'));
  near(high.at(-1)!.character.position.z, -1.755, 0.02);
  assert.ok(high.every(({ character }) => character.position.y < 0.10));

  if (process.env.M3_TRACE) {
    const cases = { stop, slide, doorway, jamb, low, high };
    const header = 'case,tick,time_s,grounded,feet_x_m,feet_y_m,feet_z_m,vx_mps,vy_mps,vz_mps,requested_dx_m,requested_dy_m,requested_dz_m,applied_dx_m,applied_dy_m,applied_dz_m,contacts_id_point_xyz_m_normal_xyz';
    const rows = Object.entries(cases).flatMap(([name, frames]) => frames.map(({ tick, character, debug }) => [
      name, tick, (tick * STEP_S).toFixed(6), Number(character.grounded), ...columns(character.position),
      ...columns(character.velocity), ...columns(debug.query.displacement), ...columns(debug.result.displacement),
      debug.contacts.map(({ colliderId, point, normal }) => [colliderId, ...columns(point), ...columns(normal)].join(' ')).join(' | '),
    ].join(',')));
    writeFileSync(process.env.M3_TRACE, `${[header, ...rows].join('\n')}\n`);
  }
});