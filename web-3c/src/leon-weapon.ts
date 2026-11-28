import { Group, Matrix4 } from 'three';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isLocalHost } from './local-host.ts';

export const WEAPON_GRIP = 'C_Attach_Hand_A';

/** Loads wp0100 from the local reference middleware or, on the portal, from the published player directory. */
export async function loadLocalLeonWeapon(): Promise<Object3D | undefined> {
  const local = isLocalHost();
  const url = new URL(local ? './__re9-reference/player/wp0100.glb' : '../player/wp0100.glb', document.baseURI);
  const response = await fetch(url).catch(() => undefined);
  if (!response || response.status !== 200 || (local && response.headers.get('X-RE9-Reference') !== '1')) return;
  const { scene } = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  if (!scene.getObjectByName(WEAPON_GRIP)) throw new Error('wp0100 缺少武器握把');
  return scene;
}

type BonePose = { position: readonly number[]; rotation: readonly number[] };

export function attachLeonWeapon(model: Object3D, socket: Matrix4) {
  // Weapon skeleton (skinned export): remember the bind transform of every named node for restore.
  const bones = new Map<string, { node: Object3D; bind: BonePose }>();
  model.traverse((node) => {
    if (node.name && !bones.has(node.name)) {
      bones.set(node.name, { node, bind: { position: node.position.toArray(), rotation: node.quaternion.toArray() } });
    }
  });
  let posed = false;
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
    /** Applies wp0100 clip samples by bone name, or restores the bind pose when no clip is active. */
    pose(sample?: (name: string, bind: BonePose) => BonePose | undefined) {
      if (!sample && !posed) return;
      for (const [name, { node, bind }] of bones) {
        const value = sample?.(name, bind) ?? bind;
        node.position.fromArray(value.position as number[]);
        node.quaternion.fromArray(value.rotation as number[]);
      }
      posed = Boolean(sample);
    },
    draw() {
      root.matrix.multiplyMatrices(socket, inverseGrip);
      root.matrixWorldNeedsUpdate = true;
    },
  };
}