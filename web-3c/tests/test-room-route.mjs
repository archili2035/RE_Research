export const targetLook = { lookDeltaX: 0.38 / 0.0022, lookDeltaY: -0.06 / 0.0022 };

/** @type {readonly [string, number, Partial<import('../src/contracts.ts').InputSnapshot>][]} */
export const testRoomRoute = [
  ['spawn', 1, { interactPressed: true, firePressed: true }],
  ['corner', 277, { moveY: 1 }],
  ['turn', 1, { lookDeltaX: -Math.PI / (2 * 0.0022) }],
  ['by-target', 64, { moveY: 1 }],
  ['raise-start', 1, { aimHeld: true, firePressed: true, ...targetLook }],
  ['raise-mid', 12, { aimHeld: true }],
  ['fire-start', 15, { aimHeld: true }],
  ['shot', 4, { aimHeld: true }],
  ['shot-recovered', 11, { aimHeld: true }],
  ['reload-start', 1, { aimHeld: true, reloadPressed: true }],
  ['reload-commit', 44, { aimHeld: true }],
  ['reload-recovered', 40, { aimHeld: true }],
  ['look-door', 1, { lookDeltaX: -targetLook.lookDeltaX }],
  ['door-blocked', 60, { moveY: 1 }],
  ['door-opened', 1, { interactPressed: true }],
  ['threshold', 10, { moveY: 1 }],
  ['threshold-denied', 1, { interactPressed: true }],
  ['next-room', 20, { moveY: 1 }],
  ['door-closed', 1, { interactPressed: true }],
  ['return-blocked', 25, { moveY: -1 }],
  ['return-opened', 1, { interactPressed: true }],
  ['return', 25, { moveY: -1 }],
];
