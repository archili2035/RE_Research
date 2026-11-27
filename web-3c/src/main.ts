import * as THREE from 'three';
import greyboxJson from '../fixtures/m3-greybox.json' with { type: 'json' };
import { createActionView } from './action-view.ts';
import { loadClipAssets } from './clip-assets.ts';
import { loadClipManifest } from './clip-manifest.ts';
import type { GameEvent, LevelDefinition, Vec3 } from './contracts.ts';
import { createHud } from './hud.ts';
import { bindInput } from './input.ts';
import { createTestRoom } from './level.ts';
import { loadLeonAssets } from './leon-assets.ts';
import { CHARACTER_BODY } from './movement.ts';
import { bindPlayerAppearance, createPlayerView } from './player-view.ts';
import { createFixedLoop, createSimulation } from './simulation.ts';
import './style.css';

const researchHome = document.querySelector<HTMLAnchorElement>('#research-home')!;
researchHome.hidden = new URL('./', document.baseURI).pathname === '/';

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
  const leonAssets = loadLeonAssets();
  const useCollisionCourse = new URLSearchParams(window.location.search).get('level') === 'm3';
  const level = useCollisionCourse ? greyboxJson as LevelDefinition : undefined;
  const manifestUrl = new URL('./assets/clips.json', document.baseURI);
  const manifest = await loadClipManifest(manifestUrl).catch((error: unknown) => {
    console.warn('动作清单加载失败，使用默认时序', error);
    return undefined;
  });
  const clips = manifest && await loadClipAssets(manifestUrl, manifest).catch((error: unknown) => {
    console.warn('动作素材加载失败，使用胶囊占位', error);
    return undefined;
  });
  const { scene, avatar, queries, initial, stages, doorPrompt, readMovementDebug, readActionPose } =
    await createTestRoom(level, manifest);
  const actionView = clips && createActionView(clips);
  if (actionView) scene.remove(avatar);
  else avatar.position.y = CHARACTER_BODY.heightM / 2;
  const actor = createPlayerView(actionView ?? { root: avatar });
  scene.add(actor.root);
  bindPlayerAppearance(actor, leonAssets);
  if (useCollisionCourse) {
    document.querySelector('.route')!.textContent = '沿中线穿过门框，直行上低台阶。偏离中线可测试门柱阻挡，穿门后右移可测试高台阶。';
  }
  const hud = createHud(viewport);
  hud.update(initial.tick, initial.action, [], doorPrompt(initial.character.position));
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  viewport.prepend(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(initial.camera.verticalFovRad), 1, 0.045, 45);
  const resize = () => {
    const { clientWidth, clientHeight } = viewport;
    if (!clientWidth || !clientHeight) return;
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
  let previousActionPose = readActionPose();
  let currentActionPose = previousActionPose;
  const recent: string[] = [];
  const step = createSimulation(initial, queries, {
    ...stages,
    sampleInput: input.sample,
    publish(state, frame, emitted) {
      previous = current;
      current = state;
      previousActionPose = currentActionPose;
      currentActionPose = readActionPose();
      const { position, velocity, grounded } = state.character;
      const gait = currentActionPose.walk;
      hud.update(state.tick, state.action, emitted, doorPrompt(position));
      snapshot.value = [
        `步号 ${state.tick}  移动 [${frame.moveX}, ${frame.moveY}]`,
        `鼠标 [${frame.lookDeltaX}, ${frame.lookDeltaY}]  瞄准 ${state.action.aiming ? '是' : '否'}`,
        `坐标 ${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)} m`,
        `速度 [${formatVector(velocity)}] m/s`,
        `着地 ${grounded ? '是' : '否'}  动作 ${state.action.phase}  弹量 ${state.action.magazine} / ${state.action.reserve}`,
        `步态 ${gait.cycles.toFixed(4)} 周期  权重 ${gait.blend.toFixed(3)}`,
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
    const from = previousActionPose.walk;
    const to = currentActionPose.walk;
    const aimFrom = previousActionPose.aim;
    const aimTo = currentActionPose.aim;
    const renderPose = {
      ...currentActionPose,
      aim: {
        idleTimeS: lerp(aimFrom.idleTimeS, aimTo.idleTimeS),
        stationaryBlend: lerp(aimFrom.stationaryBlend, aimTo.stationaryBlend),
        turn: lerp(aimFrom.turn, aimTo.turn),
        turnTimeS: lerp(aimFrom.turnTimeS, aimTo.turnTimeS),
      },
      walk: {
        cycles: lerp(from.cycles, to.cycles), blend: lerp(from.blend, to.blend),
        weights: [lerp(from.weights[0], to.weights[0]), lerp(from.weights[1], to.weights[1]),
          lerp(from.weights[2], to.weights[2]), lerp(from.weights[3], to.weights[3])] as const,
      },
    };
    // Use the swept fixed-step pose, so the view matches the crosshair ray.
    const pose = current.camera;
    actor.draw(
      { x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z) },
      lerpAngle(previous.character.yawRad, current.character.yawRad, alpha),
      renderPose,
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
