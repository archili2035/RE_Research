import * as THREE from 'three';
import type { ActionPose, WalkPose } from './actions.ts';
import { plantToe, toePosition } from './leon-foot-plant.ts';
import type { LocalPose } from './leon-foot-plant.ts';
import { LEON_WALK, leonWalkTime } from './leon-locomotion.ts';
import { attachLeonWeapon } from './leon-weapon.ts';

type Values = readonly number[];
type Channel = Readonly<{ times: readonly number[]; values: readonly Values[] }>;
type BonePose = LocalPose & { name: string };
type Motion = Readonly<{
  bank: number;
  id: number;
  duration: number;
  bones: readonly Readonly<{ name: string; parent: number; position: Values; rotation: Values }>[];
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

export function createLeonView(assets: LeonAssets, weaponModel?: THREE.Object3D) {
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
  const turnLeft = index(find(165));
  const turnRight = index(find(167));
  const raise = index(find(140));
  const fire = index(find(1100));
  const reload = index(find(1200));
  const walkSources = LEON_WALK.map(({ id }) => find(id));
  const walkClips = walkSources.map(index);
  const walk = walkClips[0];
  const mask = (id: number) => {
    const source = MASK_DATA.find((value) => value.ID === id);
    if (!source) throw new Error(`缺少里昂动作遮罩 ${id}`);
    return new Map(source.Joints.map(({ Name, Weight }) => [Name, Weight]));
  };
  const holdMask = mask(4);
  const reloadMask = mask(2);
  const hipSource = walkSources[0].bones.find(({ name }) => name === 'Hip');
  if (!hipSource) throw new Error('里昂源动作缺少髋关节');
  const hip = { ...hipSource, scale: [1, 1, 1] };
  const lowerBody = (name: string) => name === 'Hip' || name.startsWith('L_Leg_') || name.startsWith('R_Leg_');
  const legChains = ['L', 'R'].map((side) => [hip, ...['Upper', 'Lower', 'Ankle', 'Foot', 'Toes'].map((name) => {
    const bone = walkSources[0].bones.find((item) => item.name === `${side}_Leg_${name}`);
    if (!bone) throw new Error(`里昂源动作缺少 ${side}_Leg_${name}`);
    return { ...bone, scale: [1, 1, 1] };
  })]);
  const rig = LeonSkinning.create(THREE, MODEL_DATA);
  const root = new THREE.Group();
  root.name = 'avatar-leon';
  rig.group.rotation.y = Math.PI; // Source motion faces +Z, the game faces -Z at yaw zero.
  root.add(rig.group);
  // R_Wep is an animation helper and does not survive in the LOD2 skin joint lists.
  const sourceSocket = holdSource.bones.find(({ name }) => name === 'R_Wep');
  const socketParent = sourceSocket && holdSource.bones[sourceSocket.parent];
  const hand = rig.parts.flatMap(({ bones }) => bones).find(({ name }) => name === socketParent?.name);
  const socketBone = sourceSocket && { ...sourceSocket, scale: [1, 1, 1] };
  const socket = new THREE.Matrix4();
  const socketPosition = new THREE.Vector3();
  const socketRotation = new THREE.Quaternion();
  const socketScale = new THREE.Vector3();
  if (weaponModel && (!socketBone || !hand)) throw new Error('里昂源骨架缺少 R_Wep 挂点链');
  const weapon = weaponModel && attachLeonWeapon(weaponModel, socket);
  if (weapon) rig.group.add(weapon.root);

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

  const movingSamples = ({ cycles, weights }: Pick<WalkPose, 'cycles' | 'weights'>) =>
    walkClips.flatMap((clip, i) => weights[i] > 0 ?
      [{ clip, time: leonWalkTime(cycles, i, clip.duration), weight: weights[i] }] : []);
  const sampleStride = (bone: BonePose, clips: ReturnType<typeof movingSamples>) => {
    const [first, ...others] = clips;
    let stride = sample(first.clip, first.time, bone);
    let total = first.weight;
    for (const { clip, time, weight } of others) {
      total += weight;
      stride = blend(stride, sample(clip, time, bone), weight / total);
    }
    return stride;
  };
  const sampleLeg = (bone: BonePose, weight: number, clips: ReturnType<typeof movingSamples>) => {
    if (!weight) return sample(raise, 0, bone);
    const stride = sampleStride(bone, clips);
    return weight === 1 ? stride : blend(sample(raise, 0, bone), stride, weight);
  };

  // Calibrate once at rest. Animated toe and clothing bounds must not move the whole actor.
  rig.update((bone) => bone.name !== 'root' && raise.tracks.has(bone.name) ? sample(raise, 0, bone) : undefined);
  if (rig.stats.bounds) rig.group.position.y = -rig.stats.bounds.min[1];

  let last: ActionPose | undefined;
  const inverseModel = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  function draw(pose: ActionPose) {
    const gait = pose.walk;
    const aimMotion = pose.aim;
    const planted = gait.plants.some((support) => support && support.weight > 0);
    if (!planted && !last?.walk.plants.some((support) => support && support.weight > 0) &&
        last?.clip === pose.clip && last.progress === pose.progress && last.lift === pose.lift &&
        last.walk.cycles === gait.cycles && last.walk.blend === gait.blend &&
        last.walk.weights.every((weight, i) => weight === gait.weights[i]) &&
        (pose.lift !== 1 || (last.aim.idleTimeS === aimMotion.idleTimeS &&
          last.aim.stationaryBlend === aimMotion.stationaryBlend &&
          last.aim.turn === aimMotion.turn && last.aim.turnTimeS === aimMotion.turnTimeS))) return;

    const walkWeight = THREE.MathUtils.smoothstep(gait.blend, 0, 1);
    const upperWalkWeight = walkWeight * THREE.MathUtils.smoothstep(gait.weights[0], 0.85, 1);
    // Keep the stride in the upper body while biasing the coordinated chain toward the hold.
    const aimedWalkWeight = 0.38 * walkWeight * THREE.MathUtils.smoothstep(pose.lift, 0.65, 1);
    const walkingTime = leonWalkTime(gait.cycles, 0, walk.duration);
    const movingClips = movingSamples(gait);
    const aim = pose.lift === 1 ? hold : raise;
    const aimTimeS = aim === hold ? aimMotion.idleTimeS % hold.duration : raise.duration * pose.lift;
    const aimWeight = pose.lift > 0 ? 1 - upperWalkWeight * (1 - THREE.MathUtils.smoothstep(pose.lift, 0.4, 1)) : 0;
    const stationary = aim === hold ? THREE.MathUtils.smoothstep(aimMotion.stationaryBlend, 0, 1) : 0;
    const turn = aimMotion.turn > 0 ? turnLeft : turnRight;
    const turnWeight = stationary * Math.abs(aimMotion.turn);
    const turnTimeS = aimMotion.turnTimeS % turn.duration;
    const action = pose.clip === 'fire' ? fire : pose.clip === 'reload' ? reload : undefined;
    const actionTimeS = action ? action.duration * pose.progress : 0;
    const actionWeight = action === reload ? Math.min(1, 10 * pose.progress, 10 * (1 - pose.progress)) : 1;
    const actionMask = action === reload ? reloadMask : holdMask;

    const basePose = (bone: BonePose) => {
      const ready = sample(raise, 0, bone);
      if (!upperWalkWeight || !walk.tracks.has(bone.name)) return ready;
      const stride = sample(walk, walkingTime, bone);
      return upperWalkWeight === 1 ? stride : blend(ready, stride, upperWalkWeight);
    };
    const locomotion = (bone: BonePose) => lowerBody(bone.name) ? sampleLeg(bone, walkWeight, movingClips) : basePose(bone);
    const hipPose = locomotion(hip);
    const hipBase = basePose(hip);
    const plantedRotations = new Map<string, Values>();
    if (planted) {
      rig.group.updateWorldMatrix(true, false);
      inverseModel.copy(rig.group.matrixWorld).invert();
      gait.plants.forEach((support, side) => {
        if (!support || !support.weight) return;
        const { anchor, weight } = support;
        const chain = legChains[side];
        const clips = movingSamples(anchor);
        const blendWeight = THREE.MathUtils.smoothstep(anchor.blend, 0, 1);
        const target = toePosition(chain.map((bone) => sampleLeg(bone, blendWeight, clips)))
          .applyAxisAngle(up, anchor.yawRad + Math.PI)
          .add(new THREE.Vector3(anchor.position.x, anchor.position.y + rig.group.position.y, anchor.position.z))
          .applyMatrix4(inverseModel);
        const rotations = plantToe(chain.map(locomotion), target, weight);
        rotations?.forEach((rotation, joint) => plantedRotations.set(chain[joint + 1].name, rotation));
      });
    }

    const aimSample = (bone: BonePose) => {
      const base = sample(aim, aimTimeS, bone);
      return turnWeight ? blend(base, sample(turn, turnTimeS, bone), turnWeight) : base;
    };
    const inverseHip = new THREE.Quaternion().fromArray(hipPose.rotation).invert();
    const keepReadyTorso = inverseHip.clone().multiply(new THREE.Quaternion().fromArray(hipBase.rotation));
    const referenceHip = inverseHip.clone().multiply(new THREE.Quaternion().fromArray(sample(aim, aimTimeS, hip).rotation));
    const aimingHip = turnWeight ? inverseHip.clone().multiply(new THREE.Quaternion().fromArray(aimSample(hip).rotation)) : referenceHip;
    const spineRotation = new THREE.Quaternion();
    const stabilize = (name: string, value: LocalPose, compensation: THREE.Quaternion): LocalPose => name === 'Spine_0' ? {
      ...value, rotation: spineRotation.fromArray(value.rotation).premultiply(compensation).normalize().toArray(),
    } : value;
    const fireRotation = new THREE.Quaternion();
    const fireDelta = new THREE.Quaternion();

    const resolvePose = (bone: BonePose) => {
      if (bone.name === 'root') return;
      const aimJointWeight = aimWeight * (holdMask.get(bone.name) ?? 0);
      const actionJointWeight = action ? actionWeight * (actionMask.get(bone.name) ?? 0) : 0;
      const aimedWalkJoint = aimedWalkWeight > 0 && !lowerBody(bone.name) &&
        movingClips.some(({ clip }) => clip.tracks.has(bone.name));
      if (!raise.tracks.has(bone.name) && !(walkWeight && (walk.tracks.has(bone.name) || lowerBody(bone.name))) &&
          !aimJointWeight && !actionJointWeight && !aimedWalkJoint) return;
      let value = bone.name === 'Hip' ? hipPose : locomotion(bone);
      if (bone.name === 'Spine_0' && upperWalkWeight < walkWeight) {
        value = { ...value, rotation: spineRotation.fromArray(value.rotation).premultiply(keepReadyTorso).normalize().toArray() };
      }
      if (aimJointWeight > 0 && aim.tracks.has(bone.name)) {
        const target = stabilize(bone.name, aimSample(bone), aimingHip);
        value = aimJointWeight === 1 ? target : blend(value, target, aimJointWeight);
      }
      if (aimedWalkJoint) {
        value = blend(value, sampleStride(bone, movingClips), aimedWalkWeight);
      }
      const plantedRotation = plantedRotations.get(bone.name);
      if (plantedRotation) value = { ...value, rotation: plantedRotation };
      const actionTrack = actionJointWeight > 0 && action?.tracks.get(bone.name);
      if (actionTrack && action === fire) {
        // Compose the 1100 delta over the base pose sampled for this frame.
        const offset = MotionMath.sample(actionTrack.position, actionTimeS, [0, 0, 0]);
        const delta = MotionMath.sample(actionTrack.rotation, actionTimeS, [0, 0, 0, 1], true);
        const target = { ...value, position: value.position.map((x, i) => x + offset[i]),
          rotation: fireRotation.fromArray(value.rotation).multiply(fireDelta.fromArray(delta)).normalize().toArray() };
        value = actionJointWeight === 1 ? target : blend(value, target, actionJointWeight);
      } else if (actionTrack && action === reload) {
        const target = stabilize(bone.name, sample(reload, actionTimeS, bone), referenceHip);
        value = actionJointWeight === 1 ? target : blend(value, target, actionJointWeight);
      }
      return value;
    };
    rig.update(resolvePose);
    if (socketBone && hand) {
      const local = resolvePose(socketBone) ?? socketBone;
      socket.compose(socketPosition.fromArray(local.position), socketRotation.fromArray(local.rotation),
        socketScale.fromArray(local.scale)).premultiply(hand.world);
    }
    weapon?.draw();
    last = pose;
  }

  function readJoint(name: string) {
    if (name === 'R_Wep' && socketBone && hand && last) {
      rig.group.updateWorldMatrix(true, false);
      return new THREE.Matrix4().multiplyMatrices(rig.group.matrixWorld, socket);
    }
    for (const { bones } of rig.parts) {
      const joint = bones.find((bone) => bone.name === name);
      if (!joint) continue;
      rig.group.updateWorldMatrix(true, false);
      return new THREE.Matrix4().multiplyMatrices(rig.group.matrixWorld, joint.world);
    }
  }

  return { root, draw, readJoint, readSkin: () => rig.stats };
}
