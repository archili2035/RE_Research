import feel from './feel.json' with { type: 'json' };
import cameraSource from './camera-source.json' with { type: 'json' };
import { STEP_S } from './contracts.ts';
import type { ActionState, CameraPose, CharacterState, FeelConfig, SceneQueries, Vec3, ViewAngles } from './contracts.ts';
import type { SimulationStages } from './simulation.ts';

// PlayerCameraRotationParam TPS_Default: _PitchRangeDeg = Range(-60, 120), read as start and length.
const MIN_PITCH_RAD = -Math.PI / 3;
const MAX_PITCH_RAD = Math.PI / 3;
// arm0000 CameraRecoilParam._Curve, normalized time to normalized kick. Sampled linearly.
const RECOIL_CURVE = [[0, 0], [0.01996, 0], [0.03998, 1], [0.141, 0.8946566], [0.22, 0.5], [1, 0]] as const;

function recoilAt(fraction: number) {
  if (fraction <= 0 || fraction >= 1) return 0;
  for (let i = 1; i < RECOIL_CURVE.length; i += 1) {
    const [t1, v1] = RECOIL_CURVE[i];
    if (fraction > t1) continue;
    const [t0, v0] = RECOIL_CURVE[i - 1];
    return v0 + (v1 - v0) * (fraction - t0) / (t1 - t0);
  }
  return 0;
}
const INITIAL_PITCH_RAD = -0.16;
const SETTLE_DISTANCE_M = 0.001;

function distance(from: Vec3, to: Vec3) {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
}

