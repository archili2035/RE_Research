// Leon locomotion constants read from the decoded 60 Hz source loops.
// Root travel per loop comes from reports/web-3c/source-data/leon-3c-source.json (clipRootSpeeds).

// Aimed strafe set, bank 100. Tree ch0100_Hold_strafe (motion tree 2) blends 120/124/122/126 on a circle.
export const LEON_WALK = [
  { id: 120, distanceM: 1.75998, leftPlantS: 36 / 60, rightPlantS: 84 / 60 },
  { id: 122, distanceM: 1.53999, leftPlantS: 34 / 60, rightPlantS: 74 / 60 },
  { id: 124, distanceM: 1.39327, leftPlantS: 31 / 60, rightPlantS: 64 / 60 },
  { id: 126, distanceM: 1.52162, leftPlantS: 38 / 60, rightPlantS: 80 / 60 },
] as const;

// Carry-gun walk set, bank 200 (Handgun00M), ordered forward, left, back, right. Tree ch0100_tram_strafe_front
// (motion tree 120) blends 2202/2203/2200/2201 on a circle. All four loops are 72 frames, so one phase keeps them in sync.
export const LEON_MOVE_WALK = [
  { id: 2202, distanceM: 2.16, durationS: 1.2 },
  { id: 2203, distanceM: 1.73995, durationS: 1.2 },
  { id: 2200, distanceM: 1.62002, durationS: 1.2 },
  { id: 2201, distanceM: 1.74005, durationS: 1.2 },
] as const;

// Forward run loop, bank 200 (Handgun00M_5102), used by tree ch0100_Run_Loop (motion tree 101).
export const LEON_MOVE_RUN = { id: 5102, distanceM: 5.98558, durationS: 100 / 60 } as const;

// Root speeds of the forward loops (m/s). They match the FeelConfig v5 aim, walk and sprint speeds.
export const LEON_ROOT_SPEED = {
  aim: LEON_WALK[0].distanceM / (96 / 60),
  walk: LEON_MOVE_WALK[0].distanceM / LEON_MOVE_WALK[0].durationS,
  run: LEON_MOVE_RUN.distanceM / LEON_MOVE_RUN.durationS,
} as const;

export type LeonWalkWeights = readonly [forward: number, left: number, back: number, right: number];
type StrideSet = readonly Readonly<{ distanceM: number }>[];

/**
 * Circular blend between the two neighbouring direction loops, as in an OctSyncBlend node with
 * CircledBlend=true. Inputs are the local velocity components.
 */
export function leonDirectionWeights(right: number, forward: number): LeonWalkWeights {
  // Ignore tiny cross-axis corrections from the collision solver during cardinal travel.
  const threshold = 0.02 * Math.hypot(right, forward);
  if (Math.abs(right) < threshold) right = 0;
  if (Math.abs(forward) < threshold) forward = 0;
  if (right === 0 && forward === 0) return [1, 0, 0, 0];
  // Clockwise from forward when viewed from above: forward 0, right 1, back 2, left 3 quarter turns.
  const quarter = ((Math.atan2(right, forward) / (Math.PI / 2)) % 4 + 4) % 4;
  const lower = Math.floor(quarter) % 4;
  const upper = (lower + 1) % 4;
  const t = quarter - Math.floor(quarter);
  const byQuarter = [0, 0, 0, 0];
  byQuarter[lower] += 1 - t;
  byQuarter[upper] += t;
  return [byQuarter[0], byQuarter[3], byQuarter[2], byQuarter[1]];
}

/** Root travel of one blended cycle. Dividing the speed by it keeps the blended root travel equal to the actual travel. */
export function blendedStride(weights: LeonWalkWeights, set: StrideSet) {
  return weights.reduce((sum, weight, i) => sum + weight * set[i].distanceM, 0);
}

export function leonWalkBlend(right: number, forward: number) {
  const weights = leonDirectionWeights(right, forward);
  const cyclesPerSecond = Math.hypot(right, forward) / blendedStride(weights, LEON_WALK);
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