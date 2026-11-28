import * as THREE from 'three';
import type { ActionPose, WalkPose } from './actions.ts';
import { plantToe, toePosition } from './leon-foot-plant.ts';
import type { LocalPose } from './leon-foot-plant.ts';
import {
  LEON_END_CLIPS, LEON_MOVE_RUN, LEON_MOVE_WALK, LEON_RAISE_CLIPS, LEON_START_CLIPS, LEON_WALK, leonWalkTime, raiseWeights,
} from './leon-locomotion.ts';
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
  /** Distribute the committed camera pitch (and the yaw lag) over the spine while the gun is raised. */
  readonly upperBodyPitch?: boolean;
  /**
   * FeelConfig v6 source layers: carry starts, stops and in-place turns, angled raises, 1040 HoldStartShoot,
   * 161 Hold_End, the 2100/1200 torso additive during reload and the wp0100 weapon clips. Source-pose
   * regression tests turn them off to compare against the earlier layer stack.
   */
  readonly sourceLayers?: boolean;
}

type ClipIndex = Readonly<{ duration: number; tracks: Map<string, Motion['tracks'][number]> }>;

/** Cumulative horizontal root travel by key time, for distance-matched playback of start and stop clips. */
function rootCurve(motion: Motion, measure: 'distance' | 'yaw') {
  const rootIndex = motion.bones.findIndex(({ name }) => name === 'root');
  const track = motion.tracks.find(({ bone }) => bone === rootIndex);
  const channel = measure === 'distance' ? track?.position : track?.rotation;
  if (!channel || channel.values.length < 2) return { times: [0, motion.duration], values: [0, 0] };
  const values = [0];
  for (let i = 1; i < channel.values.length; i += 1) {
    const a = channel.values[i - 1];
    const b = channel.values[i];
    if (measure === 'distance') values.push(values[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
    else {
      const yaw = (q: Values) => 2 * Math.atan2(q[1], q[3]);
      const step = yaw(b) - yaw(a);
      values.push(values[i - 1] + Math.abs(Math.atan2(Math.sin(step), Math.cos(step))));
    }
  }
  return { times: [...channel.times], values };
}

/** Time at which the cumulative curve first reaches a value (linear between keys). */
function timeAt(curve: ReturnType<typeof rootCurve>, value: number) {
  const { times, values } = curve;
  if (value <= 0) return 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < value) continue;
    const span = values[i] - values[i - 1];
    return times[i - 1] + (span > 0 ? (value - values[i - 1]) / span : 0) * (times[i] - times[i - 1]);
  }
  return times[times.length - 1];
}

