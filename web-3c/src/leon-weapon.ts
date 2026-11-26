import { Group, Matrix4 } from 'three';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const WEAPON_GRIP = 'C_Attach_Hand_A';

export async function loadLocalLeonWeapon(): Promise<Object3D | undefined> {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) return;
  const url = new URL('./__re9-reference/wp0100.glb', document.baseURI);
  const response = await fetch(url);
  if (response.status !== 200 || response.headers.get('X-RE9-Reference') !== '1') return;
  const { scene } = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  if (!scene.getObjectByName(WEAPON_GRIP)) throw new Error('wp0100 缺少武器握把');
  return scene;
}

export function attachLeonWeapon(model: Object3D, socket: Matrix4) {
  const root = new Group();
  root.name = 'wp0100-R_Wep';
  root.matrixAutoUpdate = false;
  root.add(model);
  const grip = model.getObjectByName(WEAPON_GRIP);
  if (!grip) throw new Error('wp0100 缺少武器握把');
  root.updateMatrixWorld(true);
  const inverseGrip = grip.matrixWorld.clone().invert();
  return {
    root,
    draw() {
      root.matrix.multiplyMatrices(socket, inverseGrip);
      root.matrixWorldNeedsUpdate = true;
    },
  };
}
