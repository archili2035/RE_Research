import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent, InputSnapshot, LevelDefinition } from '../src/contracts.ts';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom } from '../src/level.ts';
import { createSimulation } from '../src/simulation.ts';
import rhodesJson from '../src/levels/rhodes-1f.json' with { type: 'json' };
import route from '../fixtures/rhodes-route.json' with { type: 'json' };

const LOOK_RAD_PER_PX = 0.0022;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

test('Rhodes Hill greybox boxes never share volume (overlaps z-fight and flicker)', () => {
  const level = rhodesJson as unknown as LevelDefinition;
  const eps = 1e-4;
  const boxes = level.render.map((item) => {
    assert.equal(item.kind, 'box');
    assert.equal(item.yawRad, 0, 'axis-aligned boxes only');
    const { size } = item as Extract<typeof item, { kind: 'box' }>;
    const min = { x: item.position.x - size.x / 2, y: item.position.y - size.y / 2, z: item.position.z - size.z / 2 };
    const max = { x: item.position.x + size.x / 2, y: item.position.y + size.y / 2, z: item.position.z + size.z / 2 };
    return { id: item.id, min, max };
  }).sort((a, b) => a.min.x - b.min.x);
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length && boxes[j].min.x < a.max.x - eps; j += 1) {
      const b = boxes[j];
      if ((['y', 'z'] as const).every((k) => b.min[k] < a.max[k] - eps && a.min[k] < b.max[k] - eps)) overlaps.push(`${a.id} × ${b.id}`);
    }
  }
  assert.deepEqual(overlaps, []);
});

test('Rhodes Hill greybox: 2F gallery -> stairs -> Central Hall -> guard office door -> medication room', async () => {
  const level = rhodesJson as unknown as LevelDefinition;
  const room = await createTestRoom(level);
  const neutral = createInputBuffer().sample(0);
  let controls: Partial<InputSnapshot> = {};
  let events: readonly GameEvent[] = [];
  const step = createSimulation(room.initial, room.queries, {
    ...room.stages,
    sampleInput: (tick) => ({ ...neutral, ...controls, tick }),
    publish: (_state, _input, batch) => { events = batch; },
  });

  const door = level.colliders.find(({ id }) => id === route.door)!;
  const points = route.waypoints;
  let state = room.initial;
  let index = 1;
  let doorOpened = false;
  let minHallY = Infinity;
  let enteredGuardOffice = false;
  let minVy = 0;
  let worst = { x: 0, y: 0, z: 0 };
  let ticks = 0;
  for (let tick = 0; tick < 7200 && index < points.length; tick += 1) {
    const p = state.character.position;
    while (index < points.length - 1 && Math.hypot(points[index].x - p.x, points[index].z - p.z) < 0.5) index += 1;
    const w = points[index];
    const desired = Math.atan2(-(w.x - p.x), -(w.z - p.z));
    const turn = wrap(desired - state.camera.yawRad);
    const nearDoor = Math.hypot(door.center.x - p.x, door.center.z - p.z) < 1.4;
    controls = {
      lookDeltaX: -turn / LOOK_RAD_PER_PX,
      moveY: Math.abs(turn) > 0.6 ? 0 : 1,
      interactPressed: nearDoor && !doorOpened && tick % 20 === 0,
    };
    state = step();
    ticks = tick + 1;
    if (state.character.velocity.y < minVy) { minVy = state.character.velocity.y; worst = { ...state.character.position }; }
    if (process.env.RHODES_TRACE && tick % 30 === 0) console.log(tick, index, state.character.position.x.toFixed(2), state.character.position.y.toFixed(2), state.character.position.z.toFixed(2), state.character.velocity.y.toFixed(2));
    if (events.some((event) => event.type === 'door.changed' && event.subjectId === route.door)) doorOpened = true;
    if (p.z > 33 && p.z < 44 && p.y < 3) minHallY = Math.min(minHallY, p.y);
    if (p.x < -6 && p.x > -13 && p.z > 42 && p.z < 52 && p.y < 2.2) enteredGuardOffice = true;
    if (index === points.length - 1 && Math.hypot(w.x - p.x, w.z - p.z) < 0.5) break;
  }
  const end = state.character.position;
  const last = points.at(-1)!;
  assert.ok(Math.abs(room.initial.character.position.y - 7.275) < 0.05, 'spawn on the 2F gallery');
  assert.ok(minHallY < 2.5, `reached the Central Hall floor (min y ${minHallY})`);
  assert.ok(doorOpened, 'guard office door opened with E');
  assert.ok(enteredGuardOffice, 'walked through the guard office');
  assert.ok(Math.hypot(last.x - end.x, last.z - end.z) < 0.6, `reached medication room (${end.x.toFixed(2)}, ${end.y.toFixed(2)}, ${end.z.toFixed(2)}) wp ${index}/${points.length}`);
  assert.ok(end.y < 1.7, 'stepped down into the medication room');
  // Walking down the steep steps into the medication room peaks near -4.5 m/s; a real drop off the gallery would exceed -6.
  assert.ok(minVy > -6, `no long falls (min vy ${minVy.toFixed(2)} at ${JSON.stringify(worst)})`);
  console.log(JSON.stringify({ ticks, seconds: +(ticks / 60).toFixed(1), minHallY: +minHallY.toFixed(3), minVy: +minVy.toFixed(2), end }));
});