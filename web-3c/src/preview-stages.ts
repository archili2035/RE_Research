import defaultFeel from './feel.json' with { type: 'json' };
import type { ActionId, ActionState, CameraPose, CharacterState, FeelConfig, InputSnapshot, LevelDefinition } from './contracts.ts';
import { createMovement } from './movement.ts';
import type { SimulationStages, SimulationState } from './simulation.ts';

export { CHARACTER_BODY as PREVIEW_BODY } from './movement.ts';

const previewSpawn = { position: { x: 0, y: 0.025, z: 3 }, yawRad: 0 };

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

  const movePreview = createMovement(feel, () => -0.08); // M7 v1 replays use the M0 ground probe.

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
