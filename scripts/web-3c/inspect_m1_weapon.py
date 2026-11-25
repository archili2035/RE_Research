"""Read a local weapon mesh using the RE Mesh Editor parser."""
import importlib
import json
from pathlib import Path
import sys
import types


def main():
    plugin, file, report = sys.argv[1:]
    package = types.ModuleType("m1_mesh_editor")
    package.__path__ = [plugin]
    sys.modules[package.__name__] = package
    reader = importlib.import_module("m1_mesh_editor.modules.mesh.file_re_mesh")
    mesh = reader.readREMesh(file)
    names = [mesh.rawNameList[i] for i in mesh.boneNameRemapList]
    bones = mesh.skeletonHeader.boneInfoList
    if len(bones) != len(names) or not names or not mesh.lodHeader.lodGroupCount:
        raise ValueError("Weapon mesh has no usable skeleton or LOD")
    roots = [name for name, bone in zip(names, bones) if bone.boneParent == -1]
    if not roots:
        raise ValueError("Weapon mesh has no skeleton root")
    data = {
        "source": Path(file).as_posix(),
        "meshVersion": mesh.meshVersion,
        "lods": mesh.lodHeader.lodGroupCount,
        "boneNames": names,
        "roots": roots,
    }
    Path(report).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
