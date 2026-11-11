import pathlib
exec(pathlib.Path('scripts/re4/inventory_extract.py').read_text(encoding='utf-8-sig').split('cache=OUT/')[0])
found=json.loads((OUT/'supplemental_name_matches.json').read_text());mapping={x['hash']:x['path'] for x in found}
for name in ['effective_inventory.csv','pak_entries.csv']:
 rows=list(csv.DictReader((OUT/name).open(encoding='utf-8-sig')))
 for r in rows:
  if r['hash'] in mapping:r.update(path=mapping[r['hash']],type=typ(mapping[r['hash']]),domains=domains(mapping[r['hash']]))
 csvout(name,rows,list(rows[0]))
print('new types',collections.Counter(typ(x['path']) for x in found),flush=True)
handles={}
for x in found:
 if x['pak'] not in handles:handles[x['pak']]=parse_pak(str(GAME/x['pak']))
lib=ctypes.CDLL(str(ROOT/'tools/zstd/zstd-v1.5.7-win64/dll/libzstd.dll'));lib.ZSTD_decompress.restype=ctypes.c_size_t;lib.ZSTD_decompress.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_void_p,ctypes.c_size_t];lib.ZSTD_isError.argtypes=[ctypes.c_size_t]
import zlib
log=[]
for r in found:
 result=dict(path=r['path'],pak=r['pak'],size=int(r['size']),type=typ(r['path']))
 if int(r['size'])>100_000_000:continue
 try:
  f,entries,feature,chunks=handles[r['pak']];attr=int(r['attr']);ds=int(r['size']);p=OUT/'extracted'/r['path'];p.resolve().relative_to((OUT/'extracted').resolve())
  if (attr>>16)&255:raise ValueError('encrypted')
  f.seek(int(r['offset']));b=f.read(int(r['compressed']));comp=attr&15
  if comp==1:b=zlib.decompress(b,-15)
  elif comp==2:
   dest=ctypes.create_string_buffer(ds);n=lib.ZSTD_decompress(dest,ds,b,len(b))
   if lib.ZSTD_isError(n):raise ValueError('zstd')
   b=dest.raw[:n]
  elif comp!=0:raise ValueError('compression')
  if len(b)!=ds:raise ValueError('size')
  p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);result.update(success=True,sha256=hashlib.sha256(b).hexdigest())
 except Exception as e:result.update(success=False,error=str(e))
 log.append(result)
csvout('supplemental_extraction_log.csv',log,['path','pak','type','size','success','sha256','error']);print('extracted',sum(x['success'] for x in log),'bytes',sum(x['size'] for x in log if x['success']),flush=True)
