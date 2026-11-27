"""Export the local Handgun00H bind-pose mesh for the Web 3C preview."""

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import struct
import sys
import types

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "runtime/web-3c-wp0111.tmp/source/re9/natives/stm/character/wp/wp01/0100/00/wp0100_00.mesh.250925211"
OUTPUT = ROOT / "runtime/web-3c-weapon.tmp/wp0100.glb"
LOD = 3
EXCLUDED = {"Bullet", "EmptyCartridge", "Magazine_empty", "Magazine_onlyone"}
MARKERS = ("C_Attach_Hand_A", "vfx_muzzle1")


def read_mesh(path, plugin):
    package = types.ModuleType("m2_re_mesh_editor")
    package.__path__ = [str(plugin)]
    sys.modules[package.__name__] = package
    reader = importlib.import_module(package.__name__ + ".modules.mesh.file_re_mesh")
    parser = importlib.import_module(package.__name__ + ".modules.mesh.re_mesh_parse")
    mesh = parser.ParsedREMesh()
    mesh.ParseREMesh(reader.readREMesh(str(path)), {
        "importAllLOD": True, "importShadowMesh": False,
        "importOcclusionMesh": False, "importBlendShapes": False,
    })
    return mesh


def export(mesh, path, source):
    blob = bytearray()
    views, accessors, primitives, counts = [], [], [], []

    def accessor(values, kind, target, component, bounds=False):
        data = values.tobytes()
        index = len(views)
        views.append(dict(buffer=0, byteOffset=len(blob), byteLength=len(data), target=target))
        blob.extend(data)
        blob.extend(b"\0" * (-len(blob) % 4))
        item = dict(bufferView=index, componentType=component, count=len(values), type=kind)
        if bounds:
            item.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
        accessors.append(item)
        return index

    materials = [dict(name=name, pbrMetallicRoughness=dict(
        baseColorFactor=[shade, shade, shade, 1], metallicFactor=0.22, roughnessFactor=0.64,
    )) for name, shade in zip(mesh.materialNameList, (0.26, 0.18, 0.33, 0.33, 0.48), strict=True)]
    for group in mesh.mainMeshLODList[LOD].visconGroupList:
        for part in group.subMeshList:
            weighted = {mesh.skeleton.weightedBones[int(joint)] for indices, weights
                        in zip(part.weightIndicesList, part.weightList, strict=True)
                        for joint, weight in zip(indices, weights, strict=True) if weight > 0}
            if weighted and weighted <= EXCLUDED:
                continue
            if weighted & EXCLUDED:
                raise ValueError("Mixed magazine variants in one primitive")
            positions = np.asarray(part.vertexPosList, dtype="<f4")
            normals = np.asarray(part.normalList, dtype="<f4")
            indices = np.asarray(part.faceList).reshape(-1)
            if not len(positions) or len(normals) != len(positions) or not len(indices):
                raise ValueError("Incomplete wp0100 LOD")
            if indices.min() < 0 or indices.max() >= len(positions):
                raise ValueError("wp0100 face outside its vertex buffer")
            lengths = np.linalg.norm(normals, axis=1)
            if not np.isfinite(positions).all() or not np.isfinite(lengths).all() or np.any(lengths == 0):
                raise ValueError("Invalid wp0100 vertex data")
            normals /= lengths[:, None]
            index_values = indices.astype("<u2" if indices.max() < 65536 else "<u4")
            primitives.append(dict(attributes={
                "POSITION": accessor(positions, "VEC3", 34962, 5126, bounds=True),
                "NORMAL": accessor(normals, "VEC3", 34962, 5126),
            }, indices=accessor(index_values, "SCALAR", 34963, 5123 if index_values.itemsize == 2 else 5125),
                material=part.materialIndex))
            counts.append(dict(vertices=len(positions), triangles=len(indices) // 3, bones=sorted(weighted)))
    bones = {bone.boneName: bone for bone in mesh.skeleton.boneList}
    markers = {name: [value for row in bones[name].worldMatrix.matrix for value in row] for name in MARKERS}
    # RE's row-vector matrices flatten to the glTF column-vector storage order.
    nodes = [dict(name="wp0100-static", mesh=0)] + [dict(name=name, matrix=data) for name, data in markers.items()]
    meta = {
        "source": source.name, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "lod": LOD, "meshes": counts, "markers": markers,
    }
    gltf = dict(asset=dict(version="2.0", generator="RE_Research export_m2_weapon.py", extras=meta),
                scene=0, scenes=[dict(nodes=list(range(len(nodes))))], nodes=nodes,
                meshes=[dict(primitives=primitives)], materials=materials, accessors=accessors,
                bufferViews=views, buffers=[dict(byteLength=len(blob))])
    encoded = json.dumps(gltf, separators=(",", ":"), allow_nan=False).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (struct.pack("<4sIII4s", b"glTF", 2, 28 + len(encoded) + len(blob), len(encoded), b"JSON")
               + encoded + struct.pack("<I4s", len(blob), b"BIN\0") + blob)
    staging = path.with_suffix(".glb.tmp")
    staging.write_bytes(payload)
    staging.replace(path)
    meta["glbSha256"] = hashlib.sha256(payload).hexdigest()
    path.with_suffix(".json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"{path}: {sum(x['vertices'] for x in counts)} vertices, {sum(x['triangles'] for x in counts)} triangles")


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--mesh", type=Path, default=SOURCE)
    args.add_argument("--output", type=Path, default=OUTPUT)
    args.add_argument("--plugin", type=Path, default=os.environ.get("RE_MESH_EDITOR", "G:/_RE9_research/tools/re-mesh-editor"))
    config = args.parse_args()
    if config.mesh.name != SOURCE.name:
        args.error(f"Expected {SOURCE.name}")
    export(read_mesh(config.mesh, config.plugin), config.output, config.mesh)
