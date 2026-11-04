from pak_extract import *
import hashlib

pak = "G:/SteamLibrary/steamapps/common/RESIDENT EVIL requiem BIOHAZARD requiem/re_chunk_000.pak"
f, entries, feature, chunk_map = parse_pak(pak)
hmap = {}
for e in entries:
    hmap.setdefault(e[0], e)

# 提取 charaname.msg
test = 'natives/stm/message/gamesystem/charaname.msg.23'
h = path_hash(test)
e = hmap[h]
data = extract(f, e, feature, chunk_map)
print("extracted size:", len(data))
print("expected dsize:", e[3])
# 对比已解包的文件
ref = open(r'C:/Users/archili/AppData/Local/Temp/re9_extract/natives/stm/message/gamesystem/charaname.msg.23','rb').read()
print("matches reference:", data == ref)
print("md5:", hashlib.md5(data).hexdigest())
# 验证 magic
print("magic bytes:", data[:8].hex(), data[4:8])
f.close()
