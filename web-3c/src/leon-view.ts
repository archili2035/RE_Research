import * as THREE from 'three';
import type { ActionPose } from './actions.ts';
import { plantToe } from './leon-foot-plant.ts';
import type { LocalPose } from './leon-foot-plant.ts';

type Values = readonly number[];
type Channel = Readonly<{ times: readonly number[]; values: readonly Values[] }>;
type BonePose = LocalPose & { name: string };
type Motion = Readonly<{
  bank: number;
  id: number;
  duration: number;
  bones: readonly Readonly<{ name: string; position: Values; rotation: Values }>[];
  tracks: readonly Readonly<{ bone: number } & Partial<Record<keyof LocalPose, Channel>>>[];
}>;

export interface LeonAssets {
  readonly MOTION_DATA: Readonly<{ clips: readonly Motion[] }>;
  readonly MODEL_DATA: unknown;
  readonly MASK_DATA: readonly Readonly<{ ID: number; Joints: readonly Readonly<{ Name: string; Weight: number }>[] }>[];
  readonly MotionMath: Readonly<{
    sample: (track: Channel | undefined, timeS: number, fallback: Values, rotation?: boolean) => Values;
    slerp: (a: Values, b: Values, weight: number) => Values;
    previewOnBasePose: (clip: Motion, base: Motion) => Motion;
  }>;
  readonly LeonSkinning: Readonly<{
    create: (three: typeof THREE, model: unknown) => {
      group: THREE.Group;
      parts: readonly Readonly<{ bones: readonly Readonly<{ name: string; world: THREE.Matrix4 }>[] }>[];
      update: (sample: (bone: BonePose) => LocalPose | undefined) => void;
      stats: {
        parts: number; vertices: number; bindingError: number;
        bounds: { min: Values; max: Values } | null;
      };
    };
  }>;
}

export function createLeonView(assets: LeonAssets) {
  const { MotionMath, MOTION_DATA, LeonSkinning, MODEL_DATA, MASK_DATA } = assets;
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
  const walkSource = find(120);
  const walk = index(walkSource);
  const travel = walk.tracks.get('root')?.position?.values;
  const strideM = (travel?.at(-1)?.[2] ?? 0) - (travel?.[0]?.[2] ?? 0);
  if (strideM <= 0) throw new Error('里昂前移轨缺少有效的步幅');
  const mask = (id: number) => {
    const source = MASK_DATA.find((value) => value.ID === id);
    if (!source) throw new Error(`缺少里昂动作遮罩 ${id}`);
    return new Map(source.Joints.map(({ Name, Weight }) => [Name, Weight]));
  };
  const holdMask = mask(4);
  const reloadMask = mask(2);
  const walkBones = new Map(walkSource.bones.map((bone) => [bone.name, { ...bone, scale: [1, 1, 1] }]));
  const legChains = ['L', 'R'].map((side) => {
    const names = ['Hip', ...['Upper', 'Lower', 'Ankle', 'Foot', 'Toes'].map((joint) => `${side}_Leg_${joint}`)];
    return names.map((name) => {
      const bone = walkBones.get(name);
      if (!bone) throw new Error(`里昂前移轨缺少骨骼 ${name}`);
      return bone;
    });
  });
  const rig = LeonSkinning.create(THREE, MODEL_DATA);
  const root = new THREE.Group();
  root.name = 'avatar-leon';
  rig.group.rotation.y = Math.PI; // Source motion faces +Z, the game faces -Z at yaw zero.
  root.add(rig.group);

  const sample = (clip: ReturnType<typeof index>, timeS: number, bone: BonePose): LocalPose => {
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
        last.forwardBlend === pose.forwardBlend && last.forwardDistanceM === pose.forwardDistanceM) return;

    const walkWeight = THREE.MathUtils.smoothstep(pose.forwardBlend, 0, 1);
    // Start near left support. Distance follows the authored linear root track, with Rapier owning translation.
    const walkTimeS = (0.70 + walk.duration * pose.forwardDistanceM / strideM) % walk.duration;
    const aim = pose.lift === 1 ? hold : raise;
    const aimTimeS = aim === hold ? 0 : raise.duration * pose.lift;
    const aimWeight = pose.lift > 0 ? 1 - walkWeight * (1 - THREE.MathUtils.smoothstep(pose.lift, 0.4, 1)) : 0;
    const action = pose.clip === 'fire' ? fire : pose.clip === 'reload' ? reload : undefined;
    const actionTimeS = action ? action.duration * pose.progress : 0;
    const actionWeight = action === reload ? Math.min(1, 10 * pose.progress, 10 * (1 - pose.progress)) : 1;
    const actionMask = action === reload ? reloadMask : holdMask;

    const locomotion = (bone: BonePose) => {
      if (!walkWeight || !walk.tracks.has(bone.name)) return sample(raise, 0, bone);
      const stride = sample(walk, walkTimeS, bone);
      return walkWeight === 1 ? stride : blend(sample(raise, 0, bone), stride, walkWeight);
    };
    // During the stance blend, maintain the source support toe's horizontal position. Release across toe-off.
    const plantRotations = new Map<string, Values>();
    if (walkWeight < 1) {
      const smooth = THREE.MathUtils.smoothstep;
      const phase = walkTimeS / walk.duration;
      const toeWeights = [
        smooth(phase, 0.34, 0.41) * (1 - smooth(phase, 0.75, 0.86)),
        Math.max(smooth(phase, 0.89, 0.96), 1 - smooth(phase, 0.35, 0.42)),
      ];
      legChains.forEach((chain, index) => {
        if (!toeWeights[index]) return;
        const rotations = plantToe(chain.map(locomotion), chain.map((bone) => sample(walk, walkTimeS, bone)), toeWeights[index]);
        rotations?.forEach((rotation, joint) => plantRotations.set(chain[joint + 1].name, rotation));
      });
    }

    const hip = legChains[0][0];
    const compensateHip = new THREE.Quaternion().fromArray(locomotion(hip).rotation).invert()
      .multiply(new THREE.Quaternion().fromArray(sample(aim, aimTimeS, hip).rotation));
    const spineRotation = new THREE.Quaternion();
    const stabilize = (name: string, value: LocalPose): LocalPose => name === 'Spine_0' ? {
      ...value, rotation: spineRotation.fromArray(value.rotation).premultiply(compensateHip).normalize().toArray(),
    } : value;

    rig.update((bone) => {
      if (bone.name === 'root') return;
      const aimJointWeight = aimWeight * (holdMask.get(bone.name) ?? 0);
      const actionJointWeight = action ? actionWeight * (actionMask.get(bone.name) ?? 0) : 0;
      if (!raise.tracks.has(bone.name) && !(walkWeight && walk.tracks.has(bone.name)) && !aimJointWeight && !actionJointWeight) return;
      let value = locomotion(bone);
      const planted = plantRotations.get(bone.name);
      if (planted) value = { ...value, rotation: planted };
      if (aimJointWeight > 0 && aim.tracks.has(bone.name)) {
        const target = stabilize(bone.name, sample(aim, aimTimeS, bone));
        value = aimJointWeight === 1 ? target : blend(value, target, aimJointWeight);
      }
      if (action && actionJointWeight > 0 && action.tracks.has(bone.name)) {
        const target = stabilize(bone.name, sample(action, actionTimeS, bone));
        value = actionJointWeight === 1 ? target : blend(value, target, actionJointWeight);
      }
      return value;
    });
    if (rig.stats.bounds) rig.group.position.y = -rig.stats.bounds.min[1];
    last = pose;
  }

  function readJoint(name: string) {
    for (const { bones } of rig.parts) {
      const joint = bones.find((bone) => bone.name === name);
      if (!joint) continue;
      rig.group.updateWorldMatrix(true, false);
      return new THREE.Matrix4().multiplyMatrices(rig.group.matrixWorld, joint.world);
    }
  }

  return { root, draw, readJoint, readSkin: () => rig.stats };
}
