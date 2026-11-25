import * as THREE from 'three';
import greyboxJson from '../fixtures/m3-greybox.json' with { type: 'json' };
import { createActionView } from './action-view.ts';
import { loadClipAssets } from './clip-assets.ts';
import { CONTRACT_VERSION } from './contracts.ts';
import type { GameEvent, LevelDefinition, Vec3 } from './contracts.ts';
import { createHud } from './hud.ts';
import { bindInput } from './input.ts';
import { createTestRoom } from './level.ts';
import { CHARACTER_BODY } from './movement.ts';
import { bindPlayerAppearance, createPlayerView } from './player-view.ts';
import { bindReferenceView } from './re9-reference.ts';
import { createFixedLoop, createSimulation } from './simulation.ts';
import './style.css';

const viewport = document.querySelector<HTMLElement>('#viewport')!;
const enter = document.querySelector<HTMLButtonElement>('#enter')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const snapshot = document.querySelector<HTMLOutputElement>('#snapshot')!;
const collision = document.querySelector<HTMLOutputElement>('#collision')!;
const events = document.querySelector<HTMLPreElement>('#events')!;

const formatVector = ({ x, y, z }: Vec3) => `${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}`;

function lerpAngle(from: number, to: number, alpha: number) {
  const difference = to - from;
  return from + Math.atan2(Math.sin(difference), Math.cos(difference)) * alpha;
}

function eventLine(event: GameEvent) {
  let details = '';
  if ('action' in event) details = event.action;
  if (event.type === 'ammo.committed') details = `${event.magazine}/${event.reserve}`;
  if (event.type === 'door.changed') details = `${event.subjectId} ${event.open ? 'open' : 'closed'}`;
  if (event.type === 'target.hit') details = event.subjectId;
  return `${event.tick}.${event.order}  ${event.type} ${details}`.trimEnd();
}

async function boot() {
  enter.disabled = true;
  const reference = bindReferenceView();
  const useCollisionCourse = new URLSearchParams(window.location.search).get('level') === 'm3';
  const level = useCollisionCourse ? greyboxJson as LevelDefinition : undefined;
  const clips = await loadClipAssets(new URL('./assets/clips.json', document.baseURI)).catch((error: unknown) => {
    console.warn('动作素材加载失败，使用胶囊占位', error);
    return undefined;
  });
  const manifest = clips && { version: CONTRACT_VERSION, clips: Array.from(clips.values(), ({ entry }) => entry) };
  const { scene, avatar, queries, initial, stages, doorPrompt, readMovementDebug, readActionPose } =
    await createTestRoom(level, manifest);
  const actionView = clips && createActionView(clips);
  if (actionView) scene.remove(avatar);
  else avatar.position.y = CHARACTER_BODY.heightM / 2;
  const actor = createPlayerView(actionView ?? { root: avatar });
  scene.add(actor.root);
  bindPlayerAppearance(actor, reference.assets);
  if (useCollisionCourse) {
    document.querySelector('.route')!.textContent = '沿中线穿过门框，直行上低台阶。偏离中线可测试门柱阻挡，穿门后右移可测试高台阶。';
  }
  const hud = createHud(viewport);
  hud.update(initial.tick, initial.action, [], doorPrompt(initial.character.position));
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  viewport.prepend(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(initial.camera.verticalFovRad), 1, 0.045, 45);
  const resize = () => {
    const { clientWidth, clientHeight } = viewport;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(viewport);
  resize();

  const input = bindInput(viewport, (locked) => {
    enter.hidden = locked;
    status.textContent = locked ? '鼠标已锁定' : '点击进入以锁定鼠标';
  });
  enter.addEventListener('click', async () => {
    try {
      await viewport.requestPointerLock();
    } catch {
      status.textContent = '鼠标锁定失败，请重新点击进入';
    }
  });
  document.addEventListener('pointerlockerror', () => {
    status.textContent = '鼠标锁定失败，请重新点击进入';
  });

  let previous = initial;
  let current = initial;
  const recent: string[] = [];
  const step = createSimulation(initial, queries, {
    ...stages,
    sampleInput: input.sample,
    publish(state, frame, emitted) {
      previous = current;
      current = state;
      reference.record(previous.action, emitted);
      const { position, velocity, grounded } = state.character;
      hud.update(state.tick, state.action, emitted, doorPrompt(position));
      snapshot.value = [
        `步号 ${state.tick}  移动 [${frame.moveX}, ${frame.moveY}]`,
        `鼠标 [${frame.lookDeltaX}, ${frame.lookDeltaY}]  瞄准 ${state.action.aiming ? '是' : '否'}`,
        `坐标 ${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)} m`,
        `速度 [${formatVector(velocity)}] m/s`,
        `着地 ${grounded ? '是' : '否'}  动作 ${state.action.phase}  弹量 ${state.action.magazine} / ${state.action.reserve}`,
        `镜头 [${formatVector(state.camera.position)}] m`,
        `垂直 FOV ${THREE.MathUtils.radToDeg(state.camera.verticalFovRad).toFixed(1)}°  遮挡 ${state.camera.obstructed ? '是' : '否'}`,
      ].join('\n');
      const debug = readMovementDebug();
      if (debug) {
        collision.value = [
          `请求 [${formatVector(debug.query.displacement)}] m`,
          `实际 [${formatVector(debug.result.displacement)}] m`,
          ...new Set(debug.contacts.map(({ colliderId, normal }) => `${colliderId}  法线 [${formatVector(normal)}]`)),
        ].join('\n');
      }
      if (emitted.length > 0) {
        recent.push(...emitted.map(eventLine));
        if (recent.length > 10) recent.splice(0, recent.length - 10);
        events.textContent = recent.join('\n');
      }
    },
  });

  const loop = createFixedLoop(step, (alpha) => {
    const lerp = (from: number, to: number) => THREE.MathUtils.lerp(from, to, alpha);
    const a = previous.character.position;
    const b = current.character.position;
    // Use the swept fixed-step pose, so the view matches the crosshair ray.
    const pose = current.camera;
    actor.draw(
      { x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z) },
      lerpAngle(previous.character.yawRad, current.character.yawRad, alpha),
      readActionPose(),
      pose.position,
    );
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.rotation.set(pose.pitchRad, pose.yawRad, 0, 'YXZ');
    const fov = THREE.MathUtils.radToDeg(pose.verticalFovRad);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  });
  document.addEventListener('visibilitychange', () => loop.resetClock());
  renderer.setAnimationLoop((nowMs) => loop.frame(nowMs));
  enter.disabled = false;
  status.textContent = '点击进入以锁定鼠标';
}

void boot().catch((error: unknown) => {
  status.textContent = '灰盒启动失败，请查看浏览器控制台';
  console.error(error);
});
