import { STEP_S } from './contracts.ts';
import type { CharacterState, FeelConfig } from './contracts.ts';
import type { SimulationStages } from './simulation.ts';

export const CHARACTER_BODY = { radiusM: 0.32, heightM: 1.65 };

const GRAVITY_MPS2 = 9.81;
const GROUND_PROBE_M = 0.01;

function groundDisplacement({ grounded, velocity }: CharacterState) {
  return grounded ? -GROUND_PROBE_M : (Math.min(0, velocity.y) - GRAVITY_MPS2 * STEP_S) * STEP_S;
}

export function createMovement(
  feel: FeelConfig, verticalDisplacement = groundDisplacement,
): SimulationStages['move'] {
  const { aimSpeedMps, sprintSpeedMps, walkSpeedMps } = feel.movement;
  return (input, previous, scene) => {
    const feet = previous.character.position;
    const yawRad = previous.camera.yawRad;
    const speed = (previous.action.aiming ? aimSpeedMps : input.sprintHeld ? sprintSpeedMps : walkSpeedMps).value;
    const scale = speed * STEP_S / Math.max(1, Math.hypot(input.moveX, input.moveY));
    const cos = Math.cos(yawRad);
    const sin = Math.sin(yawRad);
    const motion = scene.moveCapsule({
      feet,
      displacement: {
        x: (cos * input.moveX - sin * input.moveY) * scale,
        y: verticalDisplacement(previous.character),
        z: (-sin * input.moveX - cos * input.moveY) * scale,
      },
      ...CHARACTER_BODY,
    });
    const { x, y, z } = motion.displacement;
    return {
      position: { x: feet.x + x, y: feet.y + y, z: feet.z + z },
      yawRad,
      velocity: { x: x / STEP_S, y: y / STEP_S, z: z / STEP_S },
      grounded: motion.grounded,
    };
  };
}
