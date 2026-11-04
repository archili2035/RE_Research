from pak_extract import *
import os, json, sys

GAME = "G:/SteamLibrary/steamapps/common/RESIDENT EVIL requiem BIOHAZARD requiem"
OUT = "G:/re9_research/extract"

def load_index():
    d = json.load(open('pak_index.json'))
    return d['paks'], {int(k): v for k, v in d['index'].items()}

def main(paths, label):
    paks, index = load_index()
    # 惰性缓存每个 pak 的 (file, feature, chunk_map)
    pak_cache = {}
    def get_pak(pi):
        if pi not in pak_cache:
            f, entries, feature, chunk_map = parse_pak(os.path.join(GAME, paks[pi]))
            pak_cache[pi] = (f, feature, chunk_map)
        return pak_cache[pi]
    ok = 0; miss = 0; err = 0
    for p in paths:
        h = path_hash(p)
        if h not in index:
            miss += 1
            print(f"MISS: {p}")
            continue
        pi, off, cs, ds, attr, ck = index[h]
        f, feature, chunk_map = get_pak(pi)
        try:
            data = extract(f, (h, off, cs, ds, attr, ck), feature, chunk_map)
        except Exception as ex:
            err += 1
            print(f"ERR {p}: {ex}")
            continue
        outpath = os.path.join(OUT, p.replace('/', os.sep))
        os.makedirs(os.path.dirname(outpath), exist_ok=True)
        open(outpath, 'wb').write(data)
        ok += 1
    for f, _, _ in pak_cache.values():
        f.close()
    print(f"[{label}] 提取 {ok} 个, 缺失 {miss} 个, 错误 {err} 个")

if __name__ == '__main__':
    listfile = sys.argv[1]
    label = sys.argv[2]
    paths = [l.strip() for l in open(listfile, encoding='utf-8') if l.strip()]
    main(paths, label)
