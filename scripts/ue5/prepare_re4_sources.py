"""Prepare a small RE4 source set; re-read current PAK indexes and hash output."""
import csv, ctypes, hashlib, json, pathlib, re, sys, zlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts/re9_monsters'))
from pak_extract import parse_pak, path_hash
GAME = pathlib.Path(r'G:\SteamLibrary\steamapps\common\RESIDENT EVIL 4  BIOHAZARD RE4')
OUT = ROOT/'runtime/ue5_asset_probe/re4_wp4000'
REPORT = ROOT/'reports/ue5'
OUT.mkdir(parents=True, exist_ok=True)
REPORT.mkdir(parents=True, exist_ok=True)
paths = [r['path'] for r in csv.DictReader((ROOT/'reports/RE4/effective_inventory.csv').open(encoding='utf-8-sig')) if r['path']]
mesh_paths = [f'natives/stm/_chainsaw/character/ch/cha0/cha000/{part}/cha000_{part}.mesh.221108797' for part in ['00','10','20']]
mesh_paths += ['natives/stm/_chainsaw/character/wp/wp40/wp4000/00/wp4000_00.mesh.221108797']
motion_path = 'natives/stm/_chainsaw/animation/ch/cha0/motlist/cha0_wp4000h.motlist.663'
selected = set(mesh_paths + [motion_path])
for p in paths:
    if p.startswith('natives/stm/_chainsaw/') and (
        '/animation/ch/cha0/' in p and ('.motbank.' in p or '/motlist/cha0_common' in p or '/motlist/cha0_wp4000' in p)
        or '/appsystem/character/ch0common/motion/' in p
        or '/appsystem/character/ch0a0z0/ch0a0z0_body.pfb.' in p
        or '/camera/playercameracontroller/ch0a0z0/chholdhandgun.user.' in p
        or '/camera/playercameracontroller/ch0a0z0/chbattlenormal.user.' in p):
        selected.add(p)
# Retain companion material definitions and streaming meshes where listed; textures deferred.
for p in paths:
    for mesh in mesh_paths:
        if p == mesh.replace('/stm/', '/stm/streaming/') or (p.startswith(mesh.split('.mesh.')[0]+'.mdf2.')):
            selected.add(p)
lookup = {path_hash(p): p for p in selected}
effective = {}; packages = []; handles = []
try:
    for pak in sorted(GAME.glob('*.pak')):
        f, entries, feature, chunks = parse_pak(str(pak)); handles.append(f)
        packages.append({'name':pak.name,'size':pak.stat().st_size,'mtime_ns':pak.stat().st_mtime_ns,'feature':feature})
        for h, offset, cs, ds, attr, checksum in entries:
            if h in lookup:
                effective[h] = (f,feature,offset,cs,ds,attr,checksum,pak.name)
    missing = [p for h,p in lookup.items() if h not in effective]
    if missing: raise RuntimeError('Missing selected resources: '+repr(missing))
    lib = ctypes.CDLL(str(ROOT/'tools/zstd/zstd-v1.5.7-win64/dll/libzstd.dll'))
    lib.ZSTD_decompress.restype = ctypes.c_size_t
    lib.ZSTD_decompress.argtypes = [ctypes.c_void_p,ctypes.c_size_t,ctypes.c_void_p,ctypes.c_size_t]
    lib.ZSTD_isError.argtypes = [ctypes.c_size_t]
    records=[]
    for h,p in sorted(lookup.items(),key=lambda kv:kv[1]):
        f,feature,offset,cs,ds,attr,checksum,pak = effective[h]
        if feature in (40,44) or ((attr>>16)&255): raise ValueError('Unsupported encoding: '+p)
        if ds > 150_000_000: raise ValueError('Unexpected sample size: '+p)
        f.seek(offset); b=f.read(cs)
        if len(b)!=cs: raise ValueError('Short compressed read')
        if attr&15 == 1: b=zlib.decompress(b,-15)
        elif attr&15 == 2:
            dest=ctypes.create_string_buffer(ds); n=lib.ZSTD_decompress(dest,ds,b,len(b))
            if lib.ZSTD_isError(n): raise ValueError('Zstd failure: '+p)
            b=dest.raw[:n]
        elif attr&15 != 0: raise ValueError('Unsupported compression')
        if len(b)!=ds: raise ValueError('Decoded size mismatch: '+p)
        dest=OUT/'source'/p
        dest.resolve().relative_to((OUT/'source').resolve())
        dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(b)
        digest=hashlib.sha256(b).hexdigest()
        if hashlib.sha256(dest.read_bytes()).hexdigest()!=digest: raise ValueError('Readback mismatch')
        records.append(dict(path=p,pak=pak,offset=offset,compressed_size=cs,size=ds,path_hash=f'{h:016x}',archive_checksum=f'{checksum:016x}',sha256=digest,output=str(dest.relative_to(ROOT))))
    manifest=dict(game='RE4 _chainsaw',engine_target='UE 5.8.4',selection='Leon cha000 / wp4000',patch_policy='sorted archive names; static override model, not runtime load trace',packages=packages,files=records,mesh_paths=mesh_paths,motion_path=motion_path,fbx_exported=False,ue_verified=False)
    (REPORT/'re4_wp4000_source_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    # This list describes selected clips; refreshed binary decode is a separate verification stage.
    parsed=json.loads((ROOT/'reports/RE4/parsed'/f'{motion_path}.json').read_text(encoding='utf-8-sig'))
    wanted={140,141,158,159,160,165,167,403,500,501,502}
    clips=[e for e in parsed['Entries'] if e.get('ID') in wanted]
    (REPORT/'re4_wp4000_clip_selection.json').write_text(json.dumps({'source':motion_path,'metadata_source':'existing parsed report; compare with freshly extracted binary before conversion','clips':clips,'note':'500/501/502 are additive candidates; 140/158 may require companion layers; 161 is not hold_end in RE4'},ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'files':len(records),'bytes':sum(r['size'] for r in records),'clips':len(clips),'output':str(OUT)},ensure_ascii=False))
finally:
    for f in handles: f.close()
