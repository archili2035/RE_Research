"""Build the M1 asset audit from the installed Steam snapshots and local research outputs."""
import csv
import ctypes
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
from time import perf_counter
import types

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path("runtime/web-3c-m1.tmp")
OUT = Path("reports/web-3c/asset-audit.json")
RE4_OUTPUT = Path("runtime/ue5_asset_probe/re4_wp4000")
RE4_MOT = "natives/stm/_chainsaw/animation/ch/cha0/motlist/cha0_wp4000h.motlist.663"
RE9_MOT = "natives/stm/animation/ch/ch01/ch0100/motlist/ch0100_handgun00h.motlist.1047"
RE9_ADD = RE9_MOT.replace("00h.", "00h_add.")
PURPOSES = ("hold-idle", "hold-walk-forward", "raise", "fire", "reload", "lower")

sys.path.insert(0, str(ROOT / "scripts/re9_monsters"))
from pak_extract import extract, parse_pak, path_hash
from tex_info import parse_tex, TEX_FORMAT_NAMES


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def read_csv(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def elapsed(start):
    return round((perf_counter() - start) * 1000, 3)


def check(condition, message):
    if not condition:
        raise ValueError(message)


def stage(status, evidence=None, detail=None, elapsed_ms=None, **measurements):
    return {
        "status": status, "elapsedMs": elapsed_ms, "evidence": evidence,
        "detail": detail, **measurements,
    }


def record(purpose, sources, results, **stages):
    for name in ("extraction", "decode", "binding", "readback"):
        check(name in stages, f"{purpose}: missing stage {name}")
    statuses = {name: result["status"] for name, result in stages.items()}
    status = next((value for value in ("failed", "partial", "pending") if value in statuses.values()), "verified")
    return {
        "purpose": purpose, "sourcePaths": sources,
        "resultFiles": results,
        "failureStages": [name for name, value in statuses.items() if value == "failed"],
        "verificationStatus": status, "stages": stages,
    }


def load_zstd():
    library = ctypes.CDLL(str(ROOT / "tools/zstd/zstd-v1.5.7-win64/dll/libzstd.dll"))
    library.ZSTD_decompress.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t]
    library.ZSTD_decompress.restype = ctypes.c_size_t
    library.ZSTD_isError.argtypes = [ctypes.c_size_t]
    library.ZSTD_isError.restype = ctypes.c_uint

    def decompress(data, max_size):
        out = ctypes.create_string_buffer(max_size)
        size = library.ZSTD_decompress(out, max_size, data, len(data))
        check(not library.ZSTD_isError(size), "ZSTD decompression failed")
        return out.raw[:size]

    return decompress


