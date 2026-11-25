import { AnimationMixer, Group } from 'three';
import type { AnimationAction, AnimationClip } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { ActionPose } from './actions.ts';
import type { LoadedClip } from './clip-assets.ts';

interface ClipSample {
  readonly clip: AnimationClip;
  readonly timeS: number;
  readonly weight: number;
}

export function createActionView(clips: ReadonlyMap<string, LoadedClip>) {
  const hold = clips.get('hold-idle');
  const raise = clips.get('raise');
  const fire = clips.get('fire');
  const reload = clips.get('reload');
  const lower = clips.get('lower');
  if (!hold || !raise || !fire || !reload) return undefined;

  const model = clone(hold.scene);
  model.rotation.y = Math.PI; // The M2 GLB faces +Z. The simulated character faces -Z.
  const root = new Group();
  root.add(model);
  const mixer = new AnimationMixer(model);
  const legs = ['R_Thigh', 'R_Shin', 'L_Thigh', 'L_Shin'].map((name) => {
    const node = model.getObjectByName(name);
    return { node, base: node?.quaternion.clone() };
  });
  let playing = new Set<AnimationAction>();
  let lastPose: ActionPose | undefined;

  const draw = (pose: ActionPose) => {
    if (pose === lastPose) return;
    lastPose = pose;

    let base: ClipSample = pose.lift === 0 ? { clip: hold.animation, timeS: 0, weight: 1 } :
      { clip: raise.animation, timeS: raise.animation.duration * pose.lift, weight: 1 };
    if (pose.clip === 'lower' && lower) {
      base = { clip: lower.animation, timeS: lower.animation.duration * (1 - pose.lift), weight: 1 };
    }

    const samples: ClipSample[] = [];
    let gaitWeight = pose.gaitWeight;
    if (pose.clip === 'fire') {
      if (fire.reference) samples.push({ clip: fire.reference.animation, timeS: fire.reference.timeS, weight: 1 });
      samples.push({ clip: fire.animation, timeS: fire.animation.duration * pose.progress, weight: 1 });
      if (fire.entry.blend === 'baked') gaitWeight = 0;
    } else if (pose.clip === 'reload') {
      const timeS = reload.animation.duration * pose.progress;
      const weight = pose.lift === 1 ? 1 : Math.min(1, timeS / 0.12, (reload.animation.duration - timeS) / 0.12);
      if (weight < 1) samples.push({ ...base, weight: 1 - weight });
      samples.push({ clip: reload.animation, timeS, weight });
      if (reload.entry.blend === 'baked') gaitWeight *= 1 - weight;
    } else {
      samples.push(base);
    }

    for (const { node, base } of legs) if (node && base) node.quaternion.copy(base);
    const next = new Set(samples.map(({ clip }) => mixer.clipAction(clip)));
    for (const action of playing) if (!next.has(action)) action.stop();
    for (const { clip, timeS, weight } of samples) {
      const action = mixer.clipAction(clip).play();
      action.paused = true;
      action.time = timeS;
      action.setEffectiveWeight(weight);
    }
    mixer.update(0);
    playing = next;
    for (const { node, base } of legs) if (node && base) base.copy(node.quaternion);

    // Placeholder locomotion advances with collision-corrected distance, independently of the arm layer.
    const swing = Math.sin(pose.gaitPhaseRad) * gaitWeight;
    legs[0].node?.rotateX(0.30 * swing);
    legs[1].node?.rotateX(0.34 * Math.max(0, -swing));
    legs[2].node?.rotateX(-0.30 * swing);
    legs[3].node?.rotateX(0.34 * Math.max(0, swing));
  };

  return { root, draw };
}
