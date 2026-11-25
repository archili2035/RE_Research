import * as THREE from 'three';
import type { ActionPose } from './actions.ts';

type Values = readonly number[];
type Channel = Readonly<{ times: readonly number[]; values: readonly Values[] }>;
type LocalPose = Readonly<{ position: Values; rotation: Values; scale: Values }>;
type Motion = Readonly<{
  bank: number;
  id: number;
  duration: number;
  bones: readonly Readonly<{ name: string }>[];
  tracks: readonly Readonly<{ bone: number } & Partial<Record<keyof LocalPose, Channel>>>[];
}>;

export interface LeonAssets {
  readonly MOTION_DATA: Readonly<{ clips: readonly Motion[] }>;
  readonly MODEL_DATA: unknown;
  readonly MotionMath: Readonly<{
    sample: (track: Channel | undefined, timeS: number, fallback: Values, rotation?: boolean) => Values;
    slerp: (a: Values, b: Values, weight: number) => Values;
    previewOnBasePose: (clip: Motion, base: Motion) => Motion;
  }>;
  readonly LeonSkinning: Readonly<{
    create: (three: typeof THREE, model: unknown) => {
      group: THREE.Group;
      update: (sample: (bone: LocalPose & { name: string }) => LocalPose | undefined) => void;
      stats: {
        parts: number; vertices: number; bindingError: number;
        bounds: { min: Values; max: Values } | null;
      };
    };
  }>;
}

export function createLeonView(assets: LeonAssets) {
  const { MotionMath, MOTION_DATA, LeonSkinning, MODEL_DATA } = assets;
  const find = (id: number) => {
    const clip = MOTION_DATA.clips.find((item) => item.bank === 100 && item.id === id);
    if (!clip) throw new Error(`缺少里昂源动作 100/${id}`);
    return clip;
  };
  const index = (motion: Motion) => ({
    duration: motion.duration,
    tracks: new Map(motion.tracks.map((track) => [motion.bones[track.bone].name, track])),
  });
  const holdSource = find(160);
  const hold = index(holdSource);
  const raise = index(find(140));
  const fire = index(MotionMath.previewOnBasePose(find(1100), holdSource));
  const reload = index(find(1200));
  const walk = index(find(120));
  const rig = LeonSkinning.create(THREE, MODEL_DATA);
  const root = new THREE.Group();
  root.name = 'avatar-leon';
  rig.group.rotation.y = Math.PI; // Source motion faces +Z, the game faces -Z at yaw zero.
  root.add(rig.group);

  const sample = (clip: ReturnType<typeof index>, timeS: number, bone: LocalPose & { name: string }): LocalPose => {
    const track = clip.tracks.get(bone.name);
    return {
      position: MotionMath.sample(track?.position, timeS, bone.position),
      rotation: MotionMath.sample(track?.rotation, timeS, bone.rotation, true),
      scale: MotionMath.sample(track?.scale, timeS, bone.scale),
    };
  };
  const blend = (from: LocalPose, to: LocalPose, weight: number): LocalPose => ({
    position: from.position.map((value, i) => THREE.MathUtils.lerp(value, to.position[i], weight)),
    rotation: MotionMath.slerp(from.rotation, to.rotation, weight),
    scale: from.scale.map((value, i) => THREE.MathUtils.lerp(value, to.scale[i], weight)),
  });

  let last: ActionPose | undefined;
  function draw(pose: ActionPose) {
    if (last?.clip === pose.clip && last.progress === pose.progress && last.lift === pose.lift &&
        last.gaitWeight === pose.gaitWeight && (pose.gaitWeight === 0 || last.gaitPhaseRad === pose.gaitPhaseRad)) return;

    const base = pose.lift === 1 ? hold : raise;
    const baseTimeS = base === hold ? 0 : raise.duration * pose.lift;
    const action = pose.clip === 'fire' ? fire : pose.clip === 'reload' ? reload : undefined;
    const actionTimeS = action ? action.duration * pose.progress : 0;
    const actionWeight = action === reload ? Math.min(1, 10 * pose.progress, 10 * (1 - pose.progress)) : 1;
    const walkTimeS = walk.duration * (pose.gaitPhaseRad / (2 * Math.PI));

    rig.update((bone) => {
      // Keep root motion with the capsule. Source walk travels 1.76 m along +Z per loop.
      if (bone.name === 'root') return;
      const leg = pose.gaitWeight > 0 && /^[LR]_Leg_/.test(bone.name) && walk.tracks.has(bone.name);
      const hasBase = base.tracks.has(bone.name);
      const hasAction = actionWeight > 0 && action?.tracks.has(bone.name);
      if (!hasBase && !hasAction && !leg) return;
      let value = sample(base, baseTimeS, bone);
      if (action && hasAction) {
        const actionValue = sample(action, actionTimeS, bone);
        value = actionWeight === 1 ? actionValue : blend(value, actionValue, actionWeight);
      }
      return leg ? blend(value, sample(walk, walkTimeS, bone), pose.gaitWeight) : value;
    });
    if (rig.stats.bounds) rig.group.position.y = -rig.stats.bounds.min[1];
    last = pose;
  }

  return { root, draw, readSkin: () => rig.stats };
}
