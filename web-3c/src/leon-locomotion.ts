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

// Carry-gun starts and stops (Handgun00M strafeF family), indexed [leg][direction] with leg 0 = left, 1 = right and
// direction forward, left, back, right. Root travel per clip from the 60 Hz source; the view reads the exact curves.
export const LEON_START_CLIPS = [[2002, 2003, 2000, 2001], [2022, 2023, 2020, 2021]] as const;
export const LEON_END_CLIPS = [[2502, 2503, 2500, 2501], [2522, 2523, 2520, 2521]] as const;
export const LEON_START_TRAVEL_M = [[2.64624, 2.26167, 1.86503, 2.79254], [3.24563, 2.76836, 2.08099, 2.71033]] as const;
export const LEON_END_TRAVEL_M = { distanceM: 0.4, durationS: 3.7 } as const;

/** PlayerLocomotionSetting._StrafeLeftLegStartDeg = Range(-45, 190), read as start −45° and length 190°. */
export function startLeg(angleDeg: number): 0 | 1 {
  return angleDeg >= -45 && angleDeg <= 145 ? 0 : 1;
}

// In-place turns (Handgun00M, tree ch0100_QuickTrun). Root yaw +90/−90/−180/+180 for L90/R90/L180/R180.
export const LEON_TURN_CLIPS = [
  { id: 314, deg: 90, left: true, durationS: 209 / 60 },
  { id: 315, deg: 90, left: false, durationS: 313 / 60 },
  { id: 310, deg: 180, left: true, durationS: 221 / 60 },
  { id: 311, deg: 180, left: false, durationS: 261 / 60 },
] as const;

// Raise clips of tree ch0100_Hold_Start by the heading change they turn through (deg, positive = left).
export const LEON_RAISE_CLIPS = [
  { id: 159, deg: -180 }, { id: 158, deg: -90 }, { id: 140, deg: 0 }, { id: 141, deg: 90 }, { id: 145, deg: 180 },
] as const;

/** Linear weights over the raise clips for a signed heading change. */
export function raiseWeights(turnRad: number) {
  const deg = Math.max(-180, Math.min(180, turnRad * 180 / Math.PI));
  const weights = LEON_RAISE_CLIPS.map(() => 0);
  const upper = LEON_RAISE_CLIPS.findIndex((clip) => clip.deg >= deg);
  if (upper <= 0) { weights[Math.max(0, upper)] = 1; return weights; }
  const low = LEON_RAISE_CLIPS[upper - 1];
  const high = LEON_RAISE_CLIPS[upper];
  const t = (deg - low.deg) / (high.deg - low.deg);
  weights[upper - 1] = 1 - t;
  weights[upper] = t;
  return weights;
}

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