import { STEP_S } from './contracts.ts';
import type { ActionState, ClipManifest, FeelConfig } from './contracts.ts';
import type { SimulationStages } from './simulation.ts';

type WeaponAction = 'raise' | 'lower' | 'fire' | 'reload';

export interface ActionPose {
  readonly clip: WeaponAction | null;
  readonly progress: number;
  readonly lift: number;
  readonly gaitPhaseRad: number;
  readonly gaitWeight: number;
}

const fixedTicks = (seconds: number) => Math.max(1, Math.ceil(seconds / STEP_S - 1e-9));
const FIRE_BUFFER_TICKS = fixedTicks(0.50);
const MOVING_THRESHOLD_MPS = 0.1;

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
  let pose: ActionPose = { clip: null, progress: 0, lift, gaitPhaseRad, gaitWeight: 0 };

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
    pose = { clip, progress: active ? (tick - active.started) / active.length : 0, lift, gaitPhaseRad, gaitWeight };
    return { id: subject, phase, aiming, magazine, reserve };
  };

  return { initial, act, readPose: () => pose };
}
