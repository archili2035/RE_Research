import { STEP_S } from './contracts.ts';
import type { ActionState, CharacterState, ClipManifest, FeelConfig, Vec3 } from './contracts.ts';
import {
  LEON_END_TRAVEL_M, LEON_MOVE_RUN, LEON_MOVE_WALK, LEON_ROOT_SPEED, LEON_START_TRAVEL_M, LEON_TURN_CLIPS,
  blendedStride, leonWalkBlend, startLeg,
} from './leon-locomotion.ts';
import type { LeonWalkWeights } from './leon-locomotion.ts';
import type { SimulationStages } from './simulation.ts';

type WeaponAction = 'raise' | 'lower' | 'fire' | 'reload';

export interface ActionPose {
  readonly clip: WeaponAction | null;
  readonly progress: number;
  readonly lift: number;
  readonly gaitPhaseRad: number;
  readonly gaitWeight: number;
  readonly walk: WalkPose;
  readonly aim: AimPose;
  readonly clockS: number; // Simulation time, for idle loops in the character view.
  /** Signed heading change requested when the current raise began (radians, positive = left). Picks 140/141/145/158/159. */
  readonly raiseTurnRad: number;
  /** True while the current fire came from the HoldStartShoot branch (fired before the raise finished). Uses 100/1040. */
  readonly holdStartShoot: boolean;
  /** Seconds since the last lower began, or -1. Drives 100/161 Hold_End. */
  readonly lowerS: number;
}

export interface AimPose {
  readonly idleTimeS: number;
  readonly stationaryBlend: number;
  readonly turn: number;
  readonly turnTimeS: number;
  readonly pitchRad: number; // Committed camera pitch, shared by the upper body while aiming.
  readonly yawTwistRad: number; // Camera target minus heading while the body lags (aimed and stationary).
  readonly turnSpeed: number; // WheelSpeed play-rate factor.
}

export interface WalkPose {
  readonly cycles: number;
  readonly blend: number;
  readonly weights: LeonWalkWeights;
  readonly carryCycles: number; // Phase of the carry-gun walk and run loops (bank 200), advanced by their own stride.
  readonly hold: number; // 1 for the aimed strafe set (bank 100), 0 for the carry-gun walk and run set (bank 200).
  readonly run: number; // Run loop share inside the carry-gun set.
  readonly plants: readonly [FootPlant | null, FootPlant | null];
  readonly transition: LocoTransition | null;
  readonly turn: InPlaceTurn | null;
}

/** Carry-gun start or stop clip state. The view converts distance to clip time with the clip's root travel. */
export interface LocoTransition {
  readonly kind: 'start' | 'stop';
  readonly dir: 0 | 1 | 2 | 3; // forward, left, back, right relative to the heading
  readonly leg: 0 | 1; // 0 left, 1 right
  readonly distanceM: number;
  readonly remainM: number; // stop: expected deceleration travel when the stop began
  readonly stillS: number; // stop: seconds since the capsule came to rest
  readonly elapsedS: number;
}

/** Carry-gun in-place turn (Handgun00M 310–315). The view maps progress to time with the clip's root yaw. */
export interface InPlaceTurn {
  readonly clip: number; // Handgun00M motion id
  readonly totalRad: number;
  readonly doneRad: number;
  readonly elapsedS: number;
}

export interface FootPlant {
  readonly anchor: Readonly<Pick<WalkPose, 'cycles' | 'carryCycles' | 'blend' | 'weights' | 'hold' | 'run'> & { position: Vec3; yawRad: number }>;
  readonly weight: number;
}

const fixedTicks = (seconds: number) => Math.max(1, Math.ceil(seconds / STEP_S - 1e-9));
const MOVING_THRESHOLD_MPS = 0.1;
const DEFAULT_WALK_BLEND_IN_S = 0.10;
const DEFAULT_WALK_BLEND_OUT_S = 0.13;
const FOOT_SETTLE_PER_STEP = 0.15;
const IN_PLACE_TURN_THRESHOLD_RAD = Math.PI / 3;
const DIRECTION_DAMPING = 1 - Math.exp(-STEP_S / 0.055);
const MAX_DIRECTION_WEIGHT_CHANGE = 7.8 * STEP_S;
const AIM_TURN_DAMPING = 1 - Math.exp(-STEP_S / 0.075);
const AIM_TURN_DEAD_ZONE_RAD_S = 0.11;
const AIM_TURN_FULL_RAD_S = 0.43;
const aimAtRest: AimPose = { idleTimeS: 0, stationaryBlend: 0, turn: 0, turnTimeS: 0, pitchRad: 0, yawTwistRad: 0, turnSpeed: 1 };
const shortestAngle = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians));

/** Piecewise-linear via.AnimationCurve sampling with clamped ends. */
export function sampleCurve(keys: readonly (readonly [number, number])[], x: number) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [x1, y1] = keys[i];
    if (x > x1) continue;
    const [x0, y0] = keys[i - 1];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return keys[keys.length - 1][1];
}
// PlayerRotateConfiguration._TPSRotation: WheelBlendRate over heading difference (deg), WheelSpeed over |difference|.
const WHEEL_BLEND_RATE: readonly (readonly [number, number])[] = [[-180, 0.0001], [-20, 0.0001], [0, 0.5], [20, 1], [180, 1]];
const WHEEL_SPEED: readonly (readonly [number, number])[] = [[0, 1], [180, 5]];

export interface ActionOptions {
  /** Reference speed for the original rehearsal figure's procedural leg swing. */
  readonly gaitReferenceMps?: number;
  /** Carry-gun walking faces the camera (strafe set and in-place turns) instead of the travel direction. */
  readonly walkFacesCamera?: boolean;
  /** Deceleration time used to predict the stop clip's remaining travel. */
  readonly decelS?: number;
  /** Committed camera yaw of the previous step (for in-place turns). */
  readonly cameraYaw?: () => number;
}
const RUN_DAMPING = 1 - Math.exp(-STEP_S / 0.12);

const START_BLOCKED_S = 0.1;

