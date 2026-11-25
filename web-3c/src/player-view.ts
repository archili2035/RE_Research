import * as THREE from 'three';
import type { ActionPose } from './actions.ts';
import type { Vec3 } from './contracts.ts';
import { createLeonView } from './leon-view.ts';
import type { LeonAssets } from './leon-view.ts';

interface Appearance {
  readonly root: THREE.Object3D;
  draw?(pose: ActionPose): void;
}

const ACTOR_HIDDEN_DISTANCE_M = 0.82;
const ACTOR_OPAQUE_DISTANCE_M = 1.45;

function bindFade(actor: THREE.Object3D) {
  const materials = new Map<THREE.Material, Pick<THREE.Material, 'opacity' | 'transparent' | 'depthWrite'>>();
  actor.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of [object.material].flat()) {
      const { opacity, transparent, depthWrite } = material;
      materials.set(material, { opacity, transparent, depthWrite });
    }
  });
  return (alpha: number) => {
    for (const [material, original] of materials) {
      material.opacity = original.opacity * alpha;
      material.depthWrite = original.depthWrite && alpha === 1;
      const transparent = original.transparent || alpha < 1;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
    }
  };
}

export function createPlayerView(graybox: Appearance) {
  const root = new THREE.Group();
  root.name = 'player-actor';
  root.add(graybox.root);
  const fadeByAppearance = new Map<Appearance, ReturnType<typeof bindFade>>();
  let active = graybox;
  let fade = bindFade(graybox.root);
  fadeByAppearance.set(graybox, fade);

  function useAppearance(view: Appearance) {
    if (view === active) return;
    root.remove(active.root);
    root.add(view.root);
    active = view;
    fade = fadeByAppearance.get(view) ?? bindFade(view.root);
    fadeByAppearance.set(view, fade);
  }

  function draw(feet: Vec3, yawRad: number, pose: ActionPose, cameraPosition: Vec3) {
    root.position.set(feet.x, feet.y, feet.z);
    root.rotation.y = yawRad;
    const distanceM = Math.hypot(feet.x - cameraPosition.x, feet.z - cameraPosition.z);
    const alpha = THREE.MathUtils.smoothstep(distanceM, ACTOR_HIDDEN_DISTANCE_M, ACTOR_OPAQUE_DISTANCE_M);
    root.visible = alpha > 0;
    fade(alpha);
    if (root.visible) active.draw?.(pose);
  }

  return { root, draw, useAppearance, useGraybox: () => useAppearance(graybox) };
}

export function bindPlayerAppearance(view: ReturnType<typeof createPlayerView>, assets: Promise<LeonAssets | undefined>) {
  const select = document.querySelector<HTMLSelectElement>('#player-appearance')!;
  const option = select.querySelector<HTMLOptionElement>('option[value="leon"]')!;
  const status = document.querySelector<HTMLOutputElement>('#appearance-status')!;
  let source: LeonAssets | undefined;
  let leon: ReturnType<typeof createLeonView> | undefined;
  void assets.then((loaded) => {
    source = loaded;
    option.disabled = !loaded;
    status.value = loaded ? '' : '里昂灰模需从本机仓库加载';
  });
  select.addEventListener('change', () => {
    if (select.value === 'leon' && source) {
      try {
        leon ??= createLeonView(source);
        view.useAppearance(leon);
        return;
      } catch (error) {
        option.disabled = true;
        status.value = '里昂灰模加载失败';
        console.warn('里昂灰模加载失败', error);
      }
    }
    select.value = 'graybox';
    view.useGraybox();
  });
}
