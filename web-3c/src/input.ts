import type { InputSnapshot } from './contracts.ts';

const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyE']);

export function createInputBuffer() {
  const keys = new Set<string>();
  let aimHeld = false;
  let fireHeld = false;
  let firePressed = false;
  let reloadPressed = false;
  let interactPressed = false;
  let lookDeltaX = 0;
  let lookDeltaY = 0;

  return {
    keyDown(code: string, repeat: boolean) {
      if (repeat || !controls.has(code) || keys.has(code)) return;
      keys.add(code);
      if (code === 'KeyR') reloadPressed = true;
      if (code === 'KeyE') interactPressed = true;
    },
    keyUp(code: string) {
      keys.delete(code);
    },
    button(button: number, down: boolean) {
      if (button === 2) aimHeld = down;
      if (button === 0) {
        if (down && !fireHeld) firePressed = true;
        fireHeld = down;
      }
    },
    look(dx: number, dy: number) {
      lookDeltaX += dx;
      lookDeltaY += dy;
    },
    clear() {
      keys.clear();
      aimHeld = fireHeld = firePressed = reloadPressed = interactPressed = false;
      lookDeltaX = lookDeltaY = 0;
    },
    sample(tick: number): InputSnapshot {
      const snapshot = Object.freeze({
        tick,
        moveX: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
        moveY: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
        lookDeltaX, lookDeltaY, firePressed, reloadPressed, interactPressed, aimHeld,
        sprintHeld: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      });
      lookDeltaX = lookDeltaY = 0;
      firePressed = reloadPressed = interactPressed = false;
      return snapshot;
    },
  };
}

export function bindInput(surface: HTMLElement, onLockChange: (locked: boolean) => void) {
  const buffer = createInputBuffer();
  const locked = () => document.pointerLockElement === surface;

  document.addEventListener('pointerlockchange', () => {
    const active = locked();
    // Input can arrive after the lock becomes active and before its change event.
    if (!active) buffer.clear();
    onLockChange(active);
  });
  window.addEventListener('blur', buffer.clear);
  document.addEventListener('visibilitychange', buffer.clear);
  window.addEventListener('keydown', (event) => {
    if (!locked() || !controls.has(event.code)) return;
    event.preventDefault();
    buffer.keyDown(event.code, event.repeat);
  });
  window.addEventListener('keyup', (event) => buffer.keyUp(event.code));
  document.addEventListener('mousemove', (event) => {
    if (locked()) buffer.look(event.movementX, event.movementY);
  });
  document.addEventListener('mousedown', (event) => {
    if (locked()) buffer.button(event.button, true);
  });
  document.addEventListener('mouseup', (event) => buffer.button(event.button, false));
  surface.addEventListener('contextmenu', (event) => event.preventDefault());

  return buffer;
}
