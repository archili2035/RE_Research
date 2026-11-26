import { AnimationUtils, PropertyBinding } from 'three';
import type { AnimationClip, Group } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadClipManifest } from './clip-manifest.ts';
import type { ClipManifest } from './contracts.ts';

type ClipEntry = ClipManifest['clips'][number];

export interface LoadedClip {
  readonly entry: ClipEntry;
  readonly scene: Group;
  readonly animation: AnimationClip;
  readonly reference?: Readonly<{ animation: AnimationClip; timeS: number }>;
}

const timeToleranceS = 1e-5;

function findAnimation(gltf: GLTF, name: string) {
  const matches = gltf.animations.filter((clip) => clip.name === name);
  if (matches.length !== 1 || !matches[0].validate()) {
    throw new Error(`GLB 动作轨道无效或名称不唯一：${name}`);
  }
  return matches[0];
}

function prepareAdditive(animation: AnimationClip, reference: AnimationClip, timeS: number, mask: readonly string[]) {
  const additive = animation.clone();
  const nodes = new Set(mask);
  const trackNode = (trackName: string) => PropertyBinding.parseTrackName(trackName).nodeName;
  additive.tracks = additive.tracks.filter((track) => nodes.has(trackNode(track.name)));
  if (nodes.size !== mask.length || mask.some((node) => !additive.tracks.some((track) => trackNode(track.name) === node))) {
    throw new Error(`动作 ${animation.name} 的骨骼遮罩与轨道不匹配`);
  }
  for (const track of additive.tracks) {
    if (!reference.tracks.some((base) => base.name === track.name && base.ValueTypeName === track.ValueTypeName)) {
      throw new Error(`基准姿态缺少轨道：${track.name}`);
    }
  }
  // Using 1 fps lets the Three.js reference-frame parameter express time directly in seconds.
  return AnimationUtils.makeClipAdditive(additive, timeS, reference, 1);
}

export async function loadClipAssets(manifestUrl: URL, manifest?: ClipManifest): Promise<ReadonlyMap<string, LoadedClip>> {
  const { clips } = manifest ?? await loadClipManifest(manifestUrl);
  const loader = new GLTFLoader();
  const files = new Map<string, Promise<GLTF>>();
  const load = (path: string) => {
    const url = new URL(path, manifestUrl).href;
    const existing = files.get(url);
    if (existing) return existing;
    const pending = loader.loadAsync(url);
    files.set(url, pending);
    return pending;
  };

  const entries = await Promise.all(clips.map(async (entry) => {
    const gltf = await load(entry.glb);
    const animation = findAnimation(gltf, entry.track);
    if (Math.abs(entry.durationS - animation.duration) > timeToleranceS) {
      throw new Error(`动作 ${entry.id} 的时长与 GLB 不匹配`);
    }
    if (entry.blend !== 'additive') return [entry.id, { entry, scene: gltf.scene, animation }] as const;

    const pose = entry.referencePose;
    if (!pose || typeof pose.glb !== 'string' || !pose.glb || !Array.isArray(entry.boneMask) ||
        !entry.boneMask.length || !Number.isFinite(pose.timeS) || pose.timeS < 0) {
      throw new Error(`增量动作 ${entry.id} 缺少有效的基准姿态或遮罩`);
    }
    const base = findAnimation(await load(pose.glb), pose.track);
    if (pose.timeS > base.duration + timeToleranceS) throw new Error(`基准姿态时间超出轨道：${pose.track}`);
    const timeS = Math.min(pose.timeS, base.duration);
    return [entry.id, {
      entry,
      scene: gltf.scene,
      animation: prepareAdditive(animation, base, timeS, entry.boneMask),
      reference: { animation: base, timeS },
    }] as const;
  }));
  return new Map(entries);
}
