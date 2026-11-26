import { STEP_S } from './contracts.ts';
import type { ActionState, CharacterState, ClipManifest, FeelConfig } from './contracts.ts';
import type { SimulationStages } from './simulation.ts';

type WeaponAction = 'raise' | 'lower' | 'fire' | 'reload';

export interface ActionPose {
  readonly clip: WeaponAction | null;
  readonly progress: number;
  readonly lift: number;
  readonly gaitPhaseRad: number;
  readonly gaitWeight: number;
  readonly walk: WalkPose;
}

export interface WalkFoot {
  readonly rightM: number;
  readonly forwardM: number;
  readonly liftM: number;
  readonly yawRad: number;
  readonly planted: boolean;
}

export interface WalkPose {
  readonly cycles: number;
  readonly blend: number;
  readonly directional: number;
  readonly pace: number; // 0 at aimed walking speed, 1 at ordinary walking speed.
  readonly right: number;
  readonly forward: number;
  readonly feet: readonly [WalkFoot, WalkFoot];
}

const fixedTicks = (seconds: number) => Math.max(1, Math.ceil(seconds / STEP_S - 1e-9));
const FIRE_BUFFER_TICKS = fixedTicks(0.50);
const MOVING_THRESHOLD_MPS = 0.1;
const WALK_BLEND_IN_S = 0.10;
const WALK_BLEND_OUT_S = 0.13;
const FORWARD_STRIDE_M = 1.75998; // Root travel of the existing W loop, 100/120.
const AIM_DIRECTIONAL_STRIDE_M = 0.86;
const READY_DIRECTIONAL_STRIDE_M = 1.14;
const AIM_WALK_MPS = 1.55;
const READY_WALK_MPS = 2.55;
export const SUPPORT_FRACTION = 0.58;
export const leftStepPhase = (cycles: number) => (cycles + 0.14) % 1;
const DIRECTION_DAMPING = 1 - Math.exp(-STEP_S / 0.055);
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const shortestAngle = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians));

