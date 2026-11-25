import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { Mesh, Vector3 } from 'three';
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

const source = new URL('../../docs/player/', import.meta.url);
const stages: readonly [string, number, Partial<InputSnapshot>][] = [
  ['spawn', 1, { interactPressed: true, firePressed: true }],
  ['corner', 277, { moveY: 1 }],
  ['turn', 1, { lookDeltaX: -Math.PI / (2 * 0.0022) }],
  ['by-target', 64, { moveY: 1 }],
  ['raise-start', 1, { aimHeld: true, firePressed: true, lookDeltaX: 0.27 / 0.0022, lookDeltaY: -0.16 / 0.0022 }],
  ['raise-mid', 12, { aimHeld: true }],
  ['fire-start', 15, { aimHeld: true }],
  ['shot', 4, { aimHeld: true }],
  ['shot-recovered', 11, { aimHeld: true }],
  ['reload-start', 1, { aimHeld: true, reloadPressed: true }],
  ['reload-commit', 44, { aimHeld: true }],
  ['reload-recovered', 40, { aimHeld: true }],
  ['look-door', 1, { lookDeltaX: -0.27 / 0.0022 }],
  ['door-blocked', 60, { moveY: 1 }],
  ['door-opened', 1, { interactPressed: true }],
  ['threshold', 10, { moveY: 1 }],
  ['threshold-denied', 1, { interactPressed: true }],
  ['next-room', 20, { moveY: 1 }],
  ['door-closed', 1, { interactPressed: true }],
  ['return-blocked', 25, { moveY: -1 }],
  ['return-opened', 1, { interactPressed: true }],
  ['return', 25, { moveY: -1 }],
];

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
    Pick<LeonAssets, 'MotionMath' | 'LeonSkinning'> & { window: Pick<LeonAssets, 'MODEL_DATA' | 'MOTION_DATA'> };
  for (const file of ['model.js', 'motions.js', 'math.js', 'skinning.js']) {
    runInContext(readFileSync(new URL(file, source), 'utf8'), context, { filename: file });
  }
  return createLeonView({
    ...context.window,
    MotionMath: context.MotionMath,
    LeonSkinning: context.LeonSkinning,
  });
}

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
    const ticks = [];
    const checkpoints = [];
    const drawSamples = new Map<string, number[]>();
    const neutral = createInputBuffer().sample(0);
    let controls: Partial<InputSnapshot> = {};
    const step = createSimulation(room.initial, room.queries, {
      ...room.stages,
      sampleInput: (tick) => ({ ...neutral, ...controls, tick }),
      publish(state, _input, batch) {
        events.push(...batch);
        ticks.push({ ...state, movement: room.readMovementDebug() });
      },
    });
    for (const [label, count, input] of stages) {
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
    return { ticks, events, checkpoints, drawSamples };
  }

  const graybox = await run(false);
  const modeled = await run(true);
  assert.deepEqual(modeled.ticks, graybox.ticks);
  assert.deepEqual(modeled.events, graybox.events);
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
