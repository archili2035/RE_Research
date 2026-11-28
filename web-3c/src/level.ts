import { createActions } from './actions.ts';
import { createCamera, crosshairDirection } from './camera.ts';
import type { CharacterState, ClipManifest, FeelConfig, LevelDefinition, Vec3 } from './contracts.ts';
import feelJson from './feel.json' with { type: 'json' };
import testRoomJson from './levels/test-room.json' with { type: 'json' };
import { CHARACTER_BODY, createMovement } from './movement.ts';
import { createBoxScene } from './box-scene.ts';
import type { SimulationStages, SimulationState } from './simulation.ts';

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

export async function createTestRoom(level = testRoom, manifest?: ClipManifest, initialFeel: FeelConfig = defaultFeel) {
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
    let committedCameraYaw = level.spawn.yawRad;
    const holdOffsetRad = feel.movement.holdYawOffsetRad?.value ?? 0;
    const actions = createActions(feel.actions, manifest, {
      gaitReferenceMps: feel.movement.walkSpeedMps.value,
      walkFacesCamera: (feel.movement.walkFacesCamera?.value ?? 0) >= 0.5,
      decelS: feel.movement.decelS?.value,
      cameraYaw: () => committedCameraYaw,
    });
    const character: CharacterState = { ...level.spawn, velocity: { x: 0, y: 0, z: 0 }, grounded: true };
    const camera = createCamera(character, actions.initial, queries, feel.camera);
    committedCameraYaw = camera.initial.yawRad;
    const initial = { tick: 0, character, action: actions.initial, camera: camera.initial };
    const headingModel = feel.movement.aimChaseS !== undefined && feel.movement.turnSpeedRadPerS !== undefined;
    const muzzleOffset = [feel.actions.muzzleRightM?.value ?? 0.25, feel.actions.muzzleUpM?.value ?? 1.45,
      feel.actions.muzzleForwardM?.value ?? 0.5];
    return {
      initial, actions, camera, move: createMovement(feel), holdOffsetRad, headingModel,
      setCameraYaw(yawRad: number) { committedCameraYaw = yawRad; },
      getCameraYaw: () => committedCameraYaw,
      /** Muzzle position from the character feet and heading, measured on the wp0100 hold pose. */
      muzzle({ position, yawRad }: CharacterState): Vec3 {
        const [right, up, forward] = muzzleOffset;
        return {
          x: position.x + Math.cos(yawRad) * right - Math.sin(yawRad) * forward,
          y: position.y + up,
          z: position.z - Math.sin(yawRad) * right - Math.cos(yawRad) * forward,
        };
      },
    };
  }

  let runtime = start(initialFeel);

  // Simulation state changes collisions only. syncView() applies door and target visuals after each publish.
  function setDoorOpen(door: (typeof doors)[number], open: boolean) {
    door.open = open;
    setColliderEnabled(door.colliderId, !open);
  }

  function syncView(tick: number) {
    for (const door of doors) door.mesh.visible = !door.open;
    for (const target of targets.values()) target.mesh.material.emissiveIntensity = tick < target.flashUntil ? 1 : 0;
  }

  function reset(feel = defaultFeel) {
    for (const door of doors) {
      if (door.open) setDoorOpen(door, false);
    }
    for (const target of targets.values()) target.flashUntil = 0;
    resetMovementDebug();
    runtime = start(feel);
    syncView(0);
    return runtime.initial;
  }

  /** Saves every piece of simulation state outside SimulationState: actions, camera, heading, doors and targets. */
  function snapshot() {
    return structuredClone({
      actions: runtime.actions.save(), camera: runtime.camera.save(), move: runtime.move.save(),
      cameraYaw: runtime.getCameraYaw(), doors: doors.map(({ open }) => open),
      flash: [...targets.values()].map(({ flashUntil }) => flashUntil),
    });
  }

  function restore(saved: ReturnType<typeof snapshot>) {
    const copy = structuredClone(saved);
    runtime.actions.load(copy.actions as Parameters<typeof runtime.actions.load>[0]);
    runtime.camera.load(copy.camera as Parameters<typeof runtime.camera.load>[0]);
    runtime.move.load(copy.move);
    runtime.setCameraYaw(copy.cameraYaw);
    doors.forEach((door, i) => { if (door.open !== copy.doors[i]) setDoorOpen(door, copy.doors[i]); });
    [...targets.values()].forEach((target, i) => { target.flashUntil = copy.flash[i]; });
    resetMovementDebug();
  }

  const act: SimulationStages['act'] = (input, character, previous, emit) => {
    const next = runtime.actions.act(input, character, previous, emit);
    // Doors only open from the lowered, idle weapon state (not while raising, aiming, firing or reloading).
    if (!input.interactPressed || next.phase !== 'ready') return next;

    const door = nearestDoor(character.position);
    if (!door || (door.open && overlapsDoor(character.position, door.panel))) return next;

    emit(previous.id, { type: 'action.accepted', action: 'interact' });
    setDoorOpen(door, !door.open);
    emit(door.id, { type: 'door.changed', open: door.open });
    emit(previous.id, { type: 'action.recovered', action: 'interact' });
    return next;
  };

  /**
   * Two-segment shot. The camera ray, started at the character's depth so geometry behind the shoulder is ignored,
   * finds the aim point. A second ray from the muzzle to that point decides what the bullet actually hits.
   */
  function resolveShot(state: SimulationState) {
    const { camera, character } = state;
    const direction = crosshairDirection(camera);
    const muzzle = runtime.muzzle(character);
    const depth = Math.max(0, (muzzle.x - camera.position.x) * direction.x + (muzzle.y - camera.position.y) * direction.y +
      (muzzle.z - camera.position.z) * direction.z);
    const start = { x: camera.position.x + direction.x * depth, y: camera.position.y + direction.y * depth,
      z: camera.position.z + direction.z * depth };
    const aimHit = queries.raycast(start, direction, shotRangeM);
    const aimPoint = aimHit?.point ?? { x: start.x + direction.x * shotRangeM, y: start.y + direction.y * shotRangeM,
      z: start.z + direction.z * shotRangeM };
    const toAim = { x: aimPoint.x - muzzle.x, y: aimPoint.y - muzzle.y, z: aimPoint.z - muzzle.z };
    const lengthM = Math.hypot(toAim.x, toAim.y, toAim.z);
    if (lengthM === 0) return aimHit;
    return queries.raycast(muzzle, toAim, lengthM + 0.05);
  }

  const resolveSceneEvents: NonNullable<SimulationStages['resolveSceneEvents']> = (state, events, emit) => {
    // Confirmed fire uses the fixed-step camera that will be presented for the shot.
    events.forEach((event) => {
      if (event.type !== 'weapon.fired' || event.subjectId !== state.action.id) return;
      const hit = resolveShot(state);
      if (!hit) return;
      const target = targets.get(hit.colliderId);
      if (!target || hit.distanceM > target.interactionRangeM) return;
      target.flashUntil = state.tick + TARGET_FLASH_TICKS;
      emit(target.id, { type: 'target.hit' });
    });
  };

  return {
    level, scene, avatar, queries, doorPrompt, readMovementDebug, reset, syncView, snapshot, restore, resolveShot,
    get initial() { return runtime.initial; },
    readCameraAnchor: () => runtime.camera.anchor,
    readActionPose: () => runtime.actions.readPose(),
    stages: {
      move: (...args) => runtime.move(...args),
      act,
      camera(input, character, action, previous, scene) {
        const view = runtime.camera.update(input, character, action, previous, scene);
        const headingDiff = runtime.headingModel
          ? Math.atan2(Math.sin(view.yawRad + runtime.holdOffsetRad - character.yawRad), Math.cos(view.yawRad + runtime.holdOffsetRad - character.yawRad))
          : undefined;
        runtime.actions.updateAimPose(character, view.yawRad - previous.yawRad, view.pitchRad, headingDiff);
        runtime.setCameraYaw(view.yawRad);
        return view;
      },
      resolveSceneEvents,
    } satisfies Omit<SimulationStages, 'sampleInput' | 'publish'>,
  };
}