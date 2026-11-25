"""Build the original M2 rehearsal rig and its ClipManifest with Python 3."""

import json
import math
from pathlib import Path
import struct


ASSETS = Path(__file__).resolve().parents[2] / "web-3c/public/assets"
GLB = "m2-rehearsal.glb"
IDENTITY = (0, 0, 0, 1)


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def scale(a, factor):
    return tuple(x * factor for x in a)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    x, y, z = a
    i, j, k = b
    return (y * k - z * j, z * i - x * k, x * j - y * i)


def unit(a):
    return scale(a, 1 / math.sqrt(dot(a, a)))


def axis_rotation(axis, degrees):
    angle = math.radians(degrees) / 2
    return (*scale(axis, math.sin(angle)), math.cos(angle))


def multiply(a, b):
    v, w = a[:3], a[3]
    u, s = b[:3], b[3]
    return (*add(add(scale(u, w), scale(v, s)), cross(v, u)), w * s - dot(v, u))


def inverse(q):
    return (*scale(q[:3], -1), q[3])


def rotate(q, vector):
    return multiply(multiply(q, (*vector, 0)), inverse(q))[:3]


def from_down(offset):
    down = (0, -1, 0)
    direction = unit(offset)
    return unit((*cross(down, direction), 1 + dot(down, direction)))


