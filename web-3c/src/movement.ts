import { STEP_S } from './contracts.ts';
import type { CharacterState, FeelConfig } from './contracts.ts';
import type { SimulationStages } from './simulation.ts';

export const CHARACTER_BODY = { radiusM: 0.32, heightM: 1.65 };

const GRAVITY_MPS2 = 9.81;
const GROUND_PROBE_M = 0.01;

function groundDisplacement({ grounded, velocity }: CharacterState) {
  return grounded ? -GROUND_PROBE_M : (Math.min(0, velocity.y) - GRAVITY_MPS2 * STEP_S) * STEP_S;
}

const shortestAngle = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians));

/**
 * Travel is relative to the committed camera yaw. The character heading is separate:
 * - while aiming, or when aim is requested, it turns to the camera yaw plus the weapon hold offset;
 * - otherwise it turns toward the requested travel direction and keeps its heading when idle.
 * Both use the same capped turn rate, so a reversal passes through the side loops instead of snapping.
 */
export function createMovement(
  feel: FeelConfig, verticalDisplacement = groundDisplacement,
): SimulationStages['move'] {
  const { aimSpeedMps, sprintSpeedMps, walkSpeedMps, turnSpeedRadPerS, holdYawOffsetRad } = feel.movement;
  // FeelConfig v4 had no heading model: without turnSpeedRadPerS the heading stays on the camera yaw.
  const headingFollowsCamera = turnSpeedRadPerS === undefined;
  const turnStepRad = (turnSpeedRadPerS?.value ?? Infinity) * STEP_S;
  const holdOffsetRad = holdYawOffsetRad?.value ?? 0;
  return (input, previous, scene) => {
    const feet = previous.character.position;
    const cameraYawRad = previous.camera.yawRad;
    const speed = (previous.action.aiming ? aimSpeedMps : input.sprintHeld ? sprintSpeedMps : walkSpeedMps).value;
    const scale = speed * STEP_S / Math.max(1, Math.hypot(input.moveX, input.moveY));
    const cos = Math.cos(cameraYawRad);
    const sin = Math.sin(cameraYawRad);
    const requestX = (cos * input.moveX - sin * input.moveY) * scale;
    const requestZ = (-sin * input.moveX - cos * input.moveY) * scale;
    const motion = scene.moveCapsule({
      feet,
      displacement: { x: requestX, y: verticalDisplacement(previous.character), z: requestZ },
      ...CHARACTER_BODY,
    });

    const aimed = headingFollowsCamera || previous.action.aiming || input.aimHeld;
    const moving = input.moveX !== 0 || input.moveY !== 0;
    const targetYawRad = headingFollowsCamera ? cameraYawRad : aimed ? cameraYawRad + holdOffsetRad
      : moving ? Math.atan2(-requestX, -requestZ) : previous.character.yawRad;
    const turnRad = shortestAngle(targetYawRad - previous.character.yawRad);
    const yawRad = shortestAngle(previous.character.yawRad + Math.max(-turnStepRad, Math.min(turnStepRad, turnRad)));

    const { x, y, z } = motion.displacement;
    return {
      position: { x: feet.x + x, y: feet.y + y, z: feet.z + z },
      yawRad,
      velocity: { x: x / STEP_S, y: y / STEP_S, z: z / STEP_S },
      grounded: motion.grounded,
    };
  };
}