function createWalk() {
  const rest: WalkFoot = { rightM: 0, forwardM: 0, liftM: 0, yawRad: 0, planted: true };
  let walk: WalkPose = { cycles: 0, blend: 0, directional: 0, pace: 0, right: 0, forward: 0, feet: [rest, rest] };
  let replantUntilCycle = 0;
  const feet = [-1, 1].map((side) => ({ side, anchor: undefined as { x: number; z: number; yaw: number } | undefined,
    x: 0, z: 0, yaw: 0, swinging: false }));

  function update(character: CharacterState, speed: number) {
    const { position, velocity, yawRad } = character;
    const sin = Math.sin(yawRad);
    const cos = Math.cos(yawRad);
    const localRight = cos * velocity.x - sin * velocity.z;
    const localForward = -sin * velocity.x - cos * velocity.z;
    const moving = character.grounded && speed > MOVING_THRESHOLD_MPS;
    const target = moving ? 1 - smoothstep(Math.max(0, Math.min(1, (localForward / speed - 0.78) / 0.18))) : walk.directional;
    const directional = walk.directional + Math.max(-1 / 7, Math.min(1 / 7, target - walk.directional));
    const targetPace = moving ? Math.max(0, Math.min(1, (speed - AIM_WALK_MPS) / (READY_WALK_MPS - AIM_WALK_MPS))) : walk.pace;
    const pace = walk.pace + DIRECTION_DAMPING * (targetPace - walk.pace);
    const right = moving ? walk.right + DIRECTION_DAMPING * (localRight / speed - walk.right) : walk.right;
    const forward = moving ? walk.forward + DIRECTION_DAMPING * (localForward / speed - walk.forward) : walk.forward;
    if (moving && directional > 0.5 && walk.cycles >= replantUntilCycle &&
        (localRight * walk.right + localForward * walk.forward) < -0.65 * speed) {
      replantUntilCycle = walk.cycles + 0.55;
    }
    // Shorten the catch step after a reversal while keeping contact order and accumulating actual travel.
    const replant = Math.min(1, Math.max(0, (replantUntilCycle - walk.cycles) / 0.14));
    const supportReachM = Math.max(...walk.feet.map((foot) => foot.planted ? Math.hypot(foot.rightM, foot.forwardM) : 0));
    const nearExtension = smoothstep(Math.max(0, Math.min(1, (supportReachM - 0.34) / 0.18))) * pace;
    const directionStrideM = AIM_DIRECTIONAL_STRIDE_M + (READY_DIRECTIONAL_STRIDE_M - AIM_DIRECTIONAL_STRIDE_M) * pace
      - (0.36 + 0.19 * pace) * Math.max(replant, nearExtension);
    const strideM = FORWARD_STRIDE_M + (directionStrideM - FORWARD_STRIDE_M) * directional;
    const travelM = (directional > 0 ? speed : localForward) * STEP_S;
    const cycles = walk.cycles + (moving ? travelM / strideM : 0);
    const blend = moving ? Math.min(1, walk.blend + STEP_S / WALK_BLEND_IN_S) : Math.max(0, walk.blend - STEP_S / WALK_BLEND_OUT_S);
    if (directional > 0 && walk.directional === 0) {
      for (const foot of feet) foot.anchor = undefined;
    }

    function stepFoot(index: number): WalkFoot {
      const foot = feet[index];
      const phase = (leftStepPhase(cycles) + index * 0.5) % 1;
      const swinging = phase >= SUPPORT_FRACTION;
      if (!foot.anchor) {
        foot.anchor = { x: position.x, z: position.z, yaw: yawRad };
        foot.x = position.x;
        foot.z = position.z;
        foot.yaw = yawRad;
        foot.swinging = swinging;
      }
      if (moving) {
        if (foot.swinging && !swinging) foot.anchor = { x: foot.x, z: foot.z, yaw: foot.yaw };
        foot.swinging = swinging;
      }
      const swing = swinging ? (phase - SUPPORT_FRACTION) / (1 - SUPPORT_FRACTION) : 0;
      const reach = 0.22 + 0.05 * pace + 0.06 * foot.side * right;
      const swingWeight = smoothstep(swing);
      if (moving || !swinging) {
        foot.x = foot.anchor.x + (position.x + reach * (cos * right - sin * forward) - foot.anchor.x) * swingWeight;
        foot.z = foot.anchor.z + (position.z + reach * (-sin * right - cos * forward) - foot.anchor.z) * swingWeight;
        foot.yaw = foot.anchor.yaw + shortestAngle(yawRad - foot.anchor.yaw) * swingWeight;
        const other = feet[1 - index];
        if (swinging && other.anchor) {
          // The neutral toes start 0.40 m apart. Keep the swing toe clear of the supporting leg.
          const across = cos * (foot.x - other.anchor.x) - sin * (foot.z - other.anchor.z);
          const correction = foot.side * Math.max(0, 0.09 - (0.40 + foot.side * across));
          foot.x += cos * correction;
          foot.z -= sin * correction;
        }
      }
      const x = foot.x - position.x;
      const z = foot.z - position.z;
      const swingHeightM = 0.09 + 0.025 * Math.max(0, -forward);
      return {
        rightM: cos * x - sin * z, forwardM: -sin * x - cos * z,
        liftM: swingHeightM * Math.sin(Math.PI * swing) ** 2,
        yawRad: shortestAngle(foot.yaw - yawRad), planted: !swinging,
      };
    }
    walk = { cycles, blend, directional, pace, right, forward, feet: [stepFoot(0), stepFoot(1)] };
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
  const walk = createWalk();
  let pose: ActionPose = { clip: null, progress: 0, lift, gaitPhaseRad, gaitWeight: 0, walk: walk.initial };

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
      walk: walk.update(character, speed),
    };
    return { id: subject, phase, aiming, magazine, reserve };
  };

  return { initial, act, readPose: () => pose };
}
