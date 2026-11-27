import { createActions } from './actions.ts';
import { castCrosshair, createCamera } from './camera.ts';
import type { CharacterState, ClipManifest, FeelConfig, LevelDefinition, Vec3 } from './contracts.ts';
import feelJson from './feel.json' with { type: 'json' };
import testRoomJson from './levels/test-room.json' with { type: 'json' };
import { CHARACTER_BODY, createMovement } from './movement.ts';
import { createBoxScene } from './preview-scene.ts';
import type { SimulationStages } from './simulation.ts';

export const testRoom = testRoomJson as LevelDefinition;
export const defaultFeel = feelJson as FeelConfig;

const TARGET_FLASH_TICKS = 24;
const DOOR_CLEARANCE_M = CHARACTER_BODY.radiusM + 0.025;

function overlapsDoor(feet: Vec3, panel: LevelDefinition['colliders'][number]) {
  if (feet.y >= panel.center.y + panel.size.y / 2 ||
      feet.y + CHARACTER_BODY.heightM <= panel.center.y - panel.size.y / 2) return false;

  const dx = feet.x - panel.center.x;
  const dz = feet.z - panel.center.z;
  const cos = Math.cos(panel.yawRad);
  const sin = Math.sin(panel.yawRad);
  const x = Math.max(0, Math.abs(cos * dx - sin * dz) - panel.size.x / 2);
  const z = Math.max(0, Math.abs(sin * dx + cos * dz) - panel.size.z / 2);
  return Math.hypot(x, z) <= DOOR_CLEARANCE_M;
}

export async function createTestRoom(level = testRoom, manifest?: ClipManifest) {
  const render = level.render.map((item) => {
    if (item.kind !== 'box') throw new Error(`Test-room geometry must be a box: ${item.id}`);
    return item;
  });
  const { scene, avatar, queries, meshes, readMovementDebug, resetMovementDebug, setColliderEnabled } =
    await createBoxScene(render, level.colliders);

  const doors = level.doors.map((door) => {
    const panel = level.colliders.find((collider) => collider.id === door.colliderId);
    const mesh = meshes.get(door.colliderId);
    if (!panel || !mesh) throw new Error(`Missing door panel: ${door.id}`);
    return { ...door, panel, mesh, open: false };
  });
  const targets = new Map(level.targets.map((target) => {
    const mesh = meshes.get(target.colliderId);
    if (!mesh || !level.colliders.some((item) => item.id === target.colliderId)) {
      throw new Error(`Missing target face: ${target.id}`);
    }
    mesh.material.emissive.set('#97ffdb');
    mesh.material.emissiveIntensity = 0;
    const runtime = { ...target, mesh, flashUntil: 0 };
    return [target.colliderId, runtime] as const;
  }));
  const shotRangeM = Math.max(0, ...level.targets.map((target) => target.interactionRangeM));

  function nearestDoor(feet: Vec3) {
    let nearest: (typeof doors)[number] | undefined;
    let distanceM = Infinity;
    for (const door of doors) {
      const { center } = door.panel;
      const distance = Math.hypot(feet.x - center.x, feet.z - center.z);
      if (distance > door.interactionRangeM || distance >= distanceM) continue;
      nearest = door;
      distanceM = distance;
    }
    return nearest;
  }

  function doorPrompt(feet: Vec3) {
    const door = nearestDoor(feet);
    if (!door) return '';
    if (!door.open) return 'E 开门';
    return overlapsDoor(feet, door.panel) ? '离开门槛后可关门' : 'E 关门';
  }

  function start(feel: FeelConfig) {
    const actions = createActions(feel.actions, manifest);
    const character: CharacterState = { ...level.spawn, velocity: { x: 0, y: 0, z: 0 }, grounded: true };
    const camera = createCamera(character, actions.initial, queries, feel.camera);
    const initial = { tick: 0, character, action: actions.initial, camera: camera.initial };
    return { initial, actions, camera, move: createMovement(feel) };
  }

  let runtime = start(defaultFeel);

  function setDoorOpen(door: (typeof doors)[number], open: boolean) {
    door.open = open;
    setColliderEnabled(door.colliderId, !open);
    door.mesh.visible = !open;
  }

  function reset(feel = defaultFeel) {
    for (const door of doors) {
      if (door.open) setDoorOpen(door, false);
    }
    for (const target of targets.values()) {
      target.flashUntil = 0;
      target.mesh.material.emissiveIntensity = 0;
    }
    resetMovementDebug();
    runtime = start(feel);
    return runtime.initial;
  }

  const act: SimulationStages['act'] = (input, character, previous, emit) => {
    const next = runtime.actions.act(input, character, previous, emit);
    if (!input.interactPressed) return next;

    const door = nearestDoor(character.position);
    if (!door || (door.open && overlapsDoor(character.position, door.panel))) return next;

    emit(previous.id, { type: 'action.accepted', action: 'interact' });
    setDoorOpen(door, !door.open);
    emit(door.id, { type: 'door.changed', open: door.open });
    emit(previous.id, { type: 'action.recovered', action: 'interact' });
    return next;
  };

  const resolveSceneEvents: NonNullable<SimulationStages['resolveSceneEvents']> = (state, events, emit) => {
    // Resolve confirmed fire using the same fixed-step camera that drives the crosshair.
    events.forEach((event) => {
      if (event.type !== 'weapon.fired' || event.subjectId !== state.action.id) return;
      const hit = castCrosshair(queries, state.camera, shotRangeM);
      if (!hit) return;
      const target = targets.get(hit.colliderId);
      if (!target || hit.distanceM > target.interactionRangeM) return;
      target.flashUntil = state.tick + TARGET_FLASH_TICKS;
      emit(target.id, { type: 'target.hit' });
    });
    for (const target of targets.values()) {
      target.mesh.material.emissiveIntensity = state.tick < target.flashUntil ? 1 : 0;
    }
  };

  return {
    level, scene, avatar, queries, doorPrompt, readMovementDebug, reset,
    get initial() { return runtime.initial; },
    readActionPose: () => runtime.actions.readPose(),
    stages: {
      move: (...args) => runtime.move(...args),
      act,
      camera(input, character, action, previous, scene) {
        const view = runtime.camera.update(input, character, action, previous, scene);
        runtime.actions.updateAimPose(character, view.yawRad - previous.yawRad);
        return view;
      },
      resolveSceneEvents,
    } satisfies Omit<SimulationStages, 'sampleInput' | 'publish'>,
  };
}
