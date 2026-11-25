import * as THREE from 'three';
import { loadClipAssets } from './clip-assets.ts';
import type { LoadedClip } from './clip-assets.ts';
import './style.css';

const viewport = document.querySelector<HTMLElement>('#viewport')!;
const status = document.querySelector<HTMLElement>('#status')!;
const clipSelect = document.querySelector<HTMLSelectElement>('#clip')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const timeline = document.querySelector<HTMLInputElement>('#time')!;
const timeOutput = document.querySelector<HTMLOutputElement>('#time-value')!;
const measurements = document.querySelector<HTMLOutputElement>('#measurements')!;
const names = new Map([
  ['hold-idle', '持枪站立'], ['raise', '举枪'], ['fire', '单发增量'], ['reload', '换弹组合'],
]);

function getSkins(root: THREE.Object3D) {
  const skins: THREE.SkinnedMesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) skins.push(node);
  });
  if (skins.length === 0) throw new Error('GLB 中找不到蒙皮网格');
  return skins;
}

function measureBind(skins: readonly THREE.SkinnedMesh[]) {
  const identity = new THREE.Matrix4();
  const product = new THREE.Matrix4();
  const source = new THREE.Vector3();
  const deformed = new THREE.Vector3();
  const bones = new Set<THREE.Bone>();
  let inverseBindError = 0;
  let vertexErrorM = 0;
  let vertices = 0;
  for (const skin of skins) {
    for (const [i, bone] of skin.skeleton.bones.entries()) {
      bones.add(bone);
      product.multiplyMatrices(bone.matrixWorld, skin.skeleton.boneInverses[i]);
      for (const [j, value] of product.elements.entries()) {
        inverseBindError = Math.max(inverseBindError, Math.abs(value - identity.elements[j]));
      }
    }
    const positions = skin.geometry.getAttribute('position');
    vertices += positions.count;
    for (let i = 0; i < positions.count; i++) {
      source.fromBufferAttribute(positions, i);
      skin.getVertexPosition(i, deformed);
      vertexErrorM = Math.max(vertexErrorM, source.distanceTo(deformed));
    }
  }
  return { bones: bones.size, vertices, inverseBindError, vertexErrorM };
}

function measureBounds(skins: readonly THREE.SkinnedMesh[]) {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const skin of skins) {
    for (let i = 0; i < skin.geometry.getAttribute('position').count; i++) {
      skin.getVertexPosition(i, point).applyMatrix4(skin.matrixWorld);
      bounds.expandByPoint(point);
    }
  }
  return { min: bounds.min.toArray(), max: bounds.max.toArray() };
}

