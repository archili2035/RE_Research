import { STEP_S } from './contracts.ts';
import type { CharacterState, FeelConfig } from './contracts.ts';
import type { SimulationStages } from './simulation.ts';

export const CHARACTER_BODY = { radiusM: 0.32, heightM: 1.65 };

const GRAVITY_MPS2 = 9.81;
const GROUND_PROBE_M = 0.01;
const IN_PLACE_TURN_START_RAD = Math.PI / 3;
const IN_PLACE_TURN_DONE_RAD = 0.02;

function groundDisplacement({ grounded, velocity }: CharacterState) {
  return grounded ? -GROUND_PROBE_M : (Math.min(0, velocity.y) - GRAVITY_MPS2 * STEP_S) * STEP_S;
}

const shortestAngle = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians));

type MovementState = { turning: boolean; intended: { x: number; z: number } };
export type MovementStage = SimulationStages['move'] & {
  save(): MovementState;
  load(state: MovementState): void;
};

/**
 * Travel is relative to the committed camera yaw; the heading is separate.
 * - Aiming (or aim requested): the heading turns to camera yaw plus the weapon hold offset. When stationary and
 *   aimChaseS is set, it chases with that time constant so the upper body twist and the wheel steps cover the lag.
 * - Lowered: the heading turns to the travel direction, or to the camera yaw when walkFacesCamera is set
 *   (sprinting always faces travel). With walkFacesCamera, an idle body turns in place once the camera is more than
 *   60° away and finishes the turn.
 * - accelS and decelS ramp the planar speed. Without turnSpeedRadPerS (v4 regression parameters) the heading stays
 *   on the camera yaw and speed changes instantly.
 */
export function createMovement(
  feel: FeelConfig, verticalDisplacement = groundDisplacement,
): MovementStage {
  const {
    aimSpeedMps, sprintSpeedMps, walkSpeedMps, turnSpeedRadPerS, holdYawOffsetRad, accelS, decelS, aimChaseS,
    walkFacesCamera,
  } = feel.movement;
  const headingFollowsCamera = turnSpeedRadPerS === undefined;
  const turnStepRad = (turnSpeedRadPerS?.value ?? Infinity) * STEP_S;
  const holdOffsetRad = holdYawOffsetRad?.value ?? 0;
  const chase = aimChaseS && aimChaseS.value > 0 ? -Math.expm1(-STEP_S / aimChaseS.value) : 1;
  const facesCamera = (walkFacesCamera?.value ?? 0) >= 0.5;
  let turning = false;
  // Intended (pre-collision) planar velocity. Ramping it, not the collided velocity, keeps steps and wall slides moving.
  let intended = { x: 0, z: 0 };

  const move = ((input, previous, scene) => {
    const feet = previous.character.position;
    const cameraYawRad = previous.camera.yawRad;
    const speed = (previous.action.aiming ? aimSpeedMps : input.sprintHeld ? sprintSpeedMps : walkSpeedMps).value;
    const scale = speed / Math.max(1, Math.hypot(input.moveX, input.moveY));
    const cos = Math.cos(cameraYawRad);
    const sin = Math.sin(cameraYawRad);
    let vx = (cos * input.moveX - sin * input.moveY) * scale;
    let vz = (-sin * input.moveX - cos * input.moveY) * scale;
    const requestX = vx;
    const requestZ = vz;
    if (accelS && decelS) {
      const { x: px, z: pz } = intended;
      const desired = Math.hypot(vx, vz);
      const current = Math.hypot(px, pz);
      const rate = desired >= current - 1e-9 ? speed / accelS.value : Math.max(current, speed) / decelS.value;
      const dx = vx - px;
      const dz = vz - pz;
      const change = Math.hypot(dx, dz);
      const limit = rate * STEP_S;
      if (change > limit) {
        vx = px + dx * limit / change;
        vz = pz + dz * limit / change;
      }
    }
    intended = { x: vx, z: vz };
    const motion = scene.moveCapsule({
      feet,
      displacement: { x: vx * STEP_S, y: verticalDisplacement(previous.character), z: vz * STEP_S },
      ...CHARACTER_BODY,
    });

    const heading = previous.character.yawRad;
    const aimed = previous.action.aiming || input.aimHeld;
    const moving = input.moveX !== 0 || input.moveY !== 0;
    let targetYawRad = heading;
    let step = turnStepRad;
    if (headingFollowsCamera) {
      targetYawRad = cameraYawRad;
    } else if (aimed) {
      targetYawRad = cameraYawRad + holdOffsetRad;
      turning = false;
      if (!moving) step = Math.min(turnStepRad, Math.abs(shortestAngle(targetYawRad - heading)) * chase);
    } else if (moving) {
      targetYawRad = facesCamera && !input.sprintHeld ? cameraYawRad : Math.atan2(-requestX, -requestZ);
      turning = false;
    } else if (facesCamera) {
      const diff = Math.abs(shortestAngle(cameraYawRad - heading));
      if (diff > IN_PLACE_TURN_START_RAD) turning = true;
      if (turning) targetYawRad = cameraYawRad;
      if (turning && diff < IN_PLACE_TURN_DONE_RAD) turning = false;
    }
    const turnRad = shortestAngle(targetYawRad - heading);
    const yawRad = headingFollowsCamera ? cameraYawRad : shortestAngle(heading + Math.max(-step, Math.min(step, turnRad)));

    const { x, y, z } = motion.displacement;
    return {
      position: { x: feet.x + x, y: feet.y + y, z: feet.z + z },
      yawRad,
      velocity: { x: x / STEP_S, y: y / STEP_S, z: z / STEP_S },
      grounded: motion.grounded,
    };
  }) as MovementStage;
  move.save = () => ({ turning, intended: { ...intended } });
  move.load = (state) => { turning = state.turning; intended = { ...state.intended }; };
  return move;
}