export function interpolatePosition(from: Vec3, to: Vec3, fraction: number): Vec3 {
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

type Pair = readonly number[];
type Keys = readonly (readonly number[])[];

/** RE DampingParam read as "reach rate of the remaining distance within time": per-step fraction 1 − (1 − rate)^(dt/time). Unverified. */
export function reDamping([timeS, rate]: Pair) {
  if (timeS <= 0 || rate >= 1) return 1;
  return 1 - Math.pow(1 - rate, STEP_S / timeS);
}

function curveAt(keys: Keys, x: number) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    if (x > keys[i][0]) continue;
    const [x0, y0] = keys[i - 1];
    const [x1, y1] = keys[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return keys[keys.length - 1][1];
}

// arm0000 AimCameraShakeParam: pitch wave Range(-0.25, 0.5) and second-wave yaw Range(-0.25, 0.5) (±0.25° read as
// start and length), periods Range(2, 4) → 2–6 s. Two fixed periods inside that range keep the sway deterministic.
const SWAY_PITCH_PERIOD_S = 4;
const SWAY_YAW_PERIOD_S = 5;
// arm0000 CameraShakeParam: 0.2 s life, last 0.1 s attenuated, translation Z Range(-0.1, 0.2) → ±0.1 m, period 0.1 s.
const SHAKE_LIFE_S = 0.2;
const SHAKE_FADE_S = 0.1;
const SHAKE_PERIOD_S = 0.1;

export function createCamera(
  character: CharacterState, action: ActionState, scene: SceneQueries,
  parameters: FeelConfig['camera'] = feel.camera as FeelConfig['camera'],
) {
  const {
    lookRadPerPx, moveDistanceM, aimDistanceM, moveShoulderM, aimShoulderM, moveHeightM, aimHeightM,
    moveVerticalFovRad, aimVerticalFovRad, aimTransitionS, moveTransitionS, recoveryS, sphereRadiusM,
    wallClearanceM, collisionRetractMps, followPositionS, followHeightS, recoveryDeadbandM, initialPitchRad,
    recoilPitchRad, recoilCurveS, cameraProfile, sourceFovHorizontal, sourceAspect, sourcePitchSign, aimSwayDeg, shotShakeM,
  } = parameters;
  const useSource = (cameraProfile?.value ?? 0) >= 0.5;
  const recoilKickRad = recoilPitchRad?.value ?? 0;
  const recoilTicks = Math.max(1, Math.round((recoilCurveS?.value ?? 0) / STEP_S));
  const swayRad = (aimSwayDeg?.value ?? 0) * Math.PI / 180;
  const shakeM = shotShakeM?.value ?? 0;
  const aimDamping = damping(aimTransitionS.value);
  const moveDamping = damping(moveTransitionS.value);
  const recoveryDamping = damping(recoveryS.value);
  const positionDamping = damping(followPositionS?.value ?? 0);
  const heightDamping = damping(followHeightS?.value ?? 0);
  const recoveryDeadband = recoveryDeadbandM?.value ?? 0;
  const retractStepM = collisionRetractMps.value * STEP_S;

  // Source profile constants (camera-source.json, standing Normal and Hold).
  const N = cameraSource.normal;
  const H = cameraSource.hold;
  const aspect = sourceAspect?.value ?? 16 / 9;
  const pitchSign = sourcePitchSign?.value ?? -1; // RE pitch = sign × our pitch (−1: RE positive looks down).
  const toVertical = (deg: number) => (sourceFovHorizontal?.value ?? 1) >= 0.5
    ? 2 * Math.atan(Math.tan(deg * Math.PI / 360) / aspect) : deg * Math.PI / 180;

  // Every mutable value lives in one object so snapshots can save and restore the camera.
  let st = {
    followedFeet: character.position as Vec3, aimBlend: Number(action.aiming), compressionM: undefined as number | undefined,
    retracting: false, lastMagazine: action.magazine, recoilTick: -1, shakeTick: -1, tick: 0,
    basePitchRad: 0, baseYawRad: character.yawRad,
    // source profile
    gazePoint: undefined as Vec3 | undefined, gazeDistanceM: undefined as number | undefined, holdS: 0, holdFrom: 0,
    boomM: undefined as number | undefined, fovAvoid: 0, nearAvoid: 0,
  };

  function sweep(from: Vec3, to: Vec3, queries: SceneQueries, radiusM = sphereRadiusM.value, clearanceM = wallClearanceM.value) {
    const lengthM = distance(from, to);
    const hit = queries.sweepSphere(from, to, radiusM);
    const allowedM = hit ? Math.min(lengthM, Math.max(0, hit.distanceM - clearanceM)) : lengthM;
    return { lengthM, allowedM, hit };
  }

  function solveFit(feet: Vec3, view: ViewAngles, queries: SceneQueries, previous?: CameraPose) {
    const { yawRad } = view;
    const mix = (move: number, aim: number) => move + (aim - move) * st.aimBlend;
    const direction = crosshairDirection(view);
    const height = mix(moveHeightM.value, aimHeightM.value);
    // Sweep from the live character, even while the framing origin is catching up.
    const anchor = { ...feet, y: feet.y + height };
    const back = mix(moveDistanceM.value, aimDistanceM.value);
    const shoulder = mix(moveShoulderM.value, aimShoulderM.value);
    const { followedFeet } = st;
    const desired = {
      x: followedFeet.x - direction.x * back + Math.cos(yawRad) * shoulder,
      y: followedFeet.y + height - direction.y * back,
      z: followedFeet.z - direction.z * back - Math.sin(yawRad) * shoulder,
    };
    const { lengthM, allowedM, hit } = sweep(anchor, desired, queries);
    const requiredCompressionM = lengthM - allowedM;
    const sharpRetraction = st.compressionM !== undefined && requiredCompressionM - st.compressionM > retractStepM;

    // Damp only the wall correction. In clear space the profile already eases the boom and FOV together.
    if (st.compressionM === undefined || requiredCompressionM >= st.compressionM) {
      st.compressionM = requiredCompressionM;
    } else {
      const targetM = hit ? Math.min(st.compressionM, requiredCompressionM + recoveryDeadband) : 0;
      if (st.compressionM - targetM <= SETTLE_DISTANCE_M) st.compressionM = targetM;
      else st.compressionM += (targetM - st.compressionM) * recoveryDamping;
    }
    const boomLengthM = Math.max(0, lengthM - st.compressionM);
    const goal = interpolatePosition(anchor, desired, lengthM > 0 ? boomLengthM / lengthM : 0);
    let position = goal;
    let obstructed = hit !== null;

    // At a grazing wall, the old camera position may still have a clear path to the player.
    // Sweep the eased position separately so a door or corner can force immediate clearance.
    if (previous && (sharpRetraction || st.retracting)) {
      const travelM = distance(previous.position, goal);
      if (travelM > retractStepM) {
        const candidate = interpolatePosition(previous.position, goal, retractStepM / travelM);
        const clearance = sweep(anchor, candidate, queries);
        position = interpolatePosition(anchor, candidate, clearance.lengthM > 0 ? clearance.allowedM / clearance.lengthM : 0);
        obstructed ||= clearance.hit !== null;
      }
    }
    st.retracting = distance(position, goal) > SETTLE_DISTANCE_M;

    const pose: CameraPose = {
      ...view,
      position,
      verticalFovRad: mix(moveVerticalFovRad.value, aimVerticalFovRad.value),
      obstructed,
    };
    return { pose, anchor };
  }

  /**
   * Source profile: the Normal/Hold position, FOV and collision data placed as in the RE camera (gaze point at the
   * root offset, camera behind it by the gaze distance), with pitch curves, paired damping and the Hold timer curve.
   */
  function solveSource(feet: Vec3, view: ViewAngles, queries: SceneQueries, first: boolean) {
    const { yawRad, pitchRad } = view;
    const b = st.aimBlend;
    const mix = (n: number, h: number) => n + (h - n) * b;
    const mixPair = (n: Pair, h: Pair): Pair => [mix(n[0], h[0]), mix(n[1], h[1])];
    const rePitch = pitchSign * pitchRad * 180 / Math.PI;
    const right = { x: Math.cos(yawRad), z: -Math.sin(yawRad) };
    const forward = { x: -Math.sin(yawRad), z: -Math.cos(yawRad) };
    const place = (base: Vec3, [x, y, z]: readonly number[]): Vec3 => ({
      x: base.x + right.x * x + forward.x * z, y: base.y + y, z: base.z + right.z * x + forward.z * z,
    });
    const offset = [0, 1, 2].map((i) => mix(N.offset[i], H.offset[i]));
    offset[1] += mix(curveAt(N.yMoveByPitch as Keys, rePitch), curveAt(H.yMoveByPitch as Keys, rePitch));
    offset[2] += mix(curveAt(N.zMoveByPitch as Keys, rePitch), curveAt(H.zMoveByPitch as Keys, rePitch));
    const targetGaze = place(feet, offset);
    const targetDistance = mix(N.gazeDistanceM * curveAt(N.gazeScaleByPitch as Keys, rePitch),
      H.gazeDistanceM * curveAt(H.gazeScaleByPitch as Keys, rePitch));
    const follow = reDamping(mixPair(N.followOffset as Pair, H.followOffset as Pair));
    const followGaze = reDamping(mixPair(N.followGaze as Pair, H.followGaze as Pair));
    st.gazePoint = first || !st.gazePoint ? targetGaze : interpolatePosition(st.gazePoint, targetGaze, follow);
    st.gazeDistanceM = first || st.gazeDistanceM === undefined ? targetDistance
      : st.gazeDistanceM + (targetDistance - st.gazeDistanceM) * followGaze;
    const direction = crosshairDirection(view);
    const desired = {
      x: st.gazePoint.x - direction.x * st.gazeDistanceM,
      y: st.gazePoint.y - direction.y * st.gazeDistanceM,
      z: st.gazePoint.z - direction.z * st.gazeDistanceM,
    };
    // Collision: sweep from the avoid origin (root offset curves) to the desired camera.
    const origin = place(feet, [0, 1, 2].map((i) =>
      mix(curveAt(N.collision.originByPitch[i] as Keys, rePitch), curveAt(H.collision.originByPitch[i] as Keys, rePitch))));
    const radiusM = mix(N.collision.radiusM, H.collision.radiusM);
    const hard = sweep(origin, desired, queries, radiusM, 0);
    const preliminary = N.collision.preliminary && b < 1
      ? sweep(origin, desired, queries, N.collision.preliminary.radiusM, 0) : undefined;
    const target = Math.min(hard.allowedM, preliminary ? hard.lengthM - (hard.lengthM - preliminary.allowedM) * (1 - b) : hard.allowedM);
    const current = first || st.boomM === undefined ? target : st.boomM;
    const closing = target < current;
    const rate = closing
      ? reDamping(mixPair((preliminary ? N.collision.preliminary!.avoidSpeed : N.collision.avoidSpeed) as Pair, H.collision.avoidSpeed as Pair))
      : reDamping(mixPair(N.collision.returnSpeed as Pair, H.collision.returnSpeed as Pair));
    st.boomM = Math.min(hard.allowedM, current + (target - current) * rate);
    const position = interpolatePosition(origin, desired, hard.lengthM > 0 ? st.boomM / hard.lengthM : 0);
    const obstructed = hard.hit !== null || st.boomM < hard.lengthM - SETTLE_DISTANCE_M;
    // FOV and near-clip avoidance while the camera is pushed in (Normal only).
    const avoidTarget = obstructed ? 1 : 0;
    st.fovAvoid += (avoidTarget - st.fovAvoid) * (first ? 1 : reDamping(N.fov.avoidSpeed as Pair));
    st.nearAvoid += (avoidTarget - st.nearAvoid) * (first ? 1 : reDamping(N.fov.avoidNearSpeed as Pair));
    const fovDeg = mix(N.fov.deg + (N.fov.avoid ? N.fov.avoidDeg * st.fovAvoid : 0), H.fov.deg);
    const nearClipM = mix(N.fov.nearClipM + (N.fov.avoidNear ? N.fov.avoidNearM * st.nearAvoid : 0), H.fov.nearClipM);
    const pose: CameraPose = { ...view, position, verticalFovRad: toVertical(fovDeg), obstructed, nearClipM };
    return { pose, anchor: origin };
  }

  const holdCurve = (H.input.curve ?? [[0, 0], [1, 1]]) as Keys;
  function advanceBlend(aiming: boolean) {
    if (!useSource) {
      st.aimBlend += (Number(aiming) - st.aimBlend) * (aiming ? aimDamping : moveDamping);
      return;
    }
    if (aiming) {
      // Hold input: timed curve over _StateTimer from wherever the blend was.
      if (st.holdS === 0) st.holdFrom = st.aimBlend;
      st.holdS += STEP_S;
      const t = H.input.timerS > 0 ? Math.min(1, st.holdS / H.input.timerS) : 1;
      st.aimBlend = st.holdFrom + (1 - st.holdFrom) * curveAt(holdCurve, t);
    } else {
      st.holdS = 0;
      st.aimBlend -= st.aimBlend * reDamping(N.input.damping as Pair);
      if (st.aimBlend < 1e-4) st.aimBlend = 0;
    }
  }

  function solve(feet: Vec3, view: ViewAngles, queries: SceneQueries, previous?: CameraPose) {
    return useSource ? solveSource(feet, view, queries, !previous) : solveFit(feet, view, queries, previous);
  }

  const pitchRad = clampPitch(initialPitchRad?.value ?? INITIAL_PITCH_RAD);
  st.basePitchRad = pitchRad;
  let solution = solve(character.position, { yawRad: character.yawRad, pitchRad }, scene);
  const initial = solution.pose;
  const update: SimulationStages['camera'] = (input, nextCharacter, nextAction, previous, queries) => {
    st.tick += 1;
    // Mouse input integrates the player-controlled yaw and pitch; kick and sway are added on top of them.
    const yaw = st.baseYawRad - input.lookDeltaX * lookRadPerPx.value;
    st.baseYawRad = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    st.basePitchRad = clampPitch(st.basePitchRad - input.lookDeltaY * lookRadPerPx.value);
    // The kick and the shake start on the step after the shot, so the shot ray uses the unkicked view.
    if (st.recoilTick >= 0) st.recoilTick = st.recoilTick + 1 >= recoilTicks ? -1 : st.recoilTick + 1;
    if (st.shakeTick >= 0) st.shakeTick = (st.shakeTick + 1) * STEP_S >= SHAKE_LIFE_S ? -1 : st.shakeTick + 1;
    if (nextAction.magazine < st.lastMagazine) {
      if (recoilKickRad) st.recoilTick = 0;
      if (shakeM) st.shakeTick = 0;
    }
    st.lastMagazine = nextAction.magazine;
    const kickRad = st.recoilTick > 0 ? recoilKickRad * recoilAt(st.recoilTick / recoilTicks) : 0;
    advanceBlend(nextAction.aiming);
    const timeS = st.tick * STEP_S;
    const sway = swayRad * st.aimBlend;
    const yawRad = Math.atan2(Math.sin(st.baseYawRad + sway * Math.sin(2 * Math.PI * timeS / SWAY_YAW_PERIOD_S)),
      Math.cos(st.baseYawRad + sway * Math.sin(2 * Math.PI * timeS / SWAY_YAW_PERIOD_S)));
    const pitchRad = clampPitch(st.basePitchRad + kickRad + sway * Math.sin(2 * Math.PI * timeS / SWAY_PITCH_PERIOD_S));
    const feet = nextCharacter.position;
    const followedHeight = st.followedFeet.y + (feet.y - st.followedFeet.y) * heightDamping;
    st.followedFeet = { ...interpolatePosition(st.followedFeet, feet, positionDamping), y: followedHeight };
    solution = solve(feet, { yawRad, pitchRad }, queries, previous);
    if (st.shakeTick > 0 && !solution.pose.obstructed) {
      // Fore-aft shot shake along the view, faded over the last SHAKE_FADE_S.
      const age = st.shakeTick * STEP_S;
      const envelope = Math.min(1, (SHAKE_LIFE_S - age) / SHAKE_FADE_S);
      const offset = shakeM * envelope * Math.sin(2 * Math.PI * age / SHAKE_PERIOD_S);
      const d = crosshairDirection(solution.pose);
      const p = solution.pose.position;
      solution = { ...solution, pose: { ...solution.pose, position: { x: p.x + d.x * offset, y: p.y + d.y * offset, z: p.z + d.z * offset } } };
    }
    return solution.pose;
  };

  return {
    initial, update, get anchor() { return solution.anchor; },
    save: () => structuredClone({ st, solution }),
    load(saved: { st: typeof st; solution: typeof solution }) {
      ({ st, solution } = structuredClone(saved));
    },
  };
}