function smoothstep(value: number, from: number, to: number) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function createWalk(blendInS: number, blendOutS: number, options: ActionOptions) {
  const initialWalk: WalkPose = {
    cycles: 0, carryCycles: 0, blend: 0, weights: [1, 0, 0, 0], hold: 0, run: 0, plants: [null, null], transition: null, turn: null,
  };
  let walk = initialWalk;
  let lastDirection: { right: number; forward: number } | undefined;
  let catchFromCycle = 0;
  let catchThroughCycle = 0;
  let wasMoving = false;
  const decelS = options.decelS ?? 0;

  function gait(character: CharacterState, speed: number, lift: number): Pick<WalkPose, 'cycles' | 'carryCycles' | 'blend' | 'weights' | 'hold' | 'run'> {
    const hold = lift;
    if (!character.grounded || speed <= MOVING_THRESHOLD_MPS) {
      lastDirection = undefined;
      catchThroughCycle = 0;
      return { cycles: walk.cycles, carryCycles: walk.carryCycles, weights: walk.weights, hold, run: walk.run * (1 - RUN_DAMPING),
        blend: Math.max(0, walk.blend - STEP_S / blendOutS) };
    }
    // A 5% band above the walk loop absorbs collision rounding so steady walking stays on the walk loops.
    const walkBandMps = 1.05 * LEON_ROOT_SPEED.walk;
    const runTarget = hold > 0 ? 0 : Math.max(0, Math.min(1,
      (speed - walkBandMps) / (LEON_ROOT_SPEED.run - walkBandMps)));
    const run = walk.run + (runTarget - walk.run) * RUN_DAMPING;

    const { velocity, yawRad } = character;
    const sin = Math.sin(yawRad);
    const cos = Math.cos(yawRad);
    const localRight = cos * velocity.x - sin * velocity.z;
    const localForward = -sin * velocity.x - cos * velocity.z;
    const direction = { right: localRight / speed, forward: localForward / speed };
    if (lastDirection && direction.right * lastDirection.right + direction.forward * lastDirection.forward < -0.85 &&
        walk.plants.some((plant) => plant && plant.weight >= 0.8) && walk.cycles % 0.5 < 0.34) {
      // Shorten the catch step on a hard reversal, ending at the next authored foot contact.
      catchFromCycle = walk.cycles;
      catchThroughCycle = (Math.floor(walk.cycles * 2) + 1) / 2;
    }
    lastDirection = direction;
    const target = leonWalkBlend(localRight, localForward);
    // Each set advances by its own blended root stride, so either set matches the committed travel.
    const advance = target.cyclesPerSecond * STEP_S;
    const carryStrideM = (1 - run) * blendedStride(target.weights, LEON_MOVE_WALK) + run * LEON_MOVE_RUN.distanceM;
    const carryCycles = walk.carryCycles + speed / carryStrideM * STEP_S;
    const catchRate = 0.85 * smoothstep(walk.cycles - catchFromCycle, -0.02, 0.04);
    const catchAdvance = Math.min(catchRate * advance, Math.max(0, catchThroughCycle - walk.cycles - advance));
    const largestChange = Math.max(...walk.weights.map((value, i) => Math.abs(value - target.weights[i])));
    const crossfade = walk.blend > 0 && largestChange > 0.001;
    const factor = Math.min(DIRECTION_DAMPING, MAX_DIRECTION_WEIGHT_CHANGE / Math.max(0.001, largestChange));
    const weight = (index: number) => walk.weights[index] + (target.weights[index] - walk.weights[index]) * factor;
    return {
      cycles: walk.cycles + advance + catchAdvance,
      blend: Math.min(1, walk.blend + STEP_S / blendInS),
      weights: crossfade ? [weight(0), weight(1), weight(2), weight(3)] : target.weights,
      carryCycles, hold, run,
    };
  }

  function localDirection(character: CharacterState, x: number, z: number) {
    const sin = Math.sin(character.yawRad);
    const cos = Math.cos(character.yawRad);
    return { right: cos * x - sin * z, forward: -sin * x - cos * z };
  }

  function dirIndex(right: number, forward: number): 0 | 1 | 2 | 3 {
    if (Math.abs(forward) >= Math.abs(right)) return forward >= 0 ? 0 : 2;
    return right < 0 ? 1 : 3;
  }

  function nextTransition(character: CharacterState, speed: number, moveRequested: boolean, carry: boolean): LocoTransition | null {
    const current = walk.transition;
    const moving = character.grounded && speed > MOVING_THRESHOLD_MPS;
    if (!carry || !character.grounded) return null;
    if (current?.kind === 'start') {
      if (!moveRequested) return beginStop(character, speed);
      const distanceM = current.distanceM + speed * STEP_S;
      const stillS = moving ? 0 : current.stillS + STEP_S;
      // A start blocked by a wall would otherwise hold its first frames for as long as the key is held.
      if (distanceM >= LEON_START_TRAVEL_M[current.leg][current.dir] || stillS >= START_BLOCKED_S) return null;
      return { ...current, distanceM, stillS, elapsedS: current.elapsedS + STEP_S };
    }
    if (current?.kind === 'stop') {
      if (moveRequested) return beginStart(character);
      if (current.elapsedS + STEP_S >= LEON_END_TRAVEL_M.durationS) return null;
      return { ...current, distanceM: current.distanceM + speed * STEP_S, stillS: moving ? current.stillS : current.stillS + STEP_S,
        elapsedS: current.elapsedS + STEP_S };
    }
    if (moveRequested && !wasMoving && walk.blend === 0) return beginStart(character);
    if (!moveRequested && wasMoving) return beginStop(character, speed);
    return null;
  }

  function beginStart(character: CharacterState): LocoTransition {
    const { right, forward } = localDirection(character, character.velocity.x, character.velocity.z);
    const angleDeg = Math.atan2(right, forward) * 180 / Math.PI;
    // Facing travel: the heading turns procedurally, so the start always uses the forward clip.
    const dir = options.walkFacesCamera ? dirIndex(right, forward) : 0;
    return { kind: 'start', dir, leg: startLeg(angleDeg), distanceM: 0, remainM: 0, stillS: 0, elapsedS: 0 };
  }

  function beginStop(character: CharacterState, speed: number): LocoTransition {
    const { right, forward } = lastDirection ?? { right: 0, forward: 1 };
    const dir = options.walkFacesCamera ? dirIndex(right, forward) : 0;
    // Foot that is about to land, by carry-loop phase. The original leg rule is unverified.
    const leg = (walk.carryCycles % 1) < 0.5 ? 0 : 1;
    void character;
    return { kind: 'stop', dir, leg, distanceM: 0, remainM: speed * decelS / 2, stillS: 0, elapsedS: 0 };
  }

  function nextTurn(character: CharacterState, cameraYawRad: number | undefined, carry: boolean, moving: boolean): InPlaceTurn | null {
    const current = walk.turn;
    if (!options.walkFacesCamera || !carry || moving || cameraYawRad === undefined) return null;
    if (current) {
      const doneRad = Math.min(Math.abs(current.totalRad), current.doneRad + Math.abs(shortestAngle(character.yawRad - lastHeading)));
      const durationS = LEON_TURN_CLIPS.find(({ id }) => id === current.clip)!.durationS;
      if (current.elapsedS + STEP_S >= durationS) return null;
      return { ...current, doneRad, elapsedS: current.elapsedS + STEP_S };
    }
    const diff = shortestAngle(cameraYawRad - character.yawRad);
    if (Math.abs(diff) < IN_PLACE_TURN_THRESHOLD_RAD) return null;
    const magnitude = Math.abs(diff) < Math.PI * 0.75 ? 90 : 180;
    const clip = LEON_TURN_CLIPS.find((item) => item.deg === magnitude && item.left === diff > 0)!.id;
    return { clip, totalRad: diff, doneRad: 0, elapsedS: 0 };
  }

  let lastHeading = 0;
  function update(character: CharacterState, speed: number, lift: number, moveRequested = speed > MOVING_THRESHOLD_MPS, cameraYawRad?: number) {
    if (lift <= 0.65) catchThroughCycle = 0;
    const next = gait(character, speed, lift);
    const carry = lift < 0.5;
    const transition = nextTransition(character, speed, moveRequested, carry);
    const turn = nextTurn(character, cameraYawRad, carry, moveRequested);
    lastHeading = character.yawRad;
    wasMoving = moveRequested;
    const moving = character.grounded && speed > MOVING_THRESHOLD_MPS;
    const aim = smoothstep(lift, 0.65, 1);
    const contact = (side: 0 | 1): FootPlant | null => {
      const existing = walk.plants[side];
      if (!character.grounded || aim === 0 || (!moving && !existing)) return null;
      if (!moving && existing) {
        // Once stopped, settle the remaining stance foot to full support instead of freezing a partial weight.
        const yaw = character.yawRad - existing.anchor.yawRad;
        const facing = 1 - smoothstep(Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw))), 0.08, 0.40);
        const level = 1 - smoothstep(Math.abs(character.position.y - existing.anchor.position.y), 0.03, 0.075);
        const full = aim * facing * level;
        return full ? { anchor: existing.anchor, weight: Math.min(full, existing.weight + FOOT_SETTLE_PER_STEP) } : null;
      }
      const phase = (next.cycles + side * 0.5) % 1;
      const release = next.cycles < catchThroughCycle ? 0.30 : 0.36;
      const support = smoothstep(phase, 0.015, 0.075) * (1 - smoothstep(phase, release, 0.48));
      // A stopped character keeps its stance. Turning, lowering or the next swing releases the foot.
      const settle = moving && !existing ? smoothstep(next.blend, 0.50, 0.85) : 1;
      if (!support || !settle) return null;
      const anchor = existing?.anchor ?? { ...next, position: character.position, yawRad: character.yawRad };
      const yaw = character.yawRad - anchor.yawRad;
      const turn = Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw)));
      const level = 1 - smoothstep(Math.abs(character.position.y - anchor.position.y), 0.03, 0.075);
      const heading = 1 - smoothstep(turn, 0.08, 0.40);
      const requested = support * settle * aim * level * heading;
      // Release to swing by phase. Keep the same anchor when the velocity reverses inside a contact.
      const weight = moving ? Math.min(requested, (existing?.weight ?? 0) + 0.30) : Math.min(requested, existing!.weight);
      return { anchor, weight };
    };
    walk = { ...next, plants: [contact(0), contact(1)], transition, turn };
    return walk;
  }

  return {
    initial: initialWalk, update,
    save: () => structuredClone({ walk, lastDirection, catchFromCycle, catchThroughCycle, wasMoving, lastHeading }),
    load(state: ReturnType<typeof structuredClone<object>>) {
      ({ walk, lastDirection, catchFromCycle, catchThroughCycle, wasMoving, lastHeading } = structuredClone(state) as {
        walk: WalkPose; lastDirection: typeof lastDirection; catchFromCycle: number; catchThroughCycle: number;
        wasMoving: boolean; lastHeading: number;
      });
    },
  };
}

