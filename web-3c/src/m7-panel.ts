import { loadClipManifest } from './clip-manifest.ts';
import type { FeelConfig, GameEvent, InputSnapshot, ReplayTrace, Vec3 } from './contracts.ts';
import reference from '../fixtures/route.replay.json' with { type: 'json' };
import { createTestRoom, defaultFeel, testRoom } from './level.ts';
import { createRoutePlayback, matchesReferenceEvents } from './m7-replay.ts';
import { CHARACTER_BODY } from './movement.ts';
import { createFixedLoop } from './simulation.ts';
import './m7.css';

const route = reference as ReplayTrace;
let feel = defaultFeel;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const step = document.querySelector<HTMLButtonElement>('#step')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const snapshot = document.querySelector<HTMLPreElement>('#snapshot')!;
const eventLog = document.querySelector<HTMLPreElement>('#events')!;
const downloadTrace = document.querySelector<HTMLButtonElement>('#download-trace')!;
const canvas = document.querySelector<HTMLCanvasElement>('#route-map')!;
const ctx = canvas.getContext('2d')!;
const versionOutput = document.querySelector<HTMLOutputElement>('#feel-version')!;

const trail: Vec3[] = [];
let room: Awaited<ReturnType<typeof createTestRoom>>;
let latestInput: InputSnapshot | undefined;
let playback: ReturnType<typeof createRoutePlayback>;
let animation: number | undefined;

const boxes = testRoom.render.filter((item) => item.kind === 'box')
  .filter(({ position, size }) => position.y - size.y / 2 < CHARACTER_BODY.heightM);
const corners = boxes.flatMap(({ position, size, yawRad }) => {
  const cos = Math.abs(Math.cos(yawRad));
  const sin = Math.abs(Math.sin(yawRad));
  const x = (size.x * cos + size.z * sin) / 2;
  const z = (size.x * sin + size.z * cos) / 2;
  return [
    { x: position.x - x, z: position.z - z },
    { x: position.x + x, z: position.z + z },
  ];
});

const fmt = (value: number) => value.toFixed(3);
function eventLine(event: GameEvent) {
  let detail = 'action' in event ? event.action : '';
  if (event.type === 'ammo.committed') detail = `${event.magazine} / ${event.reserve}`;
  if (event.type === 'door.changed') detail = `${event.subjectId} ${event.open ? 'open' : 'closed'}`;
  if (event.type === 'target.hit') detail = event.subjectId;
  return `${event.tick}.${event.order}  ${event.type} ${detail}`.trimEnd();
}