export function createLeonView(assets: LeonAssets, weaponModel?: THREE.Object3D, options: LeonViewOptions = {}) {
  const followPitch = options.upperBodyPitch ?? true;
  const v6 = options.sourceLayers ?? true;
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
  // v6 source layers. Each falls back to the earlier behaviour when its clips are missing.
  const extra = (bank: number, id: number) => {
    const motion = v6 ? findExtra(bank, id) ?? (bank === 100 ? MOTION_DATA.clips.find((c) => c.bank === 100 && c.id === id) : undefined) : undefined;
    return motion && { motion, clip: index(motion) };
  };
  const transitionSet = (ids: readonly (readonly number[])[]) => {
    const set = ids.map((row) => row.map((id) => extra(200, id)));
    return set.every((row) => row.every(Boolean)) ? set.map((row) => row.map((item) => ({
      ...item!.clip, curve: rootCurve(item!.motion, 'distance'),
    }))) : undefined;
  };
  const starts = carry ? transitionSet(LEON_START_CLIPS) : undefined;
  const stops = carry ? transitionSet(LEON_END_CLIPS) : undefined;
  const turnClips = new Map([310, 311, 314, 315].flatMap((id) => {
    const item = carry && extra(200, id);
    return item ? [[id, { ...item.clip, curve: rootCurve(item.motion, 'yaw') }] as const] : [];
  }));
  const raiseSet = LEON_RAISE_CLIPS.map(({ id }) => extra(100, id)?.clip);
  const angledRaise = raiseSet.every(Boolean) ? raiseSet as ClipIndex[] : undefined;
  const holdStart = extra(100, 1040)?.clip;
  const holdEnd = extra(100, 161)?.clip;
  const reloadAdd = v6 ? MOTION_DATA.clips.find((c) => c.bank === 2100 && c.id === 1200) : undefined;
  const reloadAddClip = reloadAdd && index(reloadAdd);
  const weaponFire = extra(9100, 1100);
  const weaponReload = extra(9100, 1200);
  const mask = (id: number) => {
    const source = MASK_DATA.find((value) => value.ID === id);
    if (!source) throw new Error(`缺少里昂动作遮罩 ${id}`);
    return new Map(source.Joints.map(({ Name, Weight }) => [Name, Weight]));
  };
  const holdMask = mask(4);
  const reloadMask = mask(2);
  // Mask 11: Hip 0.3, spine, neck and head 0.5 — the PreAdd torso layer used with the reload.
  const torsoAddMask = MASK_DATA.some((value) => value.ID === 11) ? mask(11) : new Map<string, number>();
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
        (!carry || last.clockS === pose.clockS) && !gait.transition && !gait.turn && pose.lowerS < 0 &&
        last.aim.yawTwistRad === aimMotion.yawTwistRad &&
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
    const holdClip = pose.holdStartShoot && pose.clip === 'fire' && holdStart ? holdStart : hold;
    const aim = pose.lift === 1 ? holdClip : raise;
    const aimTimeS = aim === holdClip ? aimMotion.idleTimeS % holdClip.duration : raise.duration * pose.lift;
    const raiseMix = aim === raise && angledRaise ? raiseWeights(pose.raiseTurnRad) : undefined;
    const aimBase = (bone: BonePose): LocalPose => {
      if (!raiseMix) return sample(aim, aimTimeS, bone);
      let value: LocalPose | undefined;
      let total = 0;
      raiseMix.forEach((weight, i) => {
        if (!weight) return;
        const next = sample(angledRaise![i], angledRaise![i].duration * pose.lift, bone);
        total += weight;
        value = value ? blend(value, next, weight / total) : next;
      });
      return value!;
    };
    // With a carry-gun base, ease the aim layer in so raising does not snap from the low carry pose.
    const aimWeight = pose.lift > 0 ? (1 - upperWalkWeight * (1 - THREE.MathUtils.smoothstep(pose.lift, 0.4, 1))) *
      (carry ? THREE.MathUtils.smoothstep(pose.lift, 0, 0.35) : 1) : 0;
    const stationary = aim === holdClip ? THREE.MathUtils.smoothstep(aimMotion.stationaryBlend, 0, 1) : 0;
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
      const base = aimBase(bone);
      return turnWeight ? blend(base, sample(turn, turnTimeS, bone), turnWeight) : base;
    };
    const inverseHip = new THREE.Quaternion().fromArray(hipPose.rotation).invert();
    const keepReadyTorso = inverseHip.clone().multiply(new THREE.Quaternion().fromArray(hipBase.rotation));
    const referenceHip = inverseHip.clone().multiply(new THREE.Quaternion().fromArray(aimBase(hip).rotation));
    const aimingHip = turnWeight ? inverseHip.clone().multiply(new THREE.Quaternion().fromArray(aimSample(hip).rotation)) : referenceHip;
    const spineRotation = new THREE.Quaternion();
    const stabilize = (name: string, value: LocalPose, compensation: THREE.Quaternion): LocalPose => name === 'Spine_0' ? {
      ...value, rotation: spineRotation.fromArray(value.rotation).premultiply(compensation).normalize().toArray(),
    } : value;
    const fireRotation = new THREE.Quaternion();
    const fireDelta = new THREE.Quaternion();

    // Carry start, stop and in-place turn: full-body clips under the aim layers, root ignored (Rapier moves the body).
    const carryShare = 1 - holdShare;
    const overlays: { clip: ClipIndex; time: number; weight: number }[] = [];
    const transition = gait.transition;
    if (transition && carryShare > 0) {
      const set = transition.kind === 'start' ? starts : stops;
      const item = set?.[transition.leg][transition.dir];
      if (item) {
        const end = item.curve.values[item.curve.values.length - 1];
        if (transition.kind === 'start') {
          const time = timeAt(item.curve, Math.min(end, transition.distanceM));
          const weight = Math.min(1, transition.elapsedS / 0.1) * (1 - THREE.MathUtils.smoothstep(transition.distanceM, 0.75 * end, end));
          overlays.push({ clip: item, time, weight });
        } else {
          const time = Math.min(item.duration, timeAt(item.curve, Math.max(0, Math.min(end, end - transition.remainM + transition.distanceM))) + transition.stillS);
          const weight = Math.min(1, transition.elapsedS / 0.15) * (1 - THREE.MathUtils.smoothstep(time, item.duration - 0.6, item.duration));
          overlays.push({ clip: item, time, weight });
        }
      }
    }
    const turnState = gait.turn;
    const turnItem = turnState && turnClips.get(turnState.clip);
    if (turnState && turnItem && carryShare > 0) {
      const end = turnItem.curve.values[turnItem.curve.values.length - 1];
      const fraction = Math.abs(turnState.totalRad) > 0 ? turnState.doneRad / Math.abs(turnState.totalRad) : 1;
      const time = Math.min(turnItem.duration, Math.max(timeAt(turnItem.curve, fraction * end), turnState.elapsedS));
      const weight = Math.min(1, turnState.elapsedS / 0.15) * (1 - THREE.MathUtils.smoothstep(time, turnItem.duration - 0.6, turnItem.duration));
      overlays.push({ clip: turnItem, time, weight });
    }
    // 161 Hold_End replaces the reversed raise while lowering and settles into the carry stance.
    const lowerWeight = holdEnd && pose.lowerS >= 0 && pose.clip !== 'raise' && pose.lowerS < holdEnd.duration
      ? 1 - THREE.MathUtils.smoothstep(pose.lowerS, holdEnd.duration - 0.6, holdEnd.duration) : 0;
    const lowerHip = lowerWeight ? inverseHip.clone().multiply(new THREE.Quaternion().fromArray(sample(holdEnd!, pose.lowerS, hip).rotation)) : undefined;
    const torsoAdd = action === reload && reloadAddClip ? reloadAddClip : undefined;

    const resolvePose = (bone: BonePose) => {
      if (bone.name === 'root') return;
      const aimJointWeight = aimWeight * (holdMask.get(bone.name) ?? 0);
      const actionJointWeight = action ? actionWeight * (actionMask.get(bone.name) ?? 0) : 0;
      const aimedWalkJoint = aimedWalkWeight > 0 && !lowerBody(bone.name) &&
        movingClips.some(({ clip }) => clip.tracks.has(bone.name));
      if (!raise.tracks.has(bone.name) && !(walkWeight && (walk.tracks.has(bone.name) || lowerBody(bone.name))) &&
          !aimJointWeight && !actionJointWeight && !aimedWalkJoint && !(carry?.idle.tracks.has(bone.name))) return;
      let value = bone.name === 'Hip' ? hipPose : locomotion(bone);
      for (const { clip, time, weight } of overlays) {
        if (weight > 0 && clip.tracks.has(bone.name)) value = blend(value, sample(clip, time, bone), weight * carryShare);
      }
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
      const lowerJointWeight = lowerWeight * (holdMask.get(bone.name) ?? 0);
      if (lowerJointWeight > 0 && holdEnd!.tracks.has(bone.name)) {
        value = blend(value, stabilize(bone.name, sample(holdEnd!, pose.lowerS, bone), lowerHip!), lowerJointWeight);
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
      const torsoWeight = torsoAdd ? actionWeight * (torsoAddMask.get(bone.name) ?? 0) : 0;
      const addTrack = torsoWeight > 0 && torsoAdd!.tracks.get(bone.name);
      if (addTrack) {
        // 2100/1200 is a true additive (identity at frame 0): local rotation delta on the current pose.
        const delta = MotionMath.sample(addTrack.rotation, actionTimeS, [0, 0, 0, 1], true);
        const target = { ...value, rotation: fireRotation.fromArray(value.rotation).multiply(fireDelta.fromArray(delta)).normalize().toArray() };
        value = blend(value, target, torsoWeight);
      }
      return value;
    };
    // Upper body follows the camera pitch while the gun is raised, distributed over the spine.
    const liftShare = THREE.MathUtils.smoothstep(pose.lift, 0, 1);
    const pitchWeight = followPitch ? liftShare * aimMotion.pitchRad : 0;
    const yawWeight = followPitch && v6 ? liftShare * aimMotion.yawTwistRad : 0;
    const yawTurn = new THREE.Quaternion();
    const twistedAxis = new THREE.Vector3();
    const resolved = new Map<string, LocalPose | undefined>();
    const parentWorld = new THREE.Quaternion();
    const pitchTurn = new THREE.Quaternion();
    const pitchedRotation = new THREE.Quaternion();
    const finalPose = (bone: BonePose): LocalPose | undefined => {
      if (resolved.has(bone.name)) return resolved.get(bone.name);
      let value = resolvePose(bone);
      const share = PITCH_SHARE.get(bone.name);
      if (value && share && (pitchWeight || yawWeight)) {
        parentWorld.copy(rootRotation);
        let yawSoFar = 0;
        for (const link of torsoChain) {
          if (link.name === bone.name) break;
          parentWorld.multiply(new THREE.Quaternion().fromArray((finalPose(link) ?? link).rotation));
          yawSoFar += yawWeight * (PITCH_SHARE.get(link.name) ?? 0);
        }
        // Yaw lag about model up (positive = left), then pitch about the right axis twisted by the yaw so far.
        yawTurn.setFromAxisAngle(up, yawWeight * share);
        twistedAxis.copy(pitchAxis).applyAxisAngle(up, yawSoFar + yawWeight * share);
        pitchTurn.setFromAxisAngle(twistedAxis, -pitchWeight * share).multiply(yawTurn);
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
    if (weapon) {
      const weaponClip = pose.clip === 'fire' ? weaponFire?.clip : pose.clip === 'reload' ? weaponReload?.clip : undefined;
      weapon.pose(weaponClip ? (name, bind) => {
        const track = weaponClip.tracks.get(name);
        return track && {
          position: MotionMath.sample(track.position, actionTimeS, bind.position),
          rotation: MotionMath.sample(track.rotation, actionTimeS, bind.rotation, true),
        };
      } : undefined);
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