def extract_sources(game_dir, game_id, names_and_copies, decompress):
    # Match the repository's static override policy. Read only files used by M1.
    wanted = {path_hash(name): name for name in names_and_copies}
    sources = {}
    packages = []
    for pak in sorted(game_dir.glob("re_chunk_*.pak")):
        with pak.open("rb") as header:
            magic, major, minor, feature = struct.unpack("<4sBBH", header.read(8))
        check(magic == b"KPKA", f"Invalid archive: {pak.name}")
        start = perf_counter()
        file, entries, _, _ = parse_pak(str(pak))
        with file:
            for entry in entries:
                if entry[0] in wanted:
                    sources.setdefault(wanted[entry[0]], []).append((pak, entry))
        packages.append({
            "name": pak.name, "sizeBytes": pak.stat().st_size, "kpkaVersion": f"{major}.{minor}",
            "feature": feature, "indexElapsedMs": elapsed(start),
        })
    check(packages, f"No packages found in {game_dir}")
    by_pak = {}
    results = {}
    for name, copies in names_and_copies.items():
        matches = sources.get(name, [])
        if not matches:
            results[name] = {"status": "failed", "failureStage": "locate", "detail": "No path hash match"}
            continue
        pak, entry = matches[-1]
        by_pak.setdefault(pak, []).append((name, copies, entry, matches))

    for pak, selections in by_pak.items():
        file, _, feature, chunks = parse_pak(str(pak))
        with file:
            for name, copies, entry, matches in selections:
                _, offset, compressed, length, attributes, checksum = entry
                start = perf_counter()
                patch = re.search(r"\.patch_(\d+)\.pak$", pak.name)
                details = {
                    "package": pak.name, "patch": int(patch[1]) if patch else None,
                    "matchingPackages": [path.name for path, _ in matches],
                    "pathHash": f"{entry[0]:016x}", "offset": offset, "compressedBytes": compressed,
                    "sizeBytes": length, "attributes": attributes, "archiveChecksum": f"{checksum:016x}",
                }
                try:
                    check(not ((attributes >> 16) & 255), "Resource encoding unsupported by local extraction")
                    check(0 < length <= 100_000_000, "Resource outside M1 extraction size range")
                    data = extract(file, entry, feature, chunks, decompress)
                    packed_tex = (
                        name.endswith(".tex.250813143") and feature == 8 and attributes & 15 == 0
                        and data[:4] == b"TEX\x00" and len(data) == compressed < length
                    )
                    check(len(data) == length or packed_tex, "Extracted length mismatch")
                    digest = sha256(data)
                    cached_path = CACHE / game_id / name
                    result = next((copy for copy in copies if copy.is_file() and sha256(copy.read_bytes()) == digest), None)
                    if result is None:
                        cached_path.parent.mkdir(parents=True, exist_ok=True)
                        cached_path.write_bytes(data)
                        check(sha256(cached_path.read_bytes()) == digest, "Local extraction readback hash mismatch")
                        result = cached_path
                    details.update(status="verified", sha256=digest, file=result.as_posix(),
                                   extractedBytes=len(data), packedTexture=packed_tex)
                except (ValueError, OSError, RuntimeError) as error:
                    details.update(status="failed", failureStage="extraction", detail=str(error))
                results[name] = {**details, "elapsedMs": elapsed(start)}
    return packages, results


def check_hierarchy(bones):
    roots = []
    seen = set()
    for index, bone in enumerate(bones):
        parent = bone["parent"]
        check(bone["name"] not in seen, "Duplicate bone name")
        check(-1 <= parent < len(bones) and parent != index, "Invalid parent index")
        check(all(math.isfinite(x) for key in ("position", "rotation") for x in bone[key]), "Nonfinite binding TRS")
        seen.add(bone["name"])
        if parent == -1:
            roots.append(bone["name"])
        lineage = {index}
        while parent != -1:
            check(0 <= parent < len(bones) and parent not in lineage, "Invalid bone hierarchy")
            lineage.add(parent)
            parent = bones[parent]["parent"]
    check(roots, "Missing skeleton root")
    return roots


def check_tracks(clip):
    start = perf_counter()
    check(clip["frames"] > 0 and clip["fps"] > 0, "Invalid frame metadata")
    extents = []
    for track in clip["tracks"]:
        for channel, width in (("position", 3), ("rotation", 4), ("scale", 3)):
            data = track[channel]
            if data is None:
                continue
            times, values = data["times"], data["values"]
            check(len(times) == len(values) and times, "Mismatched keys and values")
            check(all(math.isfinite(t) and t >= 0 for t in times), "Invalid key time")
            check(all(a <= b for a, b in zip(times, times[1:])), "Nonmonotonic key time")
            check(all(len(v) == width and all(math.isfinite(x) for x in v) for v in values), "Invalid key value")
            if channel == "rotation":
                check(all(abs(sum(x * x for x in v) - 1) < 1e-3 for v in values), "Non-unit quaternion")
            extents.append(times[-1])
    check(extents, "No keyframes")
    duration = clip["frames"] / clip["fps"]
    check(max(extents) <= duration + 1e-5, "Key time exceeds nominal duration")
    return {
        "frames": clip["frames"], "fps": clip["fps"], "durationS": duration,
        "trackCount": len(clip["tracks"]), "lastKeyTimeS": max(extents),
        "elapsed_ms": elapsed(start),
    }


def extraction_stage(resources, names):
    failed = [name for name in names if resources[name]["status"] != "verified"]
    return stage("failed" if failed else "verified", detail="See sources for actual package, hashes and measured times.",
                 failedSources=failed)


def result_path(path, selector=None):
    result = {"file": Path(path).as_posix()}
    if selector is not None:
        result["selector"] = selector
    return result


def local_results(resources, names):
    return [result_path(resources[name]["file"]) for name in names if "file" in resources[name]]


