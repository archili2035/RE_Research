import { writeFileSync } from 'node:fs';
import manifest from '../public/assets/clips.json' with { type: 'json' };
import { CONTRACT_VERSION, STEP_S } from '../src/contracts.ts';
import type { ReplayTrace } from '../src/contracts.ts';
import { createInputBuffer } from '../src/input.ts';
import { createTestRoom, defaultFeel, testRoom } from '../src/level.ts';
import { createRoutePlayback } from '../src/m7-replay.ts';
import { testRoomRoute } from './test-room-route.mjs';

const neutral = createInputBuffer().sample(0);
let tick = 0;
const route: ReplayTrace = {
  version: CONTRACT_VERSION,
  stepS: STEP_S,
  level: { id: testRoom.id, version: testRoom.version },
  feelVersion: defaultFeel.version,
  inputs: testRoomRoute.flatMap(([, count, controls]) =>
    Array.from({ length: count }, () => ({ ...neutral, ...controls, tick: ++tick }))),
  events: [],
};
const room = await createTestRoom(testRoom, manifest);
const playback = createRoutePlayback(route, room, defaultFeel, () => {});
while (!playback.done) playback.step();

const { inputs, events, ...header } = playback.trace();
const lines = (items: readonly unknown[]) => items.map((item) => '    ' + JSON.stringify(item)).join(',\n');
writeFileSync(new URL('../fixtures/route.replay.json', import.meta.url),
  JSON.stringify(header, null, 2).slice(0, -2) + ',\n' +
  '  "inputs": [\n' + lines(inputs) + '\n  ],\n' +
  '  "events": [\n' + lines(events) + '\n  ]\n}\n', 'utf8');
console.log(`${route.level.id}@${route.level.version}, FeelConfig v${route.feelVersion}: ${inputs.length} ticks, ${events.length} events`);
