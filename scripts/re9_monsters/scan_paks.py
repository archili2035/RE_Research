from pak_extract import *
import os, json, time

GAME = "G:/SteamLibrary/steamapps/common/RESIDENT EVIL requiem BIOHAZARD requiem"
PAKS = [
    "re_chunk_000.pak",
    "re_chunk_000.pak.patch_001.pak",
    "re_chunk_000.pak.patch_002.pak",
    "re_chunk_000.pak.patch_003.pak",
    "re_chunk_000.pak.patch_004.pak",
    "re_chunk_000.pak.patch_005.pak",
    "re_chunk_000.pak.sub_000.pak",
    "re_chunk_000.pak.sub_000.pak.patch_001.pak",
    "re_chunk_000.pak.sub_000.pak.patch_002.pak",
    "re_chunk_000.pak.sub_000.pak.patch_003.pak",
    "re_chunk_000.pak.sub_000.pak.patch_004.pak",
    "re_chunk_000.pak.sub_000.pak.patch_005.pak",
]

# 全局 hash -> (pak_index, entry) 映射（patch 覆盖 base，靠后优先）
index = {}
for pi, p in enumerate(PAKS):
    path = os.path.join(GAME, p)
    if not os.path.exists(path):
        print(f"SKIP (不存在): {p}")
        continue
    t = time.time()
    f, entries, feature, chunk_map = parse_pak(path)
    for e in entries:
        index[e[0]] = (pi, e[1], e[2], e[3], e[4], e[5])
    f.close()
    print(f"{p}: {len(entries)} files, feature={feature}, chunks={len(chunk_map) if chunk_map else 0}, {time.time()-t:.1f}s")

print(f"\n总唯一 hash: {len(index)}")

# 保存全局映射（hash -> [pak_idx, offset, csize, dsize, attr, checksum]）
out = {}
for h, (pi, off, cs, ds, attr, ck) in index.items():
    out[str(h)] = [pi, off, cs, ds, attr, ck]
with open('pak_index.json', 'w') as fp:
    json.dump({'paks': PAKS, 'index': out}, fp)
print("索引已保存到 pak_index.json")