async function boot() {
  const clips = await loadClipAssets(new URL('./assets/clips.json', document.baseURI));
  const hold = clips.get('hold-idle');
  if (!hold) throw new Error('缺少持枪站立轨道');
  const root = hold.scene;
  if ([...clips.values()].some(({ scene }) => scene !== root)) {
    throw new Error('姿态检查要求动作使用同一具骨架');
  }
  const find = (name: string) => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`GLB 中找不到节点：${name}`);
    return node;
  };
  const rig = find('RigRoot');
  const head = find('Head');
  const facing = find('Facing');
  const rightHand = find('R_Hand');
  const leftHand = find('L_Hand');
  const socket = find('R_Wep');
  const magazine = find('Magazine');
  const well = find('MagazineWell');
  const prop = find('TrainingProp');
  const rightFoot = find('R_Foot');
  const leftFoot = find('L_Foot');
  const skins = getSkins(root);
  root.updateMatrixWorld(true);
  const binding = measureBind(skins);

  // A standard +Z glTF faces the M0 yaw-zero direction after the parent turns by pi.
  const worldAvatar = new THREE.Group();
  worldAvatar.rotation.y = Math.PI;
  worldAvatar.add(root);
  const stage = new THREE.Scene();
  stage.background = new THREE.Color(0x202d34);
  stage.add(worldAvatar, new THREE.HemisphereLight(0xe7f5ff, 0x5f6962, 2.25));
  const light = new THREE.DirectionalLight(0xfff8e6, 2);
  light.position.set(2, 4, -3);
  stage.add(light);
  const grid = new THREE.GridHelper(5, 20, 0x829ca5, 0x425962);
  grid.position.y = -0.002;
  stage.add(grid);
  const axis = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.018, 0), 0.96, 0x76d9c5);
  stage.add(axis);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  viewport.prepend(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(37, 1, 0.05, 25);
  camera.position.set(2.45, 1.48, -2.8);
  camera.lookAt(0, 0.96, -0.09);

  const mixer = new THREE.AnimationMixer(root);
  let action: THREE.AnimationAction | undefined;
  let selected: LoadedClip | undefined;
  let timeS = 0;
  let lastFrameMs: number | undefined;

  const point = (node: THREE.Object3D) => node.getWorldPosition(new THREE.Vector3());
  function draw() {
    if (action) {
      action.time = Math.min(timeS, action.getClip().duration);
      mixer.update(0);
    }
    stage.updateMatrixWorld(true);
    const direction = point(facing).sub(point(head)).setY(0).normalize();
    const barrel = new THREE.Vector3(0, 0, 1).applyQuaternion(socket.getWorldQuaternion(new THREE.Quaternion()));
    const data = {
      clip: selected?.entry.id ?? 'bind',
      blend: selected?.entry.blend ?? null,
      timeS,
      binding,
      bounds: measureBounds(skins),
      forward: direction.toArray(),
      root: point(rig).toArray(),
      rightFoot: point(rightFoot).toArray(),
      leftFoot: point(leftFoot).toArray(),
      socketParent: socket.parent?.name,
      propParent: prop.parent?.name,
      socketLocal: rightHand.worldToLocal(point(socket)).toArray(),
      socketPosition: point(socket).toArray(),
      weaponForward: barrel.toArray(),
      leftHand: point(leftHand).toArray(),
      leftHandRotation: leftHand.getWorldQuaternion(new THREE.Quaternion()).toArray(),
      reloadContactM: point(leftHand).distanceTo(point(well)),
      magazineOffsetM: point(magazine).distanceTo(point(well)),
      trackCount: selected?.animation.tracks.length ?? 0,
      referenceTimeS: selected?.reference?.timeS ?? null,
    };
    measurements.dataset.readback = JSON.stringify(data);
    const bounds = data.bounds;
    measurements.value = [
      `骨骼 ${binding.bones} · 蒙皮顶点 ${binding.vertices} · 动作通道 ${data.trackCount}`,
      `逆绑定矩阵误差 ${binding.inverseBindError.toExponential(2)} · 蒙皮回读误差 ${binding.vertexErrorM.toExponential(2)} m`,
      `高度 ${(bounds.max[1] - bounds.min[1]).toFixed(3)} m · 脚底 ${bounds.min[1].toFixed(3)} m · 前向 [${data.forward.map((value) => value.toFixed(2)).join(', ')}]`,
      `武器挂点 ${data.socketParent} → ${socket.name} · 左手到弹匣口 ${data.reloadContactM.toFixed(3)} m`,
    ].join('\n');
    timeline.value = String(timeS);
    timeOutput.value = timeS.toFixed(3);
    renderer.render(stage, camera);
  }

  function resize() {
    const { clientWidth, clientHeight } = viewport;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    draw();
  }

  function pause() {
    renderer.setAnimationLoop(null);
    lastFrameMs = undefined;
    play.textContent = '播放';
  }

  function setClip() {
    pause();
    mixer.stopAllAction();
    selected = clips.get(clipSelect.value);
    timeS = 0;
    timeline.max = String(selected?.entry.durationS ?? 0);
    timeline.disabled = play.disabled = !selected;
    action = undefined;
    if (selected) {
      if (selected.reference) {
        const base = mixer.clipAction(selected.reference.animation).reset().play();
        base.paused = true;
        base.time = selected.reference.timeS;
      }
      action = mixer.clipAction(selected.animation).reset().play();
      action.paused = true;
    }
    status.textContent = selected ? selected.entry.track + ' · ' + selected.entry.blend : '绑定姿态';
    draw();
  }

  clipSelect.add(new Option('绑定姿态', ''));
  for (const [id] of clips) clipSelect.add(new Option(names.get(id) ?? id, id));
  clipSelect.addEventListener('change', setClip);
  timeline.addEventListener('input', () => {
    pause();
    timeS = timeline.valueAsNumber;
    draw();
  });
  play.addEventListener('click', () => {
    if (play.textContent === '暂停') return pause();
    if (!selected) return;
    const duration = selected.entry.durationS;
    if (timeS >= duration) timeS = 0;
    play.textContent = '暂停';
    renderer.setAnimationLoop((nowMs) => {
      if (lastFrameMs !== undefined) timeS = Math.min(duration, timeS + (nowMs - lastFrameMs) / 1000);
      lastFrameMs = nowMs;
      draw();
      if (timeS >= duration) pause();
    });
  });
  resize();
  new ResizeObserver(resize).observe(viewport);
  clipSelect.disabled = false;
  setClip();
}

void boot().catch((error: unknown) => {
  status.textContent = '姿态回读失败';
  console.error(error);
});