def motion_records(game_id, resources):
    re4 = game_id == "RE4"
    if re4:
        output = "runtime/ue5_asset_probe/re4_wp4000/decoded"
        selection = "reports/ue5/re4_wp4000_clip_selection.json"
        validated = "reports/ue5/re4_motion_decode_validation.json"
        reload_report = (CACHE / "re4-reload/validation.json").as_posix()
        selected = {row["ID"]: row for row in read_json(selection)["clips"]}
        motion_rows = {
            int(row["id"]): {key: row[key.lower()] for key in ("ID", "Name", "Frames", "FPS", "Slot", "Switch")}
            for row in read_csv("reports/RE4/motions_animation.csv")
            if row["path"] == RE4_MOT and row["id"] in ("810", "811") and row["switch"] == "0"
        }
        sets = zip(PURPOSES, (160, 403, 140, 500, 810, 158), (None, None, 141, None, 811, 159))
    else:
        selection = "reports/phase2/all_resolved.csv"
        validated = "docs/player/motions.json"
        browser_file = (CACHE / "re9-browser.json").as_posix()
        browser = read_json(browser_file)
        for path, expected in browser["inputs"].items():
            check(sha256(Path(path).read_bytes()) == expected, f"Stale browser result for {path}")
        browser_clips = {(row["bank"], row["id"]): row for row in browser["clips"]}
        decoded = {(row["bank"], row["id"]): row for row in read_json(validated)["clips"]}
        resolved = {(row["Source"], int(row["ID"])): row for row in read_csv(selection)
                    if row["List"] in (Path(RE9_MOT).name, Path(RE9_ADD).name) and row["Switch"] == "0"}
        hashes = {row["Path"]: row["SHA256"].lower() for row in read_csv("reports/phase2/evidence_manifest.csv")}
        sets = zip(PURPOSES, (160, 120, 140, 1100, 1200, 161), (None, None, None, None, 1200, None))

    for purpose, primary, companion in sets:
        samples = []
        for is_companion, motion_id in enumerate([primary] + ([companion] if companion is not None else [])):
            bank = None if re4 else (2100 if is_companion else 100)
            source = RE4_MOT if re4 else (RE9_ADD if is_companion else RE9_MOT)
            selector = {"id": motion_id, **({} if re4 else {"bank": bank})}
            if re4:
                reload = purpose == "reload"
                metadata = motion_rows[motion_id] if reload else selected[motion_id]
                decode_report = reload_report if reload else validated
                report_row = next(row for row in read_json(decode_report)["clips"] if row["id"] == motion_id)
                clip_path = (Path(decode_report).parent if reload else Path(output)) / report_row["output"]
                clip = read_json(clip_path)
                check(clip["sourceSHA256"] == resources[source].get("sha256"), f"Stale RE4 decode {motion_id}")
                check(clip["Switch"] == int(metadata["Switch"]) == 0, f"Wrong RE4 clip variant {motion_id}")
                selector.update(slot=int(metadata["Slot"]), switch=0)
                metadata_path = "reports/RE4/motions_animation.csv" if reload else selection
                mode = "additive-candidate" if is_companion or purpose == "fire" else "raw"
                unknown = clip["unmappedBoneHashes"]
                missing_index = [t["boneHash"] for t in clip["tracks"] if t["bone"] == -1 and t["boneName"]]
                check(all(t["bone"] == -1 or 0 <= t["bone"] < len(clip["bones"]) for t in clip["tracks"]), "Invalid RE4 bone index")
                check(sorted(t["boneHash"] for t in clip["tracks"] if t["boneName"] is None) == sorted(unknown),
                      "Unresolved RE4 hashes disagree with track data")
                binding = stage("partial", str(clip_path.as_posix()), "Source hierarchy checked. Target skin binding and layer composition pending.",
                                roots=check_hierarchy(clip["bones"]), unmappedBoneHashes=unknown, modelNamedTrackHashes=missing_index)
                readback = stage("partial", clip_path.as_posix(), "Decoded JSON reopened and checked. Composed pose and standard GLB readback pending.")
            else:
                metadata = resolved[(source, motion_id)]
                clip_path = Path(validated)
                clip = decoded[(bank, motion_id)]
                decode_report = "player/verify.cjs"
                metadata_path = selection
                check(hashes[source] == resources[source].get("sha256"), f"Stale RE9 decode {bank}/{motion_id}")
                check(metadata["Route"] == "local" and metadata["Kind"] == "mot", "Unexpected RE9 motion resolution route")
                selector["switch"] = int(metadata["Switch"])
                mode = "additive" if is_companion else ("raw-tpsadd-layer" if purpose == "fire" else "raw")
                check(clip["additive"] == bool(is_companion), "Unexpected RE9 player clip type")
                check(all(0 <= track["bone"] < len(clip["bones"]) for track in clip["tracks"]), "Unmapped RE9 track")
                browser_clip = browser_clips[(bank, motion_id)]
                binding = stage("partial" if is_companion else "verified", browser_file,
                                "Add layer sampled on its skeleton. Composition pending." if is_companion
                                else "Same-name character joint positions checked in the CPU-skinned player.",
                                roots=check_hierarchy(clip["bones"]), poseCount=len(browser_clip["poses"]),
                                maxJointError=max((p["maxJointError"] for p in browser_clip["poses"] if "maxJointError" in p), default=None))
                readback = stage("partial", browser_file, "Research player readback passed. Standard GLB and composed pose pending.",
                                 browser_clip["elapsedMs"], browser=browser["chromium"],
                                 selector={"bank": bank, "id": motion_id},
                                 sampledTimesS=[pose["timeS"] for pose in browser_clip["poses"]])
            check(clip["id"] == motion_id and clip["source"] == source, "Motion identity mismatch")
            check((clip["name"], clip["frames"], clip["fps"]) ==
                  (metadata["Name"], float(metadata["Frames"]), int(metadata["FPS"])), "Motion metadata mismatch")
            sample = record(
                purpose, [source], [result_path(clip_path, selector)],
                extraction=extraction_stage(resources, [source]),
                decode=stage("verified", decode_report, metadata_path, **check_tracks(clip)),
                binding=binding, readback=readback,
            )
            sample.update(role="companion" if is_companion else "primary", motion=selector,
                          sourceName=clip["name"], sourceMode=mode)
            samples.append(sample)
        yield from samples


