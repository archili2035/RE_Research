// M0 preview fixtures and the v4 regression feel (formerly src/preview-scene.ts, preview-stages.ts, preview-input.ts).
// Kept for the M0–M6 mechanics tests, which were laid out against these stages and speeds. Not part of the app.
import * as THREE from 'three';
import { createBoxScene } from '../src/box-scene.ts';
export const previewBoxes = [
  { id: 'floor', x: 0, y: -0.15, z: -3.5, w: 20, h: 0.3, d: 20, color: 0x44555b },
  { id: 'west-wall', x: -2.5, y: 1.25, z: -2, w: 0.24, h: 2.5, d: 13, color: 0x607a85 },
  { id: 'inside-wall', x: 2.5, y: 1.25, z: 0, w: 0.24, h: 2.5, d: 9, color: 0x526b75 },
  { id: 'north-wall', x: 2.5, y: 1.25, z: -8.5, w: 10, h: 2.5, d: 0.24, color: 0x607a85 },
  { id: 'east-wall', x: 7.5, y: 1.25, z: -6.5, w: 0.24, h: 2.5, d: 4, color: 0x607a85 },
  { id: 'south-wall', x: 5, y: 1.25, z: -4.5, w: 5, h: 2.5, d: 0.24, color: 0x526b75 },
  { id: 'rear-wall', x: 0, y: 1.25, z: 7.6, w: 5, h: 2.5, d: 0.24, color: 0x607a85 },
  { id: 'practice-block', x: 6.8, y: 0.8, z: -6.5, w: 0.5, h: 1.6, d: 0.75, color: 0xde9060 },
];

export async function createPreviewScene() {
  const boxes = previewBoxes.map(({ id, x, y, z, w, h, d, color }): RenderBox => ({
    id, kind: 'box', position: { x, y, z }, size: { x: w, y: h, z: d },
    yawRad: 0, color: `#${color.toString(16).padStart(6, '0')}`,
  }));
  const result = await createBoxScene(boxes, boxes.map(({ id, position, size, yawRad }) => ({
    id, center: position, size, yawRad,
  })), false); // Preserve the M7 v1 route's collision settings.
  const grid = new THREE.GridHelper(20, 20, 0x8ea5aa, 0x62787f);
  grid.position.set(0, 0.003, -3.5);
  result.scene.add(grid);
  return result;
}


type RenderBox = Extract<LevelDefinition['render'][number], { kind: 'box' }>;

import defaultFeel from '../src/feel.json' with { type: 'json' };
import type { ActionId, ActionState, CameraPose, CharacterState, FeelConfig, InputSnapshot, LevelDefinition } from '../src/contracts.ts';
import { createMovement } from '../src/movement.ts';
import type { SimulationStages, SimulationState } from '../src/simulation.ts';

export { CHARACTER_BODY as PREVIEW_BODY } from '../src/movement.ts';

const previewSpawn = { position: { x: 0, y: 0.025, z: 3 }, yawRad: 0 };

/**
 * FeelConfig v4 movement, kept for the M0–M6 mechanics tests whose fixed step counts were laid out at these speeds.
 * Without turnSpeedRadPerS the heading stays on the camera yaw, as in v4. The shipped defaults use the source root speeds (v5).
 */
export const LEGACY_MOVEMENT: FeelConfig['movement'] = {
  walkSpeedMps: { value: 2.55, source: 'FeelConfig v4', evidence: 'tuned', conditions: 'M0–M6 回归路线的原步行速度' },
  sprintSpeedMps: { value: 4.3, source: 'FeelConfig v4', evidence: 'tuned', conditions: 'M0–M6 回归路线的原奔跑速度' },
  aimSpeedMps: { value: 1.55, source: 'FeelConfig v4', evidence: 'tuned', conditions: 'M0–M6 回归路线的原瞄准移速' },
};
/** v4 movement plus no aim sway or shot shake, for tests that assert exact mouse-to-view integration. */
export const withLegacyMovement = (feel: FeelConfig): FeelConfig => {
  const { aimSwayDeg: _sway, shotShakeM: _shake, ...camera } = feel.camera;
  void _sway; void _shake;
  return { ...feel, movement: LEGACY_MOVEMENT, camera };
};