function drawMap(character: Vec3, camera: Vec3) {
  const { width, height } = canvas;
  const positions = [...corners, ...trail, character, camera];
  const minX = Math.floor(Math.min(...positions.map(({ x }) => x)));
  const maxX = Math.ceil(Math.max(...positions.map(({ x }) => x)));
  const minZ = Math.floor(Math.min(...positions.map(({ z }) => z)));
  const maxZ = Math.ceil(Math.max(...positions.map(({ z }) => z)));
  const scale = Math.min((width - 32) / (maxX - minX), (height - 32) / (maxZ - minZ));
  const toX = (x: number) => width / 2 + (x - (minX + maxX) / 2) * scale;
  const toY = (z: number) => height / 2 + (z - (minZ + maxZ) / 2) * scale;
  ctx.fillStyle = '#182229';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#304049';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = minX; x <= maxX; x += 1) {
    ctx.moveTo(toX(x), toY(minZ));
    ctx.lineTo(toX(x), toY(maxZ));
  }
  for (let z = minZ; z <= maxZ; z += 1) {
    ctx.moveTo(toX(minX), toY(z));
    ctx.lineTo(toX(maxX), toY(z));
  }
  ctx.stroke();

  for (const { id, position, size, yawRad, color } of boxes) {
    if (!room.scene.getObjectByName(id)?.visible) continue;
    ctx.save();
    ctx.translate(toX(position.x), toY(position.z));
    ctx.rotate(-yawRad);
    ctx.fillStyle = color ?? '#607a85';
    ctx.fillRect(-size.x * scale / 2, -size.z * scale / 2, size.x * scale, size.z * scale);
    ctx.restore();
  }

  const points = trail.length ? trail : [character];
  ctx.strokeStyle = '#91d7cb';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(toX(points[0].x), toY(points[0].z));
  for (const { x, z } of points.slice(1)) ctx.lineTo(toX(x), toY(z));
  ctx.stroke();
  for (const [point, color] of [[camera, '#f4c477'], [character, '#91d7cb']] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(toX(point.x), toY(point.z), 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function render() {
  const { tick, character, action, camera } = playback.state;
  progress.value = tick;
  downloadTrace.disabled = tick === 0;
  drawMap(character.position, camera.position);
  const position = ({ x, y, z }: Vec3) => [x, y, z].map(fmt).join(', ');
  const input = latestInput;
  const flags = input && [
    input.sprintHeld && '奔跑', input.aimHeld && '瞄准', input.firePressed && '开火',
    input.reloadPressed && '换弹', input.interactPressed && '交互',
  ].filter(Boolean).join(' ') || '—';
  snapshot.textContent = [
    `步号 ${tick} / ${route.inputs.length}   模拟 ${fmt(tick * route.stepS)} s`,
    input ? `移动轴 ${input.moveX}, ${input.moveY}   鼠标 Δ ${fmt(input.lookDeltaX)}, ${fmt(input.lookDeltaY)} px` : '输入 —',
    `按键 ${flags}`,
    `角色 ${position(character.position)} m`,
    `速度 ${fmt(Math.hypot(character.velocity.x, character.velocity.z))} m/s`,
    `动作 ${action.phase}   弹匣/备用 ${action.magazine}/${action.reserve}`,
    `门 ${room.doorPrompt(character.position) || '—'}`,
    `镜头 ${position(camera.position)} m`,
    `垂直 FOV ${fmt(camera.verticalFovRad)} rad   遮挡 ${camera.obstructed ? '是' : '否'}`,
  ].join('\n');
}

const loop = createFixedLoop(() => playback.step(), render);
function pause() {
  if (animation !== undefined) cancelAnimationFrame(animation);
  animation = undefined;
  loop.resetClock();
  play.textContent = playback.done ? '重播' : '播放';
  step.disabled = playback.done;
}

function showCompletion() {
  pause();
  if (feel.version !== route.feelVersion) {
    status.value = '完成 · 已应用调参';
  } else {
    status.value = matchesReferenceEvents(playback.trace(), route)
      ? '完成 · 事件与基线一致' : '完成 · 事件与基线有差异';
  }
}

function frame(nowMs: number) {
  loop.frame(nowMs);
  if (playback.done) showCompletion();
  else animation = requestAnimationFrame(frame);
}

function publish(state: typeof playback.state, input: InputSnapshot, events: readonly GameEvent[]) {
  latestInput = input;
  trail.push(state.character.position);
  if (events.length) {
    if (eventLog.textContent === '等待回放') eventLog.textContent = '';
    eventLog.append(events.map(eventLine).join('\n') + '\n');
    eventLog.scrollTop = eventLog.scrollHeight;
  }
}

function reset() {
  pause();
  playback.reset(feel);
  latestInput = undefined;
  eventLog.textContent = '等待回放';
  trail.length = 0;
  trail.push(playback.state.character.position);
  progress.max = route.inputs.length;
  step.disabled = false;
  play.textContent = '播放';
  status.value = '准备播放';
  versionOutput.value = `参数 v${feel.version} · ${feel.version === route.feelVersion ? '基线' : '调参'}`;
  render();
}

play.addEventListener('click', () => {
  if (animation !== undefined) {
    pause();
    status.value = '已暂停';
    return;
  }
  if (playback.done) reset();
  play.textContent = '暂停';
  step.disabled = true;
  status.value = '播放中';
  animation = requestAnimationFrame(frame);
});
step.addEventListener('click', () => {
  playback.step();
  render();
  if (playback.done) showCompletion();
  else status.value = '已暂停';
});
document.querySelector('#reset')!.addEventListener('click', reset);

function download(name: string, data: ReplayTrace | FeelConfig) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
downloadTrace.addEventListener('click', () => download(`route-v${feel.version}-tick-${playback.state.tick}.replay.json`, playback.trace()));
document.querySelector('#download-feel')!.addEventListener('click', () => download(`feel-v${feel.version}.json`, feel));

type Group = 'movement' | 'camera' | 'actions';
const labels = {
  movement: {
    walkSpeedMps: '步行速度（m/s）', sprintSpeedMps: '奔跑速度（m/s）', aimSpeedMps: '瞄准移速（m/s）',
  },
  camera: {
    lookRadPerPx: '鼠标灵敏度（rad/px）', moveDistanceM: '移动镜头距离（m）', aimDistanceM: '瞄准镜头距离（m）',
    moveShoulderM: '移动横向偏移（m）', aimShoulderM: '瞄准横向偏移（m）',
    moveHeightM: '移动锚点高度（m）', aimHeightM: '瞄准锚点高度（m）',
    moveVerticalFovRad: '移动垂直 FOV（rad）', aimVerticalFovRad: '瞄准垂直 FOV（rad）',
    followPositionS: '水平跟随时间常数（s）', followHeightS: '高度跟随时间常数（s）',
    aimTransitionS: '瞄准过渡时间常数（s）', moveTransitionS: '普通构图过渡时间常数（s）',
    recoveryS: '离墙恢复时间常数（s）', recoveryDeadbandM: '贴墙防回弹余量（m）',
  },
  actions: { magazineCapacity: '弹匣容量', initialReserve: '初始备用弹' },
};
const groups: Record<Group, string> = { movement: '运动', camera: '镜头', actions: '动作' };
const fields: { group: Group; key: string; input: HTMLInputElement }[] = [];
for (const group of Object.keys(groups) as Group[]) {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = groups[group];
  fieldset.append(legend);
  for (const [key, title] of Object.entries(labels[group])) {
    const input = document.createElement('input');
    input.type = 'number';
    input.required = true;
    input.step = group === 'actions' ? '1' : 'any';
    input.min = key === 'magazineCapacity' ? '1' : key === 'lookRadPerPx' ? '0.0001' :
      key.endsWith('FovRad') || key.endsWith('HeightM') ? '0.1' : '0';
    input.max = group === 'actions' ? '999' : key === 'lookRadPerPx' ? '0.02' :
      key.endsWith('FovRad') ? '2.9' : key.endsWith('HeightM') ? '2' :
      key.endsWith('S') ? '1' : key === 'recoveryDeadbandM' ? '0.1' : '12';
    input.value = String(feel[group][key].value);
    const label = document.createElement('label');
    label.append(title, input);
    fieldset.append(label);
    fields.push({ group, key, input });
  }
  document.querySelector('#parameter-groups')!.append(fieldset);
}

document.querySelector<HTMLFormElement>('#feel')!.addEventListener('submit', (event) => {
  event.preventDefault();
  const changedFields = fields.filter(({ group, key, input }) => feel[group][key].value !== input.valueAsNumber);
  if (!changedFields.length) return;
  const next = { movement: { ...feel.movement }, camera: { ...feel.camera }, actions: { ...feel.actions } };
  for (const { group, key, input } of changedFields) {
    next[group][key] = {
      value: input.valueAsNumber, evidence: 'tuned', source: 'M7 网页调参面板',
      conditions: `60 Hz，${route.level.id} v${route.level.version}`,
    };
  }
  feel = { ...next, version: feel.version + 1 };
  reset();
});
async function boot() {
  const manifest = await loadClipManifest(new URL('./assets/clips.json', document.baseURI)).catch((error: unknown) => {
    console.warn('动作清单加载失败，使用默认时序', error);
    return undefined;
  });
  room = await createTestRoom(testRoom, manifest);
  playback = createRoutePlayback(route, room, feel, publish);
  document.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false; });
  reset();
}

void boot().catch((error: unknown) => {
  status.value = '回放场景启动失败';
  console.error(error);
});