export function createActions(parameters: FeelConfig['actions'], manifest?: ClipManifest, options: ActionOptions = {}) {
  const capacity = parameters.magazineCapacity.value;
  const duration = (id: WeaponAction, fallback: number) =>
    manifest?.clips.find((clip) => clip.id === id)?.durationS ?? fallback;
  const fireS = duration('fire', 0.24);
  const reloadS = duration('reload', 1.40);
  const durationTicks = {
    raise: fixedTicks(duration('raise', 0.44)), lower: fixedTicks(duration('lower', 0.30)),
    fire: fixedTicks(fireS), reload: fixedTicks(reloadS),
  };
  // Normalized markers match the recoil peak and magazine contact of the M2 rehearsal clips.
  const fireTick = fixedTicks(fireS * (0.06 / 0.24));
  const reloadTick = fixedTicks(reloadS * (0.72 / 1.40));
  const fireBufferTicks = fixedTicks(parameters.fireBufferS?.value ?? 0.5);
  // HoldStartShoot: a fire request during the raise is taken once the raise has run this long (absent = wait for the raise).
  const holdStartShootTicks = parameters.holdStartShootS ? fixedTicks(parameters.holdStartShootS.value) : undefined;
  const gaitReferenceMps = options.gaitReferenceMps ?? 2.55;
  const initial: ActionState = {
    id: 'preview-player', phase: 'ready', aiming: false, magazine: capacity, reserve: parameters.initialReserve.value,
  };
  const walk = createWalk(parameters.walkBlendInS?.value ?? DEFAULT_WALK_BLEND_IN_S,
    parameters.walkBlendOutS?.value ?? DEFAULT_WALK_BLEND_OUT_S, options);
  const initialPose: ActionPose = {
    clip: null, progress: 0, lift: 0, gaitPhaseRad: 0, gaitWeight: 0, walk: walk.initial, aim: aimAtRest, clockS: 0,
    raiseTurnRad: 0, holdStartShoot: false, lowerS: -1,
  };

  // All mutable action state lives here so a simulation snapshot can save and restore it.
  type State = {
    active: { id: WeaponAction; started: number; length: number; fromLift: number } | undefined;
    aimWasHeld: boolean; fireUntil: number; lift: number; gaitPhaseRad: number; turnRateRadS: number;
    raiseTurnRad: number; holdStartShoot: boolean; lowerStartedTick: number; pose: ActionPose;
  };
  let state: State = {
    active: undefined, aimWasHeld: false, fireUntil: -1, lift: 0, gaitPhaseRad: 0, turnRateRadS: 0,
    raiseTurnRad: 0, holdStartShoot: false, lowerStartedTick: -1, pose: initialPose,
  };

  /**
   * Called after the camera stage. With a heading model (aimChase), the turn blend follows the heading difference
   * through the WheelBlendRate curve. Without it (v4 regression parameters), the old yaw-rate model is used.
   */
  function updateAimPose(character: CharacterState, yawDeltaRad: number, pitchRad = 0, headingDiffRad?: number) {
    // The raise's heading change is measured after this step's camera input (see updateAimPose callers).
    if (state.pose.clip === 'raise' && state.pose.progress === 0 && state.active?.fromLift === 0) {
      state.raiseTurnRad = headingDiffRad ?? 0;
      state.pose = { ...state.pose, raiseTurnRad: state.raiseTurnRad };
    }
    const { pose } = state;
    if (state.lift !== 1) {
      state.turnRateRadS = 0;
      if (pose.aim.pitchRad !== pitchRad || pose.aim.idleTimeS !== 0 || pose.aim.turn !== 0 || pose.aim.yawTwistRad !== 0) {
        state.pose = { ...pose, aim: { ...aimAtRest, pitchRad } };
      }
      return;
    }
    const stationary = character.grounded && Math.hypot(character.velocity.x, character.velocity.z) <= MOVING_THRESHOLD_MPS;
    let turn: number;
    let turnSpeed = 1;
    let yawTwistRad = 0;
    if (headingDiffRad !== undefined) {
      const diffDeg = headingDiffRad * 180 / Math.PI;
      yawTwistRad = headingDiffRad;
      turn = stationary ? (sampleCurve(WHEEL_BLEND_RATE, diffDeg) - 0.5) * 2 : 0;
      if (Math.abs(turn) < 0.001) turn = 0;
      turnSpeed = sampleCurve(WHEEL_SPEED, Math.abs(diffDeg));
    } else {
      const targetRate = stationary ? Math.atan2(Math.sin(yawDeltaRad), Math.cos(yawDeltaRad)) / STEP_S : 0;
      state.turnRateRadS += (targetRate - state.turnRateRadS) * AIM_TURN_DAMPING;
      const fraction = Math.max(0, Math.min(1, (Math.abs(state.turnRateRadS) - AIM_TURN_DEAD_ZONE_RAD_S) /
        (AIM_TURN_FULL_RAD_S - AIM_TURN_DEAD_ZONE_RAD_S)));
      turn = fraction ? Math.sign(state.turnRateRadS) * fraction * fraction * (3 - 2 * fraction) : 0;
    }
    state.pose = { ...pose, aim: {
      idleTimeS: pose.aim.idleTimeS + STEP_S * (headingDiffRad !== undefined ? turnSpeed : 1),
      stationaryBlend: character.grounded ? 1 - pose.walk.blend : 0,
      turn,
      turnTimeS: pose.aim.turnTimeS + (turn ? STEP_S * (headingDiffRad !== undefined ? turnSpeed : 0.5 + 0.75 * Math.abs(turn)) : 0),
      pitchRad, yawTwistRad, turnSpeed,
    } };
  }

  const act: SimulationStages['act'] = (input, character, previous, emit) => {
    const { tick, aimHeld } = input;
    const subject = previous.id;
    let { magazine, reserve } = previous;
    const speed = Math.hypot(character.velocity.x, character.velocity.z);
    const sprinting = input.sprintHeld && !aimHeld && character.grounded && speed > MOVING_THRESHOLD_MPS;

    if (aimHeld !== state.aimWasHeld) emit(subject, { type: 'input.request', action: aimHeld ? 'raise' : 'lower' });
    if (input.firePressed) emit(subject, { type: 'input.request', action: 'fire' });
    if (input.reloadPressed) emit(subject, { type: 'input.request', action: 'reload' });
    if (input.interactPressed) emit(subject, { type: 'input.request', action: 'interact' });
    state.aimWasHeld = aimHeld;

    if (state.active) {
      const { id, started, length, fromLift } = state.active;
      const elapsed = tick - started;
      if (id === 'raise' || id === 'lower') {
        const target = id === 'raise' ? 1 : 0;
        state.lift = elapsed >= length ? target : fromLift + (target - fromLift) * elapsed / length;
      } else if (id === 'fire' && elapsed === fireTick) {
        emit(subject, { type: 'weapon.fired' });
        magazine -= 1;
        emit(subject, { type: 'ammo.committed', magazine, reserve });
      } else if (id === 'reload' && elapsed === reloadTick) {
        const amount = Math.min(capacity - magazine, reserve);
        magazine += amount;
        reserve -= amount;
        emit(subject, { type: 'ammo.committed', magazine, reserve });
      }

      if (elapsed >= length) {
        emit(subject, { type: 'action.recovered', action: id });
        if (id === 'fire') state.holdStartShoot = false;
        state.active = undefined;
      } else if ((id === 'raise' && !aimHeld) || (id === 'lower' && aimHeld) || (id === 'reload' && sprinting)) {
        state.active = undefined;
      }
    }

    if (!aimHeld || tick > state.fireUntil) state.fireUntil = -1;
    const fireRequested = input.firePressed && aimHeld && magazine > 0;
    if (fireRequested && (state.active?.id === 'raise' || (!state.active && state.lift < 1))) state.fireUntil = tick + fireBufferTicks;

    function accept(id: WeaponAction, fraction = 1) {
      state.active = { id, started: tick, length: Math.max(1, Math.ceil(durationTicks[id] * fraction)), fromLift: state.lift };
      emit(subject, { type: 'action.accepted', action: id });
    }

    // HoldStartShoot branch: a buffered fire ends the raise early once the raise has run long enough.
    const { active } = state;
    if (active?.id === 'raise' && holdStartShootTicks !== undefined && state.fireUntil >= tick &&
        tick - active.started >= holdStartShootTicks) {
      emit(subject, { type: 'action.recovered', action: 'raise' });
      state.active = undefined;
      state.lift = 1;
      state.holdStartShoot = true;
    }

    if (!state.active) {
      const wantsFire = fireRequested || state.fireUntil >= tick;
      if (wantsFire && state.lift === 1) {
        state.fireUntil = -1;
        accept('fire');
      } else if (!wantsFire && input.reloadPressed && magazine < capacity && reserve > 0 &&
          !sprinting && (state.lift === 0 || state.lift === 1)) {
        accept('reload');
      } else if (aimHeld && state.lift < 1) {
        state.lowerStartedTick = -1;
        accept('raise', 1 - state.lift);
      } else if (!aimHeld && state.lift > 0) {
        state.lowerStartedTick = tick;
        accept('lower', state.lift);
      }
    }

    const clip = state.active?.id ?? null;
    const { lift } = state;
    const phase: ActionState['phase'] = clip === 'raise' ? 'raising' : clip === 'lower' ? 'lowering' :
      clip === 'fire' ? 'firing' : clip === 'reload' ? 'reloading' : lift === 1 ? 'aiming' : 'ready';
    const aiming = clip === 'fire' || (aimHeld && (clip === 'raise' || lift === 1));
    const gaitWeight = character.grounded && speed > MOVING_THRESHOLD_MPS ? Math.min(1, speed / gaitReferenceMps) : 0;
    if (gaitWeight) state.gaitPhaseRad = (state.gaitPhaseRad + speed * STEP_S * Math.PI * 2 / 1.2) % (2 * Math.PI);
    const moveRequested = input.moveX !== 0 || input.moveY !== 0;

    state.pose = {
      clip, progress: state.active ? (tick - state.active.started) / state.active.length : 0, lift,
      gaitPhaseRad: state.gaitPhaseRad, gaitWeight,
      walk: walk.update(character, speed, lift, moveRequested, options.cameraYaw?.()), aim: state.pose.aim, clockS: tick * STEP_S,
      raiseTurnRad: state.raiseTurnRad, holdStartShoot: state.holdStartShoot,
      lowerS: state.lowerStartedTick >= 0 ? (tick - state.lowerStartedTick) * STEP_S : -1,
    };
    return { id: subject, phase, aiming, magazine, reserve };
  };

  return {
    initial, act, updateAimPose, readPose: () => state.pose,
    save: () => structuredClone({ state, walk: walk.save() }),
    load(saved: { state: State; walk: object }) {
      state = structuredClone(saved.state);
      walk.load(saved.walk);
    },
  };
}