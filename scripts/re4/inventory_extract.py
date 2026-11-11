import sys, pathlib, json, csv, re, hashlib, collections, ctypes, time
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/re9_monsters'))
from pak_extract import parse_pak,path_hash
GAME=pathlib.Path(r'G:\SteamLibrary\steamapps\common\RESIDENT EVIL 4  BIOHAZARD RE4')
OUT=ROOT/'reports/RE4'; OUT.mkdir(exist_ok=True)
LIST=ROOT/'tools/REE.PAK.Tool/Projects/RE4_STM_Release.list'
def save(name,data): (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
def csvout(name,rows,fields):
 with (OUT/name).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
def typ(p):
 m=re.search(r'\.([a-z0-9]+)\.\d+(?:\..*)?$',p);return m[1] if m else p.rsplit('.',1)[-1]
def domains(p):
 d=[]
 if re.search(r'camera|player|cha0|ch0common|input|controller',p):d.append('3c')
 if re.search(r'animation|motion|motfsm|motbank|motlist',p):d.append('action')
 if re.search(r'stage|scene|level|location|navigation|gimmick|map/',p) or typ(p)=='scn':d.append('level')
 if re.search(r'enemy|em\d|ch[1-9]|chb|chc|chd|che',p):d.append('enemy')
 if re.search(r'weapon|damage|attack|combat|battle|parry|melee|guard|stun|hp|health|difficulty|rank',p):d.append('combat')
 return '|'.join(d)
cache=OUT/'name_hashes.json'
if cache.exists(): names={int(k):v for k,v in json.loads(cache.read_text()).items()}
else:
 names={}
 for i,p in enumerate(LIST.read_text(encoding='utf-8-sig').splitlines()):
  p=p.strip().replace('\\','/')
  if p:names[path_hash(p)]=p
  if i%50000==0:print('hash',i,flush=True)
 save('name_hashes.json',names)
print('names',len(names),flush=True)
handles={};effective={};allrows=[];packages=[]
for pak in sorted(GAME.glob('*.pak')):
 f,entries,feature,chunks=parse_pak(str(pak));handles[pak.name]=(f,feature,chunks)
 matched=0
 for e in entries:
  h,offset,cs,ds,attr,checksum=e;p=names.get(h,'');matched+=bool(p)
  row=dict(hash=f'{h:016x}',path=p,pak=pak.name,offset=offset,compressed=cs,size=ds,attr=attr,checksum=f'{checksum:016x}',type=typ(p) if p else '',domains=domains(p) if p else '')
  allrows.append(row);effective[h]=row
 packages.append(dict(pak=pak.name,bytes=pak.stat().st_size,feature=feature,entries=len(entries),resolved=matched))
 print(packages[-1],flush=True)
fields=list(allrows[0]);csvout('pak_entries.csv',allrows,fields);rows=list(effective.values());csvout('effective_inventory.csv',rows,fields);save('packages.json',packages)
# All structural configuration and animation data, excluding heavyweight meshes/textures/audio.
wanted={'user','pfb','scn','motfsm2','fsmv2','bhvt','motbank','motlist','uvar','rcol','msg','navmesh','ainav'}
selected=[r for r in rows if r['path'] and r['type'] in wanted and r['size']<=100_000_000]
print('selected',len(selected),'bytes',sum(r['size'] for r in selected),flush=True)
lib=ctypes.CDLL(str(ROOT/'tools/zstd/zstd-v1.5.7-win64/dll/libzstd.dll'));lib.ZSTD_decompress.restype=ctypes.c_size_t;lib.ZSTD_decompress.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_void_p,ctypes.c_size_t];lib.ZSTD_isError.argtypes=[ctypes.c_size_t]
import zlib
log=[];total=0
for i,r in enumerate(selected):
 result=dict(path=r['path'],pak=r['pak'],size=r['size'],type=r['type'])
 try:
  p=OUT/'extracted'/r['path'];p.resolve().relative_to((OUT/'extracted').resolve())
  f,feature,chunks=handles[r['pak']]
  if (r['attr']>>16)&255:raise ValueError('resource encryption unsupported')
  if feature in (40,44):raise ValueError('chunked archive unsupported in this RE4 pass')
  f.seek(r['offset']);b=f.read(r['compressed']);comp=r['attr']&15
  if comp==1:b=zlib.decompress(b,-15)
  elif comp==2:
   dest=ctypes.create_string_buffer(r['size']);n=lib.ZSTD_decompress(dest,r['size'],b,len(b))
   if lib.ZSTD_isError(n):raise ValueError('zstd error')
   b=dest.raw[:n]
  elif comp!=0:raise ValueError(f'unsupported compression {comp}')
  if len(b)!=r['size']:raise ValueError('size mismatch')
  p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);total+=len(b)
  result.update(success=True,sha256=hashlib.sha256(b).hexdigest())
 except Exception as e:result.update(success=False,error=str(e))
 log.append(result)
 if i%2000==0:print('extract',i,'MB',total//1000000,flush=True)
 if total>12_000_000_000:print('12GB budget reached');break
csvout('extraction_log.csv',log,['path','pak','type','size','success','sha256','error'])
summary=dict(packages=packages,filename_list_sha256=hashlib.sha256(LIST.read_bytes()).hexdigest(),effective_entries=len(rows),resolved_effective=sum(bool(r['path']) for r in rows),types=dict(collections.Counter(r['type'] for r in rows if r['path'])),extraction_attempted=len(log),extraction_success=sum(r['success'] for r in log),extracted_bytes=total)
save('summary.json',summary);print(json.dumps(summary,indent=2),flush=True)
