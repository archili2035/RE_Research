const look = 0.0022;
const aim = { aimHeld: true };

// Each segment injects the same input every fixed step in both recordings.
export const cameraTuneRoute = [
  ['靠墙举枪', 45, aim],
  ['恢复普通构图', 45, {}],
  ['直走', 145, { moveY: 1 }],
  ['急停', 30, {}],
  ['走向转角', 132, { moveY: 1 }],
  ['擦墙转 L 角', 30, { lookDeltaX: -Math.PI / (2 * 30 * look) }],
  ['离开转角', 109, { moveY: 1 }],
  ['开门', 1, { interactPressed: true }],
  ['穿过门槛', 28, { moveY: 1 }],
  ['回身瞄靶', 40, { ...aim, lookDeltaX: (Math.PI - 0.47) / (40 * look), lookDeltaY: -0.125 / (40 * look) }],
  ['稳定瞄准', 35, aim],
  ['开火请求', 1, { ...aim, firePressed: true }],
  ['等待开火', 3, aim],
  ['开火当帧微调', 1, { ...aim, lookDeltaX: 1, lookDeltaY: -1 }],
  ['命中反馈', 20, aim],
];

export const cameraTuneSteps = cameraTuneRoute.flatMap(([phase, ticks, input]) =>
  Array.from({ length: ticks }, () => ({ phase, input })));
