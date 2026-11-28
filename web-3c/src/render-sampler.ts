import type { ActionPose, FootPlant } from './actions.ts';
import { interpolatePosition } from './camera.ts';
import type { CameraPose, CharacterState, SceneQueries, Vec3 } from './contracts.ts';

export interface RenderSnapshot {
  readonly tick: number;
  readonly character: Pick<CharacterState, 'position' | 'yawRad'>;
  readonly camera: CameraPose;
  readonly cameraAnchor: Vec3;
  readonly actionPose: ActionPose;
}

function blendAngle(from: number, to: number, fraction: number) {
  const delta = to - from;
  return from + Math.atan2(Math.sin(delta), Math.cos(delta)) * fraction;
}

function blendPlant(from: FootPlant | null, to: FootPlant | null, fraction: number): FootPlant | null {
  if (from && to && from.anchor !== to.anchor) {
    return fraction < 0.5 ? { ...from, weight: from.weight * (1 - 2 * fraction) }
      : { ...to, weight: to.weight * (2 * fraction - 1) };
  }
  const plant = to ?? from;
  if (!plant) return null;
  const start = from?.weight ?? 0;
  return { anchor: plant.anchor, weight: start + ((to?.weight ?? 0) - start) * fraction };
}

export function createRenderSampler(
  initial: RenderSnapshot, scene: Pick<SceneQueries, 'sweepSphere'>, radiusM: number,
) {
  let previous = initial;
  let current = initial;
  let pendingShot: RenderSnapshot | undefined;
  let displayedTick = initial.tick;

  function present(frame: RenderSnapshot) {
    displayedTick = frame.tick;
    return frame;
  }

  return {
    commit(frame: RenderSnapshot, fired: boolean) {
      previous = current;
      current = frame;
      if (fired) pendingShot = frame;
    },
    sample(alpha: number): RenderSnapshot {
      if (pendingShot) {
        const shot = pendingShot;
        pendingShot = undefined;
        // More than one simulation step may run before the first frame that can show the shot.
        if (shot === current || !scene.sweepSphere(shot.cameraAnchor, shot.camera.position, radiusM)) {
          return present(shot);
        }
        return present(current);
      }

      if (previous === current) return current;
      // Keep advancing after a shot or a collision fallback has shown a newer fixed step.
      const fraction = Math.max(alpha, displayedTick - previous.tick);
      if (fraction >= 1) return present(current);

      const position = interpolatePosition(previous.camera.position, current.camera.position, fraction);
      const cameraAnchor = interpolatePosition(previous.cameraAnchor, current.cameraAnchor, fraction);
      if (scene.sweepSphere(cameraAnchor, position, radiusM)) return present(current);

      const lerp = (from: number, to: number) => from + (to - from) * fraction;
      const from = previous.actionPose;
      const to = current.actionPose;
      return present({
        tick: previous.tick + fraction,
        character: {
          position: interpolatePosition(previous.character.position, current.character.position, fraction),
          yawRad: blendAngle(previous.character.yawRad, current.character.yawRad, fraction),
        },
        camera: {
          position,
          yawRad: blendAngle(previous.camera.yawRad, current.camera.yawRad, fraction),
          pitchRad: lerp(previous.camera.pitchRad, current.camera.pitchRad),
          verticalFovRad: lerp(previous.camera.verticalFovRad, current.camera.verticalFovRad),
          obstructed: previous.camera.obstructed || current.camera.obstructed,
        },
        cameraAnchor,
        actionPose: {
          ...to,
          aim: {
            idleTimeS: lerp(from.aim.idleTimeS, to.aim.idleTimeS),
            stationaryBlend: lerp(from.aim.stationaryBlend, to.aim.stationaryBlend),
            turn: lerp(from.aim.turn, to.aim.turn),
            turnTimeS: lerp(from.aim.turnTimeS, to.aim.turnTimeS),
            pitchRad: lerp(from.aim.pitchRad, to.aim.pitchRad),
          },
          clockS: lerp(from.clockS, to.clockS),
          walk: {
            cycles: lerp(from.walk.cycles, to.walk.cycles),
            blend: lerp(from.walk.blend, to.walk.blend),
            weights: [
              lerp(from.walk.weights[0], to.walk.weights[0]), lerp(from.walk.weights[1], to.walk.weights[1]),
              lerp(from.walk.weights[2], to.walk.weights[2]), lerp(from.walk.weights[3], to.walk.weights[3]),
            ],
            carryCycles: lerp(from.walk.carryCycles, to.walk.carryCycles),
            hold: lerp(from.walk.hold, to.walk.hold),
            run: lerp(from.walk.run, to.walk.run),
            plants: [blendPlant(from.walk.plants[0], to.walk.plants[0], fraction),
              blendPlant(from.walk.plants[1], to.walk.plants[1], fraction)],
          },
        },
      });
    },
  };
}