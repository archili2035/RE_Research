import { Matrix4, Quaternion, Vector3 } from 'three';

export type LocalPose = Readonly<{
  position: readonly number[];
  rotation: readonly number[];
  scale: readonly number[];
}>;

function worldChain(poses: readonly LocalPose[]) {
  const translation = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  let parent = new Matrix4();
  return poses.map((pose) => {
    parent = new Matrix4().compose(
      translation.fromArray(pose.position), rotation.fromArray(pose.rotation), scale.fromArray(pose.scale),
    ).premultiply(parent);
    return parent;
  });
}

// Chain order is hip, thigh, shin, ankle, foot, toe. Keep the animated ankle's orientation.
export function plantToe(base: readonly LocalPose[], walk: readonly LocalPose[], weight: number) {
  const [hip, upper, lower, ankle, , toe] = worldChain(base);
  const position = (matrix: Matrix4) => new Vector3().setFromMatrixPosition(matrix);
  const rotation = (matrix: Matrix4) => new Quaternion().setFromRotationMatrix(matrix).normalize();
  const start = position(upper);
  const knee = position(lower);
  const end = position(ankle);
  const offset = position(worldChain(walk)[5]).sub(position(toe));
  offset.y = 0;
  const goal = end.clone().addScaledVector(offset, weight);
  const upperLength = start.distanceTo(knee);
  const lowerLength = knee.distanceTo(end);
  const axis = goal.sub(start);
  const length = Math.min(upperLength + lowerLength - 1e-5, Math.max(Math.abs(upperLength - lowerLength) + 1e-5, axis.length()));
  axis.normalize();
  const pole = knee.clone().sub(start);
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-10) return undefined;
  pole.normalize();

  const projection = (upperLength ** 2 - lowerLength ** 2 + length ** 2) / (2 * length);
  const upperTarget = axis.clone().multiplyScalar(projection)
    .addScaledVector(pole, Math.sqrt(Math.max(0, upperLength ** 2 - projection ** 2)));
  const lowerTarget = axis.multiplyScalar(length).sub(upperTarget);
  const worldUpper = rotation(upper).premultiply(new Quaternion().setFromUnitVectors(
    knee.clone().sub(start).normalize(), upperTarget.normalize(),
  ));
  const worldLower = rotation(lower).premultiply(new Quaternion().setFromUnitVectors(
    end.sub(knee).normalize(), lowerTarget.normalize(),
  ));
  return [
    rotation(hip).invert().multiply(worldUpper).toArray(),
    worldUpper.clone().invert().multiply(worldLower).toArray(),
    worldLower.clone().invert().multiply(rotation(ankle)).toArray(),
  ];
}
