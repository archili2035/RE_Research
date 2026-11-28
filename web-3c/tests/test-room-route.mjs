export const targetLook = { lookDeltaX: 0.38 / 0.0022, lookDeltaY: -0.06 / 0.0022 };

// FeelConfig v5 uses the source root speeds (walk 1.80 m/s, aim 1.10 m/s). Walking segments are the v4 counts
// scaled by 2.55 / 1.80 so the route reaches the same corner, target position and door.
/** @type {readonly [string, number, Partial<import('../src/contracts.ts').InputSnapshot>][]} */
export const testRoomRoute = [
  ['spawn', 1, { interactPressed: true, firePressed: true }],
  ['corner', 392, { moveY: 1 }],
  ['corner-stop', 18, {}], // v6 deceleration (0.25 s) settles before the camera turns
  ['turn', 1, { lookDeltaX: -Math.PI / (2 * 0.0022) }],
  ['by-target', 91, { moveY: 1 }],
  ['raise-start', 1, { aimHeld: true, firePressed: true, ...targetLook }],
  ['raise-mid', 14, { aimHeld: true }],
  ['fire-start', 1, { aimHeld: true }], // HoldStartShoot accepts the buffered shot 15 steps into the raise
  ['shot', 4, { aimHeld: true }],
  ['shot-recovered', 23, { aimHeld: true }],
  ['reload-start', 1, { aimHeld: true, reloadPressed: true }],
  ['reload-commit', 44, { aimHeld: true }],
  ['reload-recovered', 40, { aimHeld: true }],
  ['look-door', 1, { lookDeltaX: -targetLook.lookDeltaX }],
  ['door-blocked', 95, { moveY: 1 }],
  ['door-opened', 1, { interactPressed: true }],
  ['threshold', 14, { moveY: 1 }],
  ['threshold-denied', 1, { interactPressed: true }],
  ['next-room', 28, { moveY: 1 }],
  ['door-closed', 1, { interactPressed: true }],
  ['return-blocked', 46, { moveY: -1 }],
  ['return-opened', 1, { interactPressed: true }],
  ['return', 35, { moveY: -1 }],
];

/** Last fixed-step tick of each named segment. */
export const routeTick = Object.fromEntries(testRoomRoute.reduce((ticks, [name, count]) => {
  ticks.push([name, (ticks.at(-1)?.[1] ?? 0) + count]);
  return ticks;
}, /** @type {[string, number][]} */ ([])));