export function createPreviewStages(feel: FeelConfig, spawn: LevelDefinition['spawn'] = previewSpawn) {
  const magazineCapacity = feel.actions.magazineCapacity.value;

  function cameraFor(character: CharacterState, aiming: boolean, yawRad: number, pitchRad: number): CameraPose {
    const distance = (aiming ? feel.camera.aimDistanceM : feel.camera.moveDistanceM).value;
    const shoulder = (aiming ? feel.camera.aimShoulderM : feel.camera.moveShoulderM).value;
    const horizontalDistance = distance * Math.cos(pitchRad);
    return {
      position: {
        x: character.position.x + Math.sin(yawRad) * horizontalDistance + Math.cos(yawRad) * shoulder,
        y: character.position.y + 1.45 - distance * Math.sin(pitchRad),
        z: character.position.z + Math.cos(yawRad) * horizontalDistance - Math.sin(yawRad) * shoulder,
      },
      yawRad, pitchRad, verticalFovRad: (aiming ? feel.camera.aimVerticalFovRad : feel.camera.moveVerticalFovRad).value, obstructed: false,
    };
  }

  const character: CharacterState = {
    ...spawn,
    velocity: { x: 0, y: 0, z: 0 },
    grounded: true,
  };

  const previewInitialState: SimulationState = {
    tick: 0, character, camera: cameraFor(character, false, character.yawRad, -0.16),
    action: { id: 'preview-player', phase: 'ready', aiming: false, magazine: magazineCapacity, reserve: feel.actions.initialReserve.value },
  };

  const movePreview = createMovement(withLegacyMovement(feel), () => -0.08); // M7 v1 replays use the M0 ground probe.

  function requests(input: InputSnapshot, previous: ActionState): ActionId[] {
    const actions: ActionId[] = [];
    if (input.aimHeld !== previous.aiming) actions.push(input.aimHeld ? 'raise' : 'lower');
    if (input.firePressed) actions.push('fire');
    if (input.reloadPressed) actions.push('reload');
    if (input.interactPressed) actions.push('interact');
    return actions;
  }

  const actPreview: SimulationStages['act'] = (input, _character, previous, emit) => {
    const next = { ...previous, aiming: input.aimHeld, phase: input.aimHeld ? 'aiming' : 'ready' } as const;
    let { magazine, reserve } = previous;
    for (const action of requests(input, previous)) {
      const subjectId = previous.id;
      emit(subjectId, { type: 'input.request', action });
      if (action === 'interact' || (action === 'fire' && (!next.aiming || magazine === 0)) ||
          (action === 'reload' && (magazine === magazineCapacity || reserve === 0))) continue;
      emit(subjectId, { type: 'action.accepted', action });
      if (action === 'fire') {
        emit(subjectId, { type: 'weapon.fired' });
        magazine -= 1;
      }
      if (action === 'reload') {
        const amount = Math.min(magazineCapacity - magazine, reserve);
        magazine += amount;
        reserve -= amount;
      }
      if (action === 'fire' || action === 'reload') {
        emit(subjectId, { type: 'ammo.committed', magazine, reserve });
      }
      emit(subjectId, { type: 'action.recovered', action });
    }
    return { ...next, magazine, reserve };
  };

  const cameraPreview: SimulationStages['camera'] = (input, character, action, previous, scene) => {
    const yaw = previous.yawRad - input.lookDeltaX * feel.camera.lookRadPerPx.value;
    const yawRad = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const pitchRad = Math.max(-0.85, Math.min(0.65, previous.pitchRad - input.lookDeltaY * feel.camera.lookRadPerPx.value));
    const pose = cameraFor(character, action.aiming, yawRad, pitchRad);
    const anchor = { ...character.position, y: character.position.y + 1.45 };
    const hit = scene.sweepSphere(anchor, pose.position, 0.16);
    if (!hit) return pose;
    const dx = pose.position.x - anchor.x;
    const dy = pose.position.y - anchor.y;
    const dz = pose.position.z - anchor.z;
    const ratio = Math.max(0, hit.distanceM - 0.05) / Math.hypot(dx, dy, dz);
    return {
      ...pose, obstructed: true,
      position: { x: anchor.x + dx * ratio, y: anchor.y + dy * ratio, z: anchor.z + dz * ratio },
    };
  };

  return { previewInitialState, movePreview, actPreview, cameraPreview };
}

export const { previewInitialState, movePreview, actPreview, cameraPreview } =
  createPreviewStages(defaultFeel as FeelConfig);