class Rig:
    def __init__(self):
        self.bin = bytearray()
        self.views = []
        self.accessors = []
        self.nodes = []
        self.names = {}
        self.origins = []
        self.joints = []
        self.meshes = []
        self.animations = []

    def node(self, name, parent=None, offset=(0, 0, 0), *, joint=False, **extras):
        index = len(self.nodes)
        self.names[name] = index
        self.nodes.append(dict(name=name, translation=offset, **extras))
        origin = offset
        if parent is not None:
            parent_id = self.names[parent]
            self.nodes[parent_id].setdefault("children", []).append(index)
            origin = add(self.origins[parent_id], offset)
        self.origins.append(origin)
        if joint:
            self.joints.append(index)

    def accessor(self, rows, fmt, component, kind, *, bounds=False, target=None):
        offset = len(self.bin)
        for row in rows:
            self.bin.extend(struct.pack("<" + fmt, *row))
        view = dict(buffer=0, byteOffset=offset, byteLength=len(self.bin) - offset)
        if target:
            view["target"] = target
        self.bin.extend(b"\0" * (-len(self.bin) % 4))
        accessor = dict(bufferView=len(self.views), componentType=component,
                        count=len(rows), type=kind)
        if bounds:
            columns = list(zip(*rows))
            accessor.update(min=list(map(min, columns)), max=list(map(max, columns)))
        self.views.append(view)
        self.accessors.append(accessor)
        return len(self.accessors) - 1

    def mesh(self, name, boxes, *, skinned=False):
        primitives = []
        for material in sorted({box[0] for box in boxes}):
            positions, normals, indices, joints = [], [], [], []
            for color, bone, offset, size in boxes:
                if color != material:
                    continue
                center = add(self.origins[self.names[bone]], offset) if skinned else offset
                for face_positions, normal in box_faces(center, size):
                    start = len(positions)
                    positions.extend(face_positions)
                    normals.extend([normal] * 4)
                    indices.extend((start + i,) for i in (0, 1, 2, 0, 2, 3))
                if skinned:
                    joints.extend([(self.joints.index(self.names[bone]), 0, 0, 0)] * 24)
            attributes = {
                "POSITION": self.accessor(positions, "fff", 5126, "VEC3", bounds=True, target=34962),
                "NORMAL": self.accessor(normals, "fff", 5126, "VEC3", target=34962),
            }
            if skinned:
                attributes["JOINTS_0"] = self.accessor(joints, "BBBB", 5121, "VEC4", target=34962)
                weights = [(1, 0, 0, 0)] * len(positions)
                attributes["WEIGHTS_0"] = self.accessor(weights, "ffff", 5126, "VEC4", target=34962)
            primitives.append(dict(attributes=attributes, material=material,
                                   indices=self.accessor(indices, "H", 5123, "SCALAR", target=34963)))
        self.meshes.append(dict(name=name, primitives=primitives))
        return len(self.meshes) - 1

    def animation(self, name, poses, *, magazine=False):
        channels, samplers = [], []
        times = self.accessor([(time,) for time, _, _ in poses], "f", 5126, "SCALAR", bounds=True)
        paths = [(bone, "rotation") for bone in poses[0][1]]
        if magazine:
            paths.append(("Magazine", "translation"))
        for bone, path in paths:
            rows = [pose[bone] if path == "rotation" else offset for _, pose, offset in poses]
            fmt, kind = ("ffff", "VEC4") if path == "rotation" else ("fff", "VEC3")
            output = self.accessor(rows, fmt, 5126, kind)
            channels.append(dict(sampler=len(samplers), target=dict(node=self.names[bone], path=path)))
            samplers.append(dict(input=times, output=output, interpolation="LINEAR"))
        self.animations.append(dict(name=name, channels=channels, samplers=samplers))

    def write(self, path):
        inverses = [(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1)
                    for x, y, z in (self.origins[i] for i in self.joints)]
        inverse_matrices = self.accessor(inverses, "f" * 16, 5126, "MAT4")
        colors = (
            ("Teal shell", (0.08, 0.42, 0.35)), ("Graphite joints", (0.07, 0.10, 0.12)),
            ("Ivory plates", (0.72, 0.69, 0.57)), ("Amber prop", (0.89, 0.39, 0.08)),
        )
        gltf = {
            "asset": {"version": "2.0", "generator": "RE_Research build_m2_assets.py",
                      "extras": {"provenance": "Original procedural rehearsal rig, prop and motion."}},
            "scene": 0,
            "scenes": [{"nodes": [self.names["RigRoot"], self.names["Body"]]}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "skins": [{"joints": self.joints, "skeleton": self.names["RigRoot"],
                       "inverseBindMatrices": inverse_matrices}],
            "materials": [{"name": name, "pbrMetallicRoughness": {
                "baseColorFactor": [*color, 1], "roughnessFactor": 0.7, "metallicFactor": 0.05,
            }} for name, color in colors],
            "animations": self.animations,
            "accessors": self.accessors,
            "bufferViews": self.views,
            "buffers": [{"byteLength": len(self.bin)}],
        }
        encoded = json.dumps(gltf, separators=(",", ":"), allow_nan=False).encode("utf-8")
        encoded += b" " * (-len(encoded) % 4)
        header = struct.pack("<4sII", b"glTF", 2, 28 + len(encoded) + len(self.bin))
        path.write_bytes(header + struct.pack("<I4s", len(encoded), b"JSON") + encoded
                         + struct.pack("<I4s", len(self.bin), b"BIN\0") + self.bin)


def box_faces(center, size):
    axes = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    for i, axis in enumerate(axes):
        j, k = (i + 1) % 3, (i + 2) % 3
        for side in (-1, 1):
            face = add(center, scale(axis, side * size[i] / 2))
            u = scale(axes[j], size[j] / 2)
            v = scale(axes[k], side * size[k] / 2)
            corners = (sub(sub(face, u), v), sub(add(face, u), v),
                       add(add(face, u), v), add(sub(face, u), v))
            yield corners, scale(axis, side)


ARM_LENGTH = 0.31
FOREARM_LENGTH = 0.28
SOCKET = (0, -0.043, 0.046)
WELL = (0, -0.085, 0.010)
SUPPORT = (0, -0.025, 0.018)
ZERO = (0, 0, 0)
X_AXIS = (1, 0, 0)
Y_AXIS = (0, 1, 0)


def make_rig():
    rig = Rig()
    rig.node("RigRoot", joint=True)
    rig.node("Hips", "RigRoot", (0, 0.93, 0), joint=True)
    rig.node("Chest", "Hips", (0, 0.36, 0), joint=True)
    rig.node("Head", "Chest", (0, 0.34, 0), joint=True)
    rig.node("Facing", "Head", (0, 0.07, 0.13))
    for side, x, shoulder_z in (("R", -1, 0), ("L", 1, 0.065)):
        rig.node(f"{side}_UpperArm", "Chest", (0.265 * x, 0.19, shoulder_z), joint=True)
        rig.node(f"{side}_Forearm", f"{side}_UpperArm", (0, -ARM_LENGTH, 0), joint=True)
        rig.node(f"{side}_Hand", f"{side}_Forearm", (0, -FOREARM_LENGTH, 0), joint=True)
        rig.node(f"{side}_Thigh", "Hips", (0.125 * x, -0.04, 0), joint=True)
        rig.node(f"{side}_Shin", f"{side}_Thigh", (0, -0.40, 0), joint=True)
        rig.node(f"{side}_Foot", f"{side}_Shin", (0, -0.41, 0), joint=True)
    rig.node("R_Wep", "R_Hand", SOCKET, joint=True)
    rig.node("SupportGrip", "R_Wep", SUPPORT)
    rig.node("MagazineWell", "R_Wep", WELL)
    rig.node("Magazine", "MagazineWell", mesh=rig.mesh("Training magazine", [
        (2, None, (0, -0.03, 0), (0.066, 0.092, 0.052)),
    ]))
    rig.node("TrainingProp", "R_Wep", mesh=rig.mesh("Training prop", [
        (3, None, (0, 0, 0.055), (0.095, 0.075, 0.25)),
        (1, None, (0, -0.044, 0.005), (0.08, 0.083, 0.072)),
        (2, None, (0, 0.039, 0.14), (0.061, 0.014, 0.061)),
    ]))
    body = [
        (1, "Hips", ZERO, (0.36, 0.20, 0.22)),
        (1, "Hips", (0, 0.15, 0), (0.22, 0.25, 0.15)),
        (0, "Chest", (0, 0.045, 0), (0.43, 0.42, 0.24)),
        (2, "Chest", (0, 0.075, 0.124), (0.23, 0.19, 0.033)),
        (1, "Chest", (0, 0.275, 0), (0.12, 0.14, 0.12)),
        (2, "Head", (0, 0.075, 0), (0.235, 0.23, 0.21)),
        (1, "Head", (0, 0.09, 0.109), (0.18, 0.067, 0.033)),
    ]
    for side in ("R", "L"):
        body.extend([
            (0, f"{side}_UpperArm", (0, -0.132, 0), (0.143, 0.299, 0.155)),
            (2, f"{side}_Forearm", (0, -0.139, 0), (0.119, 0.269, 0.13)),
            (1, f"{side}_Hand", (0, -0.023, 0.016), (0.10, 0.083, 0.098)),
            (0, f"{side}_Thigh", (0, -0.172, 0), (0.177, 0.382, 0.181)),
            (1, f"{side}_Shin", (0, -0.196, 0), (0.139, 0.378, 0.15)),
            (2, f"{side}_Foot", (0, -0.04, 0.068), (0.162, 0.08, 0.264)),
        ])
    rig.node("Body", mesh=rig.mesh("Rehearsal mannequin", body, skinned=True), skin=0)
    return rig


def arms(rig, *, yaw, shoulder, elbow, pitch, target):
    upper = multiply(axis_rotation(Y_AXIS, yaw), axis_rotation(X_AXIS, shoulder))
    lower = axis_rotation(X_AXIS, elbow)
    fore = multiply(upper, lower)
    weapon = axis_rotation(X_AXIS, pitch)
    wrist = add(rig.origins[rig.names["R_UpperArm"]],
                add(rotate(upper, (0, -ARM_LENGTH, 0)), rotate(fore, (0, -FOREARM_LENGTH, 0))))
    socket = add(wrist, rotate(weapon, SOCKET))
    left_hand = add(socket, rotate(weapon, target))

    left_shoulder = rig.origins[rig.names["L_UpperArm"]]
    reach = sub(left_hand, left_shoulder)
    distance = math.sqrt(dot(reach, reach))
    direction = unit(reach)
    along = (ARM_LENGTH ** 2 - FOREARM_LENGTH ** 2 + distance ** 2) / (2 * distance)
    if not 0 < along < ARM_LENGTH or not abs(ARM_LENGTH - FOREARM_LENGTH) < distance < ARM_LENGTH + FOREARM_LENGTH:
        raise ValueError(f"Left hand target is outside arm reach: {left_hand}")
    pole = (0.75, -1, 0)
    bend = unit(sub(pole, scale(direction, dot(pole, direction))))
    left_upper = add(scale(direction, along), scale(bend, math.sqrt(ARM_LENGTH ** 2 - along ** 2)))
    left_base = from_down(left_upper)
    left_fore = from_down(sub(reach, left_upper))
    return {
        "R_UpperArm": upper, "R_Forearm": lower, "R_Hand": multiply(inverse(fore), weapon),
        "L_UpperArm": left_base, "L_Forearm": multiply(inverse(left_base), left_fore),
        "L_Hand": multiply(inverse(left_fore), weapon),
    }


def build():
    rig = make_rig()
    hold = arms(rig, yaw=37, shoulder=-13, elbow=-76, pitch=18, target=SUPPORT)
    lift = arms(rig, yaw=32, shoulder=-29, elbow=-75, pitch=8, target=SUPPORT)
    aim = arms(rig, yaw=32, shoulder=-45, elbow=-70, pitch=0, target=SUPPORT)
    recoil = arms(rig, yaw=32, shoulder=-43, elbow=-76, pitch=-13, target=SUPPORT)
    drop = arms(rig, yaw=32, shoulder=-21, elbow=-97, pitch=21, target=(0.18, -0.26, -0.11))
    contact = arms(rig, yaw=32, shoulder=-24, elbow=-94, pitch=16, target=WELL)
    recover = arms(rig, yaw=30, shoulder=-33, elbow=-82, pitch=6, target=(0.08, -0.075, 0))
    # Original authored absolute samples. The loader converts Fire against Raise at 0.44 s.
    motions = [
        ("hold-idle", "HoldIdle", "normal", [(0, hold, ZERO), (0.8, hold, ZERO)]),
        ("raise", "Raise", "normal", [(0, hold, ZERO), (0.22, lift, ZERO), (0.44, aim, ZERO)]),
        ("fire", "Fire", "additive", [(0, aim, ZERO), (0.06, recoil, ZERO), (0.24, aim, ZERO)]),
        ("reload", "Reload", "baked", [
            (0, aim, ZERO), (0.30, drop, (0, -0.15, 0.035)), (0.72, contact, ZERO),
            (1.06, recover, ZERO), (1.4, aim, ZERO),
        ]),
    ]
    clips = []
    for clip_id, track, blend, frames in motions:
        # The baked reload includes stable lower-body channels and the magazine motion.
        if blend == "baked":
            legs = {rig.nodes[i]["name"]: IDENTITY for i in rig.joints
                    if rig.nodes[i]["name"].endswith(("_Thigh", "_Shin", "_Foot"))}
            frames = [(time, pose | legs, offset) for time, pose, offset in frames]
        rig.animation(track, frames, magazine=blend == "baked")
        clip = dict(id=clip_id, glb=GLB, track=track, durationS=frames[-1][0], blend=blend)
        if blend == "additive":
            clip["referencePose"] = dict(glb=GLB, track="Raise", timeS=0.44)
            clip["boneMask"] = list(aim)
        clips.append(clip)
    ASSETS.mkdir(parents=True, exist_ok=True)
    rig.write(ASSETS / GLB)
    (ASSETS / "clips.json").write_text(json.dumps(dict(version=1, clips=clips), indent=2) + "\n",
                                      encoding="utf-8", newline="\n")


if __name__ == "__main__":
    build()
