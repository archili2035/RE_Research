// Extracts the standing Normal/Hold TPS camera parameters from the parsed RE9 camera user files into
// web-3c/src/camera-source.json, the data behind the "source" camera profile. Run: node scripts/web-3c/extract_camera_source.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const base = new URL('../../reports/3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/', import.meta.url);
function load(file) {
  const json = JSON.parse(readFileSync(new URL(file, base), 'utf8'));
  const byIndex = new Map(json.Instances.map((item) => [item.Index, item]));
  const resolve = (value, depth = 0) => {
    if (value && typeof value === 'object' && 'Ref' in value) {
      const item = byIndex.get(value.Ref);
      if (!item || depth > 8) return null;
      return Object.fromEntries(Object.entries(item.Fields ?? {}).map(([key, field]) => [key, resolve(field, depth + 1)]));
    }
    if (Array.isArray(value)) return value.map((v) => resolve(v, depth + 1));
    return value;
  };
  return resolve({ Ref: json.Objects[0].Index });
}
const vec = (text) => text.replace(/[<>]/g, '').split(',').map(Number);
const curve = (c) => c.Keys.map((key) => key.split(':').map(Number));
const damping = (d) => [d._DampingTime, d._DampingRate];
const range = (text) => text.replace(/Range\(|\)/g, '').split(',').map(Number);
const state = (s) => ({ type: s._StateType, damping: damping(s._StateDamping), timerS: s._StateTimer,
  curve: s._StateCurve._AnimationCurve.Keys.length ? curve(s._StateCurve._AnimationCurve) : null });

function action(name) {
  const root = load(name + '.user.3.json');
  const position = load(`position/${name}.user.3.json`)._Param;
  const fov = load(`fov/tps_${name === 'normal' ? 'default' : 'hold'}.user.3.json`)._Param;
  const collision = load(`collision/tps_${name}.user.3.json`)._Param;
  const preliminary = collision._PreliminaryCollision;
  return {
    offset: vec(position._Offset), gazeDistanceM: position._GazeDistance,
    zMoveByPitch: curve(position._ZMoveXCurve), yMoveByPitch: curve(position._YMoveXCurve),
    gazeScaleByPitch: curve(position._GazeDistanceXCurve),
    followOffset: damping(position._FollowOffset), followGaze: damping(position._FollowGazeDistance),
    fov: {
      deg: fov._FOVOverride, templateType: fov._FOVTemplateType, nearClipM: fov._NearClip,
      avoid: fov._IsAvoidFieldOfView, avoidDeg: fov._AvoidFieldOfView, avoidSpeed: damping(fov._AvoidFieldOfViewSpeed),
      avoidNear: fov._IsAvoidNearClip, avoidNearM: fov._AvoidNearClip, avoidNearSpeed: damping(fov._AvoidNearClipSpeed),
    },
    collision: {
      originByPitch: ['x', 'y', 'z'].map((axis) => curve(collision._AvoidOffsetCurve[axis])),
      radiusM: collision._Collision._CollisionRadius, avoidSpeed: damping(collision._Collision._AvoidSpeedDamping),
      returnSpeed: damping(collision._Collision._ReturnSpeedDamping),
      preliminary: collision._IsPreliminary ? { radiusM: preliminary._CollisionRadius,
        avoidSpeed: damping(preliminary._AvoidSpeedDamping), returnSpeed: damping(preliminary._ReturnSpeedDamping) } : null,
      startLengthM: collision._CollisionStartPositionLength,
    },
    input: state(root._TransitionParam._Input),
    overrides: (root._OverrideParam ?? []).map((item) => ({ state: item._State, offset: item._Data?._PositionParam?._Offset ?? null })),
  };
}

const rotation = load('rotation/tps_default.user.3.json')._Param;
const [pitchStart, pitchLength] = range(rotation._PitchRangeDeg);
const out = {
  version: 1,
  source: 'reports/3c/camera/parsed/stm/gameassets/camera/userdata/playertpscamera/common/action/',
  note: 'Static values. Pitch curves are keyed by RE camera pitch in degrees; damping pairs are [time, rate].',
  pitchRangeDeg: [pitchStart, pitchStart + pitchLength],
  syncJoint: rotation._SyncJointName,
  normal: action('normal'), hold: action('hold'),
};
writeFileSync(new URL('../../web-3c/src/camera-source.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('overrides', JSON.stringify(out.hold.overrides.map((o) => o.state)));
