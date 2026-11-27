// Horizontal root travel and left/right plant times measured from the decoded 60 Hz loops.
export const LEON_WALK = [
  { id: 120, distanceM: 1.75998, leftPlantS: 36 / 60, rightPlantS: 84 / 60 },
  { id: 122, distanceM: 1.53999, leftPlantS: 34 / 60, rightPlantS: 74 / 60 },
  { id: 124, distanceM: 1.39327, leftPlantS: 31 / 60, rightPlantS: 64 / 60 },
  { id: 126, distanceM: 1.52162, leftPlantS: 38 / 60, rightPlantS: 80 / 60 },
] as const;

export type LeonWalkWeights = readonly [forward: number, left: number, back: number, right: number];

export function leonWalkBlend(right: number, forward: number) {
  // Ignore tiny cross-axis corrections from the collision solver during cardinal travel.
  const threshold = 0.02 * Math.hypot(right, forward);
  if (Math.abs(right) < threshold) right = 0;
  if (Math.abs(forward) < threshold) forward = 0;
  const front = Math.max(0, forward) / LEON_WALK[0].distanceM;
  const left = Math.max(0, -right) / LEON_WALK[1].distanceM;
  const back = Math.max(0, -forward) / LEON_WALK[2].distanceM;
  const side = Math.max(0, right) / LEON_WALK[3].distanceM;
  const cyclesPerSecond = front + left + back + side;
  // Distance-normalized weights align the blended root track with both velocity components.
  const weights: LeonWalkWeights = [front / cyclesPerSecond, left / cyclesPerSecond,
    back / cyclesPerSecond, side / cyclesPerSecond];
  return { cyclesPerSecond, weights };
}

export function leonWalkTime(cycles: number, index: number, duration: number) {
  const { leftPlantS, rightPlantS } = LEON_WALK[index];
  const phase = cycles % 1; // A new run starts at the shared left-foot contact.
  const time = phase < 0.5
    ? leftPlantS + (rightPlantS - leftPlantS) * phase * 2
    : rightPlantS + (duration + leftPlantS - rightPlantS) * (phase - 0.5) * 2;
  return time % duration;
}
