import { Matrix4, Quaternion, Vector3 } from 'three';

export type LocalPose = Readonly<{
  position: readonly number[];
  rotation: readonly number[];
  scale: readonly number[];
}>;

function chainMatrices(poses: readonly LocalPose[]) {
  const translation = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  let parent = new Matrix4();
  return poses.map((pose) => {
    parent = new Matrix4().compose(translation.fromArray(pose.position), rotation.fromArray(pose.rotation),
      scale.fromArray(pose.scale)).premultiply(parent);
    return parent;
  });
}

const position = (matrix: Matrix4) => new Vector3().setFromMatrixPosition(matrix);
const rotation = (matrix: Matrix4) => new Quaternion().setFromRotationMatrix(matrix).normalize();
export const toePosition = (poses: readonly LocalPose[]) => position(chainMatrices(poses)[5]);

// Hip, thigh, shin, ankle, foot and toe in model space. Preserve the animated foot roll and height.
export function plantToe(poses: readonly LocalPose[], target: Vector3, weight: number) {
  const [hip, thigh, shin, ankle, , toe] = chainMatrices(poses);
  const start = position(thigh);
  const upper = position(shin).sub(start);
  const lower = position(ankle).sub(position(shin));
  const restAxis = upper.clone().add(lower);
  const restReach = restAxis.length();
  restAxis.normalize();

  const correction = target.clone().sub(position(toe));
  correction.y = 0;
  correction.clampLength(0, 0.52).multiplyScalar(weight);
  if (correction.lengthSq() < 1e-12) return;

  const pole = upper.clone().addScaledVector(restAxis, -upper.dot(restAxis));
  if (pole.lengthSq() < 1e-10) return;
  const goal = restAxis.clone().multiplyScalar(restReach).add(correction);
  const a = upper.length();
  const b = lower.length();
  const bentReach = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(0.24));
  const reach = Math.max(restReach, bentReach);
  // Limit reach in the ground plane. A target beyond the leg's reach must not pull the toe upward.
  const horizontalReach = Math.sqrt(Math.max(0, reach * reach - goal.y * goal.y));
  const lateral = new Vector3(goal.x, 0, goal.z).clampLength(0, horizontalReach);
  goal.set(lateral.x, goal.y, lateral.z);
  const axis = goal.clone().normalize();
  // Transport the authored bend plane with the leg axis so a reversal cannot flip the knee pole.
  pole.normalize().applyQuaternion(new Quaternion().setFromUnitVectors(restAxis, axis));
  const distance = Math.max(Math.abs(a - b) + 1e-5, goal.length());
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const upperTarget = axis.clone().multiplyScalar(along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
  const lowerTarget = axis.multiplyScalar(distance).sub(upperTarget);
  const thighWorld = rotation(thigh).premultiply(new Quaternion().setFromUnitVectors(upper.normalize(), upperTarget.normalize()));
  const shinWorld = rotation(shin).premultiply(new Quaternion().setFromUnitVectors(lower.normalize(), lowerTarget.normalize()));
  return [rotation(hip).invert().multiply(thighWorld).toArray(),
    thighWorld.clone().invert().multiply(shinWorld).toArray(),
    shinWorld.clone().invert().multiply(rotation(ankle)).toArray()];
}
