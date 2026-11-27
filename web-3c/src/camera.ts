import feel from './feel.json' with { type: 'json' };
import { STEP_S } from './contracts.ts';
import type { ActionState, CameraPose, CharacterState, FeelConfig, SceneQueries, Vec3, ViewAngles } from './contracts.ts';
import type { SimulationStages } from './simulation.ts';

const MIN_PITCH_RAD = -0.85;
const MAX_PITCH_RAD = 0.65;
const INITIAL_PITCH_RAD = -0.16;
const SETTLE_DISTANCE_M = 0.001;

function distance(from: Vec3, to: Vec3) {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
}

function interpolate(from: Vec3, to: Vec3, fraction: number): Vec3 {
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
    z: from.z + (to.z - from.z) * fraction,
  };
}

export function crosshairDirection({ yawRad, pitchRad }: ViewAngles): Vec3 {
  const horizontal = Math.cos(pitchRad);
  return { x: -Math.sin(yawRad) * horizontal, y: Math.sin(pitchRad), z: -Math.cos(yawRad) * horizontal };
}

export function castCrosshair(scene: SceneQueries, pose: CameraPose, maxDistanceM: number) {
  return scene.raycast(pose.position, crosshairDirection(pose), maxDistanceM);
}

function damping(timeS: number) {
  return timeS > 0 ? -Math.expm1(-STEP_S / timeS) : 1;
}

function clampPitch(pitchRad: number) {
  return Math.max(MIN_PITCH_RAD, Math.min(MAX_PITCH_RAD, pitchRad));
}

export function createCamera(
  character: CharacterState, action: ActionState, scene: SceneQueries,
  parameters: FeelConfig['camera'] = feel.camera as FeelConfig['camera'],
) {
  const {
    lookRadPerPx, moveDistanceM, aimDistanceM, moveShoulderM, aimShoulderM, moveHeightM, aimHeightM,
    moveVerticalFovRad, aimVerticalFovRad, aimTransitionS, moveTransitionS, recoveryS, sphereRadiusM,
    wallClearanceM, collisionRetractMps, followPositionS, followHeightS, recoveryDeadbandM, initialPitchRad,
  } = parameters;
  const aimDamping = damping(aimTransitionS.value);
  const moveDamping = damping(moveTransitionS.value);
  const recoveryDamping = damping(recoveryS.value);
  const positionDamping = damping(followPositionS?.value ?? 0);
  const heightDamping = damping(followHeightS?.value ?? 0);
  const recoveryDeadband = recoveryDeadbandM?.value ?? 0;
  const retractStepM = collisionRetractMps.value * STEP_S;
  let followedFeet = character.position;
  let aimBlend = Number(action.aiming);
  let compressionM: number | undefined;
  let retracting = false;

  function sweep(from: Vec3, to: Vec3, queries: SceneQueries) {
    const lengthM = distance(from, to);
    const hit = queries.sweepSphere(from, to, sphereRadiusM.value);
    const allowedM = hit ? Math.min(lengthM, Math.max(0, hit.distanceM - wallClearanceM.value)) : lengthM;
    return { lengthM, allowedM, hit };
  }

  function solve(feet: Vec3, view: ViewAngles, queries: SceneQueries, previous?: CameraPose): CameraPose {
    const { yawRad } = view;
    const mix = (move: number, aim: number) => move + (aim - move) * aimBlend;
    const direction = crosshairDirection(view);
    const height = mix(moveHeightM.value, aimHeightM.value);
    // Sweep from the live character, even while the framing origin is catching up.
    const anchor = { ...feet, y: feet.y + height };
    const back = mix(moveDistanceM.value, aimDistanceM.value);
    const shoulder = mix(moveShoulderM.value, aimShoulderM.value);
    const desired = {
      x: followedFeet.x - direction.x * back + Math.cos(yawRad) * shoulder,
      y: followedFeet.y + height - direction.y * back,
      z: followedFeet.z - direction.z * back - Math.sin(yawRad) * shoulder,
    };
    const { lengthM, allowedM, hit } = sweep(anchor, desired, queries);
    const requiredCompressionM = lengthM - allowedM;
    const sharpRetraction = compressionM !== undefined && requiredCompressionM - compressionM > retractStepM;

    // Damp only the wall correction. In clear space the profile already eases the boom and FOV together.
    if (compressionM === undefined || requiredCompressionM >= compressionM) {
      compressionM = requiredCompressionM;
    } else {
      const targetM = hit ? Math.min(compressionM, requiredCompressionM + recoveryDeadband) : 0;
      if (compressionM - targetM <= SETTLE_DISTANCE_M) compressionM = targetM;
      else compressionM += (targetM - compressionM) * recoveryDamping;
    }
    const boomLengthM = Math.max(0, lengthM - compressionM);
    const goal = interpolate(anchor, desired, lengthM > 0 ? boomLengthM / lengthM : 0);
    let position = goal;
    let obstructed = hit !== null;

    // At a grazing wall, the old camera position may still have a clear path to the player.
    // Sweep the eased position separately so a door or corner can force immediate clearance.
    if (previous && (sharpRetraction || retracting)) {
      const travelM = distance(previous.position, goal);
      if (travelM > retractStepM) {
        const candidate = interpolate(previous.position, goal, retractStepM / travelM);
        const clearance = sweep(anchor, candidate, queries);
        position = interpolate(anchor, candidate, clearance.lengthM > 0 ? clearance.allowedM / clearance.lengthM : 0);
        obstructed ||= clearance.hit !== null;
      }
    }
    retracting = distance(position, goal) > SETTLE_DISTANCE_M;

    return {
      ...view,
      position,
      verticalFovRad: mix(moveVerticalFovRad.value, aimVerticalFovRad.value),
      obstructed,
    };
  }

  const pitchRad = clampPitch(initialPitchRad?.value ?? INITIAL_PITCH_RAD);
  const initial = solve(character.position, { yawRad: character.yawRad, pitchRad }, scene);
  const update: SimulationStages['camera'] = (input, nextCharacter, nextAction, previous, queries) => {
    const yaw = previous.yawRad - input.lookDeltaX * lookRadPerPx.value;
    const pitch = previous.pitchRad - input.lookDeltaY * lookRadPerPx.value;
    const yawRad = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const pitchRad = clampPitch(pitch);
    const feet = nextCharacter.position;
    const followedHeight = followedFeet.y + (feet.y - followedFeet.y) * heightDamping;
    followedFeet = { ...interpolate(followedFeet, feet, positionDamping), y: followedHeight };
    aimBlend += (Number(nextAction.aiming) - aimBlend) * (nextAction.aiming ? aimDamping : moveDamping);
    return solve(feet, { yawRad, pitchRad }, queries, previous);
  };

  return { initial, update };
}