def texture_record(resources, purpose, source, tex_tool):
    output = local_results(resources, [source])
    extraction = extraction_stage(resources, [source])
    decode = stage("pending", detail="Extracted TEX needed before decode.")
    readback = stage("pending", detail="DDS conversion needed before readback.")
    if output:
        tex = Path(output[0]["file"])
        start = perf_counter()
        try:
            version, width, height, images, mips, fmt = parse_tex(tex)
            decode = stage("partial", tex.as_posix(), "TEX header checked. TEX-to-DDS pending.", elapsed(start),
                           texVersion=version, width=width, height=height, mips=mips, images=images,
                           format=TEX_FORMAT_NAMES.get(fmt, str(fmt)))
            if tex_tool:
                conversion_start = perf_counter()
                dds = CACHE / "textures" / f"{tex.name}.dds"
                dds.parent.mkdir(parents=True, exist_ok=True)
                conversion = tex_tool(str(tex), str(dds))
                check(conversion["outDDSList"] == [str(dds)], "Unexpected texture array")
                decode.update(status="verified", detail="TEX decoded by local RE Mesh Editor.",
                              elapsedMs=decode["elapsedMs"] + elapsed(conversion_start))
                start = perf_counter()
                data = dds.read_bytes()
                check(data[:4] == b"DDS " and data[84:88] == b"DX10", "Invalid DDS header")
                check(struct.unpack_from("<II", data, 12) == (height, width), "DDS dimensions mismatch")
                check(struct.unpack_from("<I", data, 128)[0] == fmt, "DDS format mismatch")
                block_size = {71: 8, 72: 8, 80: 8, 83: 16, 98: 16, 99: 16}[fmt]
                payload_size = sum(((max(1, width >> i) + 3) // 4) * ((max(1, height >> i) + 3) // 4) * block_size for i in range(mips))
                check(len(data) - 148 == payload_size, "Unexpected DDS mip payload length")
                if resources[source]["packedTexture"]:
                    check(resources[source]["sizeBytes"] == 40 + 24 * mips * images + payload_size,
                          "PAK logical size disagrees with the decoded TEX mip payload")
                output.append(result_path(dds))
                readback = stage("verified", dds.as_posix(), "DDS dimensions, format and all mip payload lengths verified.",
                                 elapsed(start), sha256=sha256(data))
        except (AssertionError, ValueError, OSError, RuntimeError, KeyError, struct.error) as error:
            target = readback if decode["status"] == "verified" else decode
            target.update(status="failed", detail=str(error))
    return record(purpose, [source], output, extraction=extraction, decode=decode,
                  binding=stage("pending", detail="Material channel and streaming binding pending."), readback=readback)


def steam_value(manifest, key):
    match = re.search(rf'^\s*"{key}"\s*"([^"]+)"', manifest, re.MULTILINE)
    check(match, f"Steam manifest has no {key}")
    return match[1]


def game_record(steamapps, appid, game_id, decompress, tex_tool, plugin, mesh_python):
    manifest = (steamapps / f"appmanifest_{appid}.acf").read_text(encoding="utf-8-sig")
    game_dir = steamapps / "common" / steam_value(manifest, "installdir")
    re4 = game_id == "RE4"
    if re4:
        source_manifest = read_json("reports/ue5/re4_wp4000_source_manifest.json")
        body = source_manifest["mesh_paths"][:3]
        weapon, = source_manifest["mesh_paths"][3:]
        camera = "natives/stm/_chainsaw/appsystem/camera/playercameracontroller/ch0a0z0/chholdhandgun.user.2"
        tex = "natives/stm/_chainsaw/character/ch/cha0/cha000/00/cha000_00_upperbody_"
        tex_version = "143221013"
        names = [*body, weapon, camera, RE4_MOT]
        candidates = {name: [RE4_OUTPUT / "source" / name] for name in names}
        model = (RE4_OUTPUT / "fbx/SK_RE4_Leon_Gray.fbx").as_posix()
        model_evidence = "reports/ue5/re4_gray_model_roundtrip.json"
        historical = {row["path"]: row["sha256"].lower() for row in source_manifest["files"]}
        camera_parsed = Path("reports/RE4/parsed") / f"{camera}.json"
        camera_selector = {"index": 11, "class": "chainsaw.PlayerCameraParam"}
        weapon_link = result_path("reports/RE4/combat_loop/weapon_resource_chain.json", {"weaponId": 4000})
    else:
        stats = read_json("reports/model/export_stats.json")
        body = [row["file"].replace("\\", "/").split("/natives/")[1] for row in stats]
        body = ["natives/" + path for path in body]
        streaming_catalog = Path("references/RE9_STM_Release.list").read_text(encoding="utf-8-sig").lower().splitlines()
        body += [path.replace("natives/stm/", "natives/stm/streaming/") for path in body
                 if path.replace("natives/stm/", "natives/stm/streaming/") in streaming_catalog]
        weapon = "natives/stm/character/wp/wp01/0111/00/wp0111_00.mesh.250925211"
        camera = "natives/stm/gameassets/camera/userdata/playertpscamera/common/action/position/hold.user.3"
        tex = "natives/stm/character/ch/ch01/0100/textures/ch0100_40_00_shirt_"
        tex_version = "250813143"
        names = [*body, weapon, camera, RE9_MOT, RE9_ADD]
        locations = ("reports/model/samples", "reports/model_extra/samples", "reports/model_streaming/samples",
                     "reports/phase2/samples", "reports/samples", "reports/3c/camera/samples")
        candidates = {name: [path for folder in locations for path in Path(folder).glob(f"*/{name}")] for name in names}
        model = "docs/player/model.js"
        model_evidence = (CACHE / "re9-browser.json").as_posix()
        hash_lists = ("reports/model/source_manifest.csv",)
        historical = {}
        for hash_list in hash_lists:
            for row in read_csv(hash_list):
                historical["natives/" + row["File"].replace("\\", "/").split("/natives/")[1]] = row["SHA256"].lower()
        for name, copies in candidates.items():
            if name in body and copies and name not in historical:
                historical[name] = sha256(copies[0].read_bytes())
        camera_parsed = Path("reports/3c/camera/parsed") / f"{camera.removeprefix('natives/')}.json"
        camera_selector = {"parameters": ["_Offset", "_GazeDistance", "_IsHipLocalPosDiff"]}
        weapon_link = result_path("references/RE9_STM_Release.list", {"prefix": "natives/stm/animation/wp/wp01/wp0111/"})
    textures = [tex + channel + ".tex." + tex_version for channel in ("albd", "nrmr")]
    candidates.update({name: [] for name in textures})
    packages, resources = extract_sources(game_dir, game_id.lower(), candidates, decompress)
    print(f"{game_id}: {len(packages)} PAKs; {sum(r['status'] == 'verified' for r in resources.values())}/{len(resources)} sources extracted and hashed", flush=True)

    output = local_results(resources, body)
    fresh_model = Path(model).is_file() and all(historical.get(name) is not None and
                                                resources[name].get("sha256") == historical[name] for name in body)
    if fresh_model:
        output.append(result_path(model))
        model_stats = read_json(model_evidence)
        if re4:
            check(model_stats["status"] == "PASS_BLENDER_FBX_ROUNDTRIP", "Missing RE4 FBX round-trip")
            model_detail = "Existing Blender FBX round-trip checked against matching source bytes."
            metrics = {"bones": model_stats["bones"], "maxJointError": model_stats["max_joint_head_error"]}
        else:
            check(not model_stats["errors"], "RE9 player failed")
            model_detail = "Six CPU-skinned graybox parts read back in Chromium."
            metrics = {"parts": 6, "vertices": 72346}
        model_stage = stage("verified", model_evidence, model_detail, **metrics)
    else:
        model_stage = stage("pending", detail="A model export tied to the extracted source hashes is needed.")
    samples = [record("character-rig", body, output, extraction=extraction_stage(resources, body),
                      decode=model_stage, binding=model_stage,
                      readback=stage("partial" if fresh_model else "pending", model_evidence,
                                     "Standard GLB coordinate and skin readback pending."))]
    samples.extend(motion_records(game_id, resources))
    output = local_results(resources, [weapon])
    decode = stage("pending", detail="Weapon mesh parser or source required.")
    binding = stage("pending", detail="Weapon-to-character socket and transform need confirmation.")
    if output and mesh_python.is_file() and plugin.is_dir():
        start = perf_counter()
        report = CACHE / f"{game_id.lower()}-weapon.json"
        log = report.with_suffix(".log")
        with log.open("w", encoding="utf-8") as stream:
            proc = subprocess.run([str(mesh_python), "-I", "scripts/web-3c/inspect_m1_weapon.py",
                                   str(plugin), output[0]["file"], str(report)],
                                  stdout=stream, stderr=subprocess.STDOUT, check=False)
        if proc.returncode == 0:
            mesh = read_json(report)
            output.append(result_path(report))
            decode = stage("verified", report.as_posix(), "Weapon mesh and its source skeleton parsed.",
                           elapsed(start), lodCount=mesh["lods"], boneCount=len(mesh["boneNames"]))
            idle = next(sample for sample in samples if sample["purpose"] == "hold-idle")
            idle_result = idle["resultFiles"][0]
            data = read_json(idle_result["file"])
            if not re4:
                data = next(clip for clip in data["clips"] if (clip["bank"], clip["id"]) == (100, 160))
            character_candidates = [bone["name"] for bone in data["bones"] if bone["name"] in ("R_Wep", "L_Wep")]
            weapon_candidates = [name for name in mesh["boneNames"] if "attach_hand" in name.lower()]
            binding = stage("partial", report.as_posix(), "Named candidates found. Runtime mapping and local transform need confirmation.",
                            characterAttachmentCandidates=character_candidates, weaponAttachmentCandidates=weapon_candidates,
                            weaponRoots=mesh["roots"], characterEvidence=idle_result)
        else:
            decode = stage("failed", log.as_posix(), f"Weapon mesh parser exited with code {proc.returncode}.", elapsed(start))
    output.append(weapon_link)
    samples.append(record(
        "handgun-mesh", [weapon], output,
        extraction=extraction_stage(resources, [weapon]),
        decode=decode, binding=binding,
        readback=stage("pending", detail="Attached mesh readback pending."),
    ))
    verified_camera = camera_parsed.is_file() and resources[camera].get("file", "") != (CACHE / game_id.lower() / camera).as_posix()
    output = local_results(resources, [camera])
    if verified_camera:
        output.append(result_path(camera_parsed, camera_selector))
    samples.append(record(
        "hold-camera", [camera], output, extraction=extraction_stage(resources, [camera]),
        decode=stage("verified" if verified_camera else "pending", camera_parsed.as_posix(),
                     "Static aiming position configuration.", selector=camera_selector),
        binding=stage("not_applicable"),
        readback=stage("verified" if verified_camera else "pending", "reports/RE4/camera_parameters.csv" if re4 else "reports/3c/parameters.csv",
                       "Parsed configuration. Final runtime camera requires synchronized observations."),
    ))
    samples.extend(texture_record(resources, purpose, name, tex_tool)
                   for purpose, name in zip(("base-color", "normal-map"), textures))
    return {
        "game": game_id, "version": {"platform": "Steam", "appId": appid, "buildId": steam_value(manifest, "buildid")},
        "character": "Leon cha000 / ch0a0z0" if re4 else "Leon ch0100 / cp_a000",
        "weapon": "wp4000" if re4 else "wp0111 (candidate for stock Handgun00H clips)",
        "packages": packages, "sources": resources, "samples": samples,
    }


def main():
    os.chdir(ROOT)
    decompress = load_zstd()
    plugin = Path(os.environ.get("RE_MESH_EDITOR", "G:/_RE9_research/tools/re-mesh-editor"))
    tex_tool = None
    if plugin.is_dir():
        package = types.ModuleType("m1_re_mesh_editor")
        package.__path__ = [str(plugin)]
        sys.modules[package.__name__] = package
        tex_tool = importlib.import_module("m1_re_mesh_editor.modules.tex.re_tex_utils").convertTexFileToDDS
    steamapps = Path(os.environ.get("STEAMAPPS", "G:/SteamLibrary/steamapps"))
    mesh_python = Path(os.environ.get("RE_MESH_PYTHON",
                                     "G:/_RE9_research/tools/blender-5.0.1-windows-x64/5.0/python/bin/python.exe"))
    games = [game_record(steamapps, appid, game, decompress, tex_tool, plugin, mesh_python)
             for appid, game in ((2050650, "RE4"), (3764200, "RE9"))]
    data = {
        "schemaVersion": 1,
        "scope": "Local research references for M2. Original or licensed runtime assets are required.",
        "pathBase": "repository root; sourcePaths are virtual archive paths indexing the same game's sources",
        "patchPolicy": "Last matching archive by sorted filename, following existing static inventory convention.",
        "timePolicy": "Milliseconds. Source times cover extraction and local hash checks. Index times exclude extraction. Motion decode times are validation of decoded data. Null means unmeasured.",
        "statusValues": {
            "verified": "Recorded scope passed", "partial": "Evidence exists and a downstream check is outstanding",
            "pending": "Required input or check is missing", "failed": "Attempt failed",
            "not_applicable": "Stage does not apply to this sample",
        },
        "upstream": ["reports/RE4/research_summary.json", "reports/ue5/re4_wp4000_clip_selection.json",
                     "reports/phase2/summary.json", "reports/phase2/all_resolved.csv"],
        "selectionForM2": {
            "preferred": {"game": "RE9", "rigPurpose": "character-rig", "motionPurposes": ["hold-idle", "raise", "reload"]},
            "comparison": {"game": "RE4", "rigPurpose": "character-rig", "motionPurposes": ["hold-idle", "raise", "reload"]},
            "motionFilter": "Use role=primary for first readback. Raw layer data and companion tracks require composition evidence before conversion.",
            "sharedInterfaceImpact": "M2 consumes schemaVersion 1, game, purpose, role, sourcePaths and resultFiles with selectors. M0 ClipManifest and runtime interfaces require no change.",
            "placeholder": {"status": "pending", "glb": None, "provenance": "M2 needs an original or licensed rig and authored tracks for browser integration."},
        },
        "games": games,
    }
    for game in games:
        primary = [r["purpose"] for r in game["samples"] if r.get("role") == "primary"]
        check(tuple(primary) == PURPOSES, f"{game['game']}: incomplete or duplicated comparison set")
        for sample in game["samples"]:
            for result in sample["resultFiles"]:
                check(Path(result["file"]).is_file(), f"Missing result: {result['file']}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temp.replace(OUT)
    print(f"Wrote {OUT.as_posix()}")


if __name__ == "__main__":
    main()
