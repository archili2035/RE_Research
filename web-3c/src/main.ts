import * as THREE from 'three';
import { createActionView } from './action-view.ts';
import { loadClipAssets } from './clip-assets.ts';
import { loadClipManifest } from './clip-manifest.ts';
import type { GameEvent, Vec3 } from './contracts.ts';
import { createHud } from './hud.ts';
import { bindInput } from './input.ts';
import { createTestRoom, defaultFeel } from './level.ts';
import { loadLeonAssets } from './leon-assets.ts';
import { defaultPlayfield, playfields } from './levels/catalog.ts';
import { CHARACTER_BODY } from './movement.ts';
import { bindPlayerAppearance, createPlayerView } from './player-view.ts';
import { createRenderSampler } from './render-sampler.ts';
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
  const url = new URL(window.location.href);
  const playfield = playfields.find(({ id }) => id === url.searchParams.get('level')) ?? defaultPlayfield;
  const levelSelect = document.querySelector<HTMLSelectElement>('#level-select')!;
  levelSelect.replaceChildren(...playfields.map(({ id, name }) => new Option(name, id)));
  levelSelect.value = playfield.id;
  levelSelect.disabled = false;
  levelSelect.addEventListener('change', () => {
    const nextUrl = new URL(url);
    if (levelSelect.value === defaultPlayfield.id) nextUrl.searchParams.delete('level');
    else nextUrl.searchParams.set('level', levelSelect.value);
    nextUrl.searchParams.delete('spawn');
    window.location.assign(nextUrl);
  });
  window.addEventListener('pageshow', () => { levelSelect.value = playfield.id; });
  document.querySelector('#scene-heading')!.textContent = playfield.heading ?? playfield.name;
  document.querySelector('.route')!.textContent = playfield.route;
  const baseLevel = await playfield.load();
  // ?spawn=x,y,z,yawDeg places the player for camera comparisons against reference footage.
  const spawnParam = url.searchParams.get('spawn')?.split(',').map(Number);
  const level = playfield !== defaultPlayfield && spawnParam?.length === 4 && spawnParam.every(Number.isFinite)
    ? { ...baseLevel, spawn: { position: { x: spawnParam[0], y: spawnParam[1], z: spawnParam[2] }, yawRad: spawnParam[3] * Math.PI / 180 } }
    : baseLevel;
  // ?camera=source selects the source camera profile (camera-source.json) instead of the v4 video fit.
  const feel = url.searchParams.get('camera') === 'source'
    ? { ...defaultFeel, camera: { ...defaultFeel.camera, cameraProfile: { ...defaultFeel.camera.cameraProfile, value: 1, source: 'URL ?camera=source' } } }
    : defaultFeel;
  const manifestUrl = new URL('./assets/clips.json', document.baseURI);
  const manifest = await loadClipManifest(manifestUrl).catch((error: unknown) => {
    console.warn('动作清单加载失败，使用默认时序', error);
    return undefined;
  });
  const clips = manifest && await loadClipAssets(manifestUrl, manifest).catch((error: unknown) => {
    console.warn('动作素材加载失败，使用胶囊占位', error);
    return undefined;
  });
  const { scene, avatar, queries, initial, stages, doorPrompt, readMovementDebug, readActionPose, readCameraAnchor, syncView } =
    await createTestRoom(level, manifest, feel);
  const actionView = clips && createActionView(clips);
  if (actionView) scene.remove(avatar);
  else avatar.position.y = CHARACTER_BODY.heightM / 2;
  const actor = createPlayerView(actionView ?? { root: avatar });
  scene.add(actor.root);
  bindPlayerAppearance(actor, leonAssets);
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
      // Raw mouse deltas without OS acceleration, so lookRadPerPx means the same on every machine.
      await (viewport.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void>)({ unadjustedMovement: true })
        .catch(() => viewport.requestPointerLock());
    } catch {
      status.textContent = '鼠标锁定失败，请重新点击进入';
    }
  });
  document.addEventListener('pointerlockerror', () => {
    status.textContent = '鼠标锁定失败，请重新点击进入';
  });

  const render = createRenderSampler(
    { ...initial, actionPose: readActionPose(), cameraAnchor: readCameraAnchor() },
    queries, defaultFeel.camera.sphereRadiusM.value,
  );
  const recent: string[] = [];
  const step = createSimulation(initial, queries, {
    ...stages,
    sampleInput: input.sample,
    publish(state, frame, emitted) {
      const actionPose = readActionPose();
      const fired = emitted.some(({ type, subjectId }) => type === 'weapon.fired' && subjectId === state.action.id);
      render.commit({ ...state, actionPose, cameraAnchor: readCameraAnchor() }, fired);
      syncView(state.tick);
      const { position, velocity, grounded } = state.character;
      const gait = actionPose.walk;
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
    const { character, actionPose, camera: pose } = render.sample(alpha);
    actor.draw(character.position, character.yawRad, actionPose, pose.position);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.rotation.set(pose.pitchRad, pose.yawRad, 0, 'YXZ');
    const fov = THREE.MathUtils.radToDeg(pose.verticalFovRad);
    const near = pose.nearClipM ?? 0.045;
    if (camera.fov !== fov || camera.near !== near) {
      camera.fov = fov;
      camera.near = near;
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