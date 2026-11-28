import { STEP_S } from './contracts.ts';
import type { ActionState, CharacterState, ClipManifest, FeelConfig, Vec3 } from './contracts.ts';
import { LEON_MOVE_RUN, LEON_MOVE_WALK, LEON_ROOT_SPEED, blendedStride, leonWalkBlend } from './leon-locomotion.ts';
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
}

export interface AimPose {
  readonly idleTimeS: number;
  readonly stationaryBlend: number;
  readonly turn: number;
  readonly turnTimeS: number;
  readonly pitchRad: number; // Committed camera pitch, shared by the upper body while aiming.
}

export interface WalkPose {
  readonly cycles: number;
  readonly blend: number;
  readonly weights: LeonWalkWeights;
  readonly carryCycles: number; // Phase of the carry-gun walk and run loops (bank 200), advanced by their own stride.
  readonly hold: number; // 1 for the aimed strafe set (bank 100), 0 for the carry-gun walk and run set (bank 200).
  readonly run: number; // Run loop share inside the carry-gun set.
  readonly plants: readonly [FootPlant | null, FootPlant | null];
}

export interface FootPlant {
  readonly anchor: Readonly<Pick<WalkPose, 'cycles' | 'carryCycles' | 'blend' | 'weights' | 'hold' | 'run'> & { position: Vec3; yawRad: number }>;
  readonly weight: number;
}

const fixedTicks = (seconds: number) => Math.max(1, Math.ceil(seconds / STEP_S - 1e-9));
const FIRE_BUFFER_TICKS = fixedTicks(0.50);
const MOVING_THRESHOLD_MPS = 0.1;
const WALK_BLEND_IN_S = 0.10;
const WALK_BLEND_OUT_S = 0.13;
const DIRECTION_DAMPING = 1 - Math.exp(-STEP_S / 0.055);
const MAX_DIRECTION_WEIGHT_CHANGE = 7.8 * STEP_S;
const AIM_TURN_DAMPING = 1 - Math.exp(-STEP_S / 0.075);
const AIM_TURN_DEAD_ZONE_RAD_S = 0.11;
const AIM_TURN_FULL_RAD_S = 0.43;
const aimAtRest: AimPose = { idleTimeS: 0, stationaryBlend: 0, turn: 0, turnTimeS: 0, pitchRad: 0 };
const RUN_DAMPING = 1 - Math.exp(-STEP_S / 0.12);

function smoothstep(value: number, from: number, to: number) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function createWalk() {
  let walk: WalkPose = { cycles: 0, carryCycles: 0, blend: 0, weights: [1, 0, 0, 0], hold: 0, run: 0, plants: [null, null] };
  let lastDirection: { right: number; forward: number } | undefined;
  let catchFromCycle = 0;
  let catchThroughCycle = 0;

  function gait(character: CharacterState, speed: number, lift: number): Pick<WalkPose, 'cycles' | 'carryCycles' | 'blend' | 'weights' | 'hold' | 'run'> {
    const hold = lift;
    if (!character.grounded || speed <= MOVING_THRESHOLD_MPS) {
      lastDirection = undefined;
      catchThroughCycle = 0;
      return { cycles: walk.cycles, carryCycles: walk.carryCycles, weights: walk.weights, hold, run: walk.run * (1 - RUN_DAMPING),
        blend: Math.max(0, walk.blend - STEP_S / WALK_BLEND_OUT_S) };
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
      blend: Math.min(1, walk.blend + STEP_S / WALK_BLEND_IN_S),
      weights: crossfade ? [weight(0), weight(1), weight(2), weight(3)] : target.weights,
      carryCycles, hold, run,
    };
  }

  function update(character: CharacterState, speed: number, lift: number) {
    if (lift <= 0.65) catchThroughCycle = 0;
    const next = gait(character, speed, lift);
    const moving = character.grounded && speed > MOVING_THRESHOLD_MPS;
    const aim = smoothstep(lift, 0.65, 1);
    const contact = (side: 0 | 1): FootPlant | null => {
      const existing = walk.plants[side];
      if (!character.grounded || aim === 0 || (!moving && !existing)) return null;
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
    walk = { ...next, plants: [contact(0), contact(1)] };
    return walk;
  }

  return { initial: walk, update };
}

export function createActions(parameters: FeelConfig['actions'], manifest?: ClipManifest) {
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
  const initial: ActionState = {
    id: 'preview-player', phase: 'ready', aiming: false, magazine: capacity, reserve: parameters.initialReserve.value,
  };

  let active: { id: WeaponAction; started: number; length: number; fromLift: number } | undefined;
  let aimWasHeld = false;
  let fireUntil = -1;
  let lift = 0;
  let gaitPhaseRad = 0;
  let turnRateRadS = 0;
  const walk = createWalk();
  let pose: ActionPose = {
    clip: null, progress: 0, lift, gaitPhaseRad, gaitWeight: 0, walk: walk.initial, aim: aimAtRest, clockS: 0,
  };

  function updateAimPose(character: CharacterState, yawDeltaRad: number, pitchRad = 0) {
    if (lift !== 1) {
      turnRateRadS = 0;
      if (pose.aim.pitchRad !== pitchRad || pose.aim.idleTimeS !== 0 || pose.aim.turn !== 0) {
        pose = { ...pose, aim: { ...aimAtRest, pitchRad } };
      }
      return;
    }
    const stationary = character.grounded && Math.hypot(character.velocity.x, character.velocity.z) <= MOVING_THRESHOLD_MPS;
    const targetRate = stationary ? Math.atan2(Math.sin(yawDeltaRad), Math.cos(yawDeltaRad)) / STEP_S : 0;
    turnRateRadS += (targetRate - turnRateRadS) * AIM_TURN_DAMPING;
    const fraction = Math.max(0, Math.min(1, (Math.abs(turnRateRadS) - AIM_TURN_DEAD_ZONE_RAD_S) /
      (AIM_TURN_FULL_RAD_S - AIM_TURN_DEAD_ZONE_RAD_S)));
    const turn = fraction ? Math.sign(turnRateRadS) * fraction * fraction * (3 - 2 * fraction) : 0;
    pose = { ...pose, aim: {
      idleTimeS: pose.aim.idleTimeS + STEP_S,
      stationaryBlend: character.grounded ? 1 - pose.walk.blend : 0,
      turn,
      turnTimeS: pose.aim.turnTimeS + (turn ? STEP_S * (0.5 + 0.75 * Math.abs(turn)) : 0),
      pitchRad,
    } };
  }

  const act: SimulationStages['act'] = (input, character, previous, emit) => {
    const { tick, aimHeld } = input;
    const subject = previous.id;
    let { magazine, reserve } = previous;
    const speed = Math.hypot(character.velocity.x, character.velocity.z);
    const sprinting = input.sprintHeld && !aimHeld && character.grounded && speed > MOVING_THRESHOLD_MPS;

    if (aimHeld !== aimWasHeld) emit(subject, { type: 'input.request', action: aimHeld ? 'raise' : 'lower' });
    if (input.firePressed) emit(subject, { type: 'input.request', action: 'fire' });
    if (input.reloadPressed) emit(subject, { type: 'input.request', action: 'reload' });
    if (input.interactPressed) emit(subject, { type: 'input.request', action: 'interact' });
    aimWasHeld = aimHeld;

    if (active) {
      const { id, started, length, fromLift } = active;
      const elapsed = tick - started;
      if (id === 'raise' || id === 'lower') {
        const target = id === 'raise' ? 1 : 0;
        lift = elapsed >= length ? target : fromLift + (target - fromLift) * elapsed / length;
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
        active = undefined;
      } else if ((id === 'raise' && !aimHeld) || (id === 'lower' && aimHeld) || (id === 'reload' && sprinting)) {
        active = undefined;
      }
    }

    if (!aimHeld || tick > fireUntil) fireUntil = -1;
    const fireRequested = input.firePressed && aimHeld && magazine > 0;
    if (fireRequested && (active?.id === 'raise' || (!active && lift < 1))) fireUntil = tick + FIRE_BUFFER_TICKS;

    function accept(id: WeaponAction, fraction = 1) {
      active = { id, started: tick, length: Math.max(1, Math.ceil(durationTicks[id] * fraction)), fromLift: lift };
      emit(subject, { type: 'action.accepted', action: id });
    }

    if (!active) {
      const wantsFire = fireRequested || fireUntil >= tick;
      if (wantsFire && lift === 1) {
        fireUntil = -1;
        accept('fire');
      } else if (!wantsFire && input.reloadPressed && magazine < capacity && reserve > 0 &&
          !sprinting && (lift === 0 || lift === 1)) {
        accept('reload');
      } else if (aimHeld && lift < 1) {
        accept('raise', 1 - lift);
      } else if (!aimHeld && lift > 0) {
        accept('lower', lift);
      }
    }

    const clip = active?.id ?? null;
    const phase: ActionState['phase'] = clip === 'raise' ? 'raising' : clip === 'lower' ? 'lowering' :
      clip === 'fire' ? 'firing' : clip === 'reload' ? 'reloading' : lift === 1 ? 'aiming' : 'ready';
    const aiming = clip === 'fire' || (aimHeld && (clip === 'raise' || lift === 1));
    const gaitWeight = character.grounded && speed > MOVING_THRESHOLD_MPS ? Math.min(1, speed / 2.55) : 0;
    if (gaitWeight) gaitPhaseRad = (gaitPhaseRad + speed * STEP_S * Math.PI * 2 / 1.2) % (2 * Math.PI);

    pose = {
      clip, progress: active ? (tick - active.started) / active.length : 0, lift, gaitPhaseRad, gaitWeight,
      walk: walk.update(character, speed, lift), aim: pose.aim, clockS: tick * STEP_S,
    };
    return { id: subject, phase, aiming, magazine, reserve };
  };

  return { initial, act, updateAimPose, readPose: () => pose };
}