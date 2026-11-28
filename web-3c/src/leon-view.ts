import * as THREE from 'three';
import type { ActionPose, WalkPose } from './actions.ts';
import { plantToe, toePosition } from './leon-foot-plant.ts';
import type { LocalPose } from './leon-foot-plant.ts';
import { LEON_MOVE_RUN, LEON_MOVE_WALK, LEON_WALK, leonWalkTime } from './leon-locomotion.ts';
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
  /** Optional local-only clips exported by scripts/web-3c/Leon3CExport (bank 100 extras and bank 200 Handgun00M). */
  readonly MOTION_EXTRA_DATA?: Readonly<{ clips: readonly Motion[] }>;
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

export interface LeonViewOptions {
  /** Distribute the committed camera pitch over the spine while the gun is raised. */
  readonly upperBodyPitch?: boolean;
}

export function createLeonView(assets: LeonAssets, weaponModel?: THREE.Object3D, options: LeonViewOptions = {}) {
  const followPitch = options.upperBodyPitch ?? true;
  const { MotionMath, MOTION_DATA, LeonSkinning, MODEL_DATA, MASK_DATA, MOTION_EXTRA_DATA } = assets;
  const find = (id: number) => {
    const clip = MOTION_DATA.clips.find((item) => item.bank === 100 && item.id === id);
    if (!clip) throw new Error(`缺少里昂源动作 100/${id}`);
    return clip;
  };
  const findExtra = (bank: number, id: number) => MOTION_EXTRA_DATA?.clips.find((item) => item.bank === bank && item.id === id);
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
  // Carry-gun locomotion (Handgun00M) and idle, available only with the local extra clips.
  const moveSources = LEON_MOVE_WALK.map(({ id }) => findExtra(200, id));
  const runSource = findExtra(200, LEON_MOVE_RUN.id);
  const idleSource = findExtra(200, 0);
  const carry = moveSources.every(Boolean) && runSource && idleSource ? {
    walk: (moveSources as Motion[]).map(index), run: index(runSource), idle: index(idleSource),
  } : undefined;
  const carryClips = new Set(carry ? [...carry.walk, carry.run] : []);
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

  const movingSamples = ({ cycles, carryCycles, weights, hold: holdShare, run: runShare }:
    Pick<WalkPose, 'cycles' | 'carryCycles' | 'weights' | 'hold' | 'run'>) => {
    // Without the carry-gun set, every direction uses the aimed strafe loops as before.
    const holdWeight = carry ? holdShare : 1;
    const clips = walkClips.flatMap((clip, i) => weights[i] * holdWeight > 0 ?
      [{ clip, time: leonWalkTime(cycles, i, clip.duration), weight: weights[i] * holdWeight }] : []);
    if (carry && holdWeight < 1) {
      const phase = carryCycles % 1; // The four 72-frame walk loops and the run loop share a normalized phase.
      carry.walk.forEach((clip, i) => {
        const weight = weights[i] * (1 - holdWeight) * (1 - runShare);
        if (weight > 0) clips.push({ clip, time: phase * clip.duration, weight });
      });
      const runWeight = (1 - holdWeight) * runShare;
      if (runWeight > 0) clips.push({ clip: carry.run, time: phase * carry.run.duration, weight: runWeight });
    }
    return clips;
  };
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
  // Standing base: the low-ready first frame of 140, crossfaded to the Handgun00M idle while the gun is down.
  const rest = { idleShare: 0, idleTimeS: 0 };
  const restPose = (bone: BonePose) => {
    const ready = sample(raise, 0, bone);
    if (!carry || !rest.idleShare || !carry.idle.tracks.has(bone.name)) return ready;
    return blend(ready, sample(carry.idle, rest.idleTimeS, bone), rest.idleShare);
  };
  const sampleLeg = (bone: BonePose, weight: number, clips: ReturnType<typeof movingSamples>) => {
    if (!weight) return restPose(bone);
    const stride = sampleStride(bone, clips);
    return weight === 1 ? stride : blend(restPose(bone), stride, weight);
  };

  // UpperRotateStateUserData PostureParam "Stand": waist 0.5, stomach 0.5, chest 1, normalized to the three spine joints.
  const PITCH_SHARE = new Map([['Spine_0', 0.25], ['Spine_1', 0.25], ['Spine_2', 0.5]]);
  const sourceBone = (name: string): BonePose => {
    const bone = holdSource.bones.find((item) => item.name === name);
    if (!bone) throw new Error(`里昂源骨架缺少 ${name}`);
    return { ...bone, scale: [1, 1, 1] };
  };
  const torsoChain = ['Hip', 'Spine_0', 'Spine_1'].map(sourceBone);
  const rootRotation = new THREE.Quaternion().fromArray(holdSource.bones[0].rotation);
  const pitchAxis = new THREE.Vector3(1, 0, 0); // Source model faces +Z, so a positive pitch turns about -X.

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
        last.walk.hold === gait.hold && last.walk.run === gait.run && last.walk.carryCycles === gait.carryCycles &&
        last.aim.pitchRad === aimMotion.pitchRad &&
        (!carry || last.clockS === pose.clockS) &&
        (pose.lift !== 1 || (last.aim.idleTimeS === aimMotion.idleTimeS &&
          last.aim.stationaryBlend === aimMotion.stationaryBlend &&
          last.aim.turn === aimMotion.turn && last.aim.turnTimeS === aimMotion.turnTimeS))) return;

    const walkWeight = THREE.MathUtils.smoothstep(gait.blend, 0, 1);
    rest.idleShare = carry ? 1 - pose.lift : 0;
    rest.idleTimeS = carry ? pose.clockS % carry.idle.duration : 0;
    const holdShare = carry ? gait.hold : 1;
    const moveShare = carry ? walkWeight * (1 - gait.hold) : 0;
    const upperWalkWeight = walkWeight * holdShare * THREE.MathUtils.smoothstep(gait.weights[0], 0.85, 1);
    // Keep the stride in the upper body while biasing the coordinated chain toward the hold.
    const aimedWalkWeight = 0.38 * walkWeight * THREE.MathUtils.smoothstep(pose.lift, 0.65, 1);
    const walkingTime = leonWalkTime(gait.cycles, 0, walk.duration);
    const movingClips = movingSamples(gait);
    const aim = pose.lift === 1 ? hold : raise;
    const aimTimeS = aim === hold ? aimMotion.idleTimeS % hold.duration : raise.duration * pose.lift;
    // With a carry-gun base, ease the aim layer in so raising does not snap from the low carry pose.
    const aimWeight = pose.lift > 0 ? (1 - upperWalkWeight * (1 - THREE.MathUtils.smoothstep(pose.lift, 0.4, 1))) *
      (carry ? THREE.MathUtils.smoothstep(pose.lift, 0, 0.35) : 1) : 0;
    const stationary = aim === hold ? THREE.MathUtils.smoothstep(aimMotion.stationaryBlend, 0, 1) : 0;
    const turn = aimMotion.turn > 0 ? turnLeft : turnRight;
    const turnWeight = stationary * Math.abs(aimMotion.turn);
    const turnTimeS = aimMotion.turnTimeS % turn.duration;
    const action = pose.clip === 'fire' ? fire : pose.clip === 'reload' ? reload : undefined;
    const actionTimeS = action ? action.duration * pose.progress : 0;
    const actionWeight = action === reload ? Math.min(1, 10 * pose.progress, 10 * (1 - pose.progress)) : 1;
    const actionMask = action === reload ? reloadMask : holdMask;

    const carryMoving = moveShare > 0 ? movingClips.filter(({ clip }) => carryClips.has(clip)) : [];
    const basePose = (bone: BonePose) => {
      let ready = restPose(bone);
      if (carryMoving.length && carryMoving[0].clip.tracks.has(bone.name)) {
        ready = blend(ready, sampleStride(bone, carryMoving), moveShare);
      }
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
          !aimJointWeight && !actionJointWeight && !aimedWalkJoint && !(carry?.idle.tracks.has(bone.name))) return;
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
    // Upper body follows the camera pitch while the gun is raised, distributed over the spine.
    const pitchWeight = followPitch ? THREE.MathUtils.smoothstep(pose.lift, 0, 1) * aimMotion.pitchRad : 0;
    const resolved = new Map<string, LocalPose | undefined>();
    const parentWorld = new THREE.Quaternion();
    const pitchTurn = new THREE.Quaternion();
    const pitchedRotation = new THREE.Quaternion();
    const finalPose = (bone: BonePose): LocalPose | undefined => {
      if (resolved.has(bone.name)) return resolved.get(bone.name);
      let value = resolvePose(bone);
      const share = PITCH_SHARE.get(bone.name);
      if (value && share && pitchWeight) {
        parentWorld.copy(rootRotation);
        for (const link of torsoChain) {
          if (link.name === bone.name) break;
          parentWorld.multiply(new THREE.Quaternion().fromArray((finalPose(link) ?? link).rotation));
        }
        pitchTurn.setFromAxisAngle(pitchAxis, -pitchWeight * share);
        // local' = parent⁻¹ · turn · parent · local, a rotation about the model-space right axis.
        pitchedRotation.copy(parentWorld).invert().multiply(pitchTurn).multiply(parentWorld)
          .multiply(new THREE.Quaternion().fromArray(value.rotation)).normalize();
        value = { ...value, rotation: pitchedRotation.toArray() };
      }
      resolved.set(bone.name, value);
      return value;
    };
    rig.update(finalPose);
    if (socketBone && hand) {
      const local = finalPose(socketBone) ?? socketBone;
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