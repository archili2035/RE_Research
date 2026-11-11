import pathlib,json,csv,collections,re,sqlite3,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[2];O=ROOT/'reports/RE4'
def readcsv(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
def writecsv(name,rows,keys=None):
 if not rows and keys is None:return
 with (O/name).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=keys or list(rows[0]),extrasaction='ignore');w.writeheader();w.writerows(rows)
def save(n,x):(O/n).write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf8')
inv=readcsv(O/'effective_inventory.csv');by_path={r['path']:r for r in inv if r['path']}
writecsv('unknown_entries.csv',[r for r in inv if not r['path']])
counts=collections.Counter((r['path'].split('/')[2] if r['path'] else 'unknown',r['type']) for r in inv)
writecsv('content_type_counts.csv',[dict(content=k[0],type=k[1],count=v) for k,v in sorted(counts.items())])
chars={};locs={}
for r in inv:
 p=r['path'];m=re.search(r'/character/(ch[^/]+)/',p)
 if m and '/lipsync/' not in p:
  key=(p.split('/')[2],m[1]);c=chars.setdefault(key,collections.Counter());c[r['type']]+=1
 m=re.search(r'/location/(loc[^/]+)/',p)
 if m:
  key=(p.split('/')[2],m[1]);c=locs.setdefault(key,collections.Counter());c[r['type']]+=1
writecsv('character_catalog.csv',[dict(content=k[0],character=k[1],resources=sum(v.values()),types=json.dumps(v)) for k,v in sorted(chars.items())])
writecsv('location_catalog.csv',[dict(content=k[0],location=k[1],resources=sum(v.values()),scenes=v['scn'],types=json.dumps(v)) for k,v in sorted(locs.items())])
# Search database preserves raw fields and source; classification is a discovery aid, not an entity count.
db=sqlite3.connect(O/'research.sqlite');db.executescript('DROP TABLE IF EXISTS resources; DROP TABLE IF EXISTS instances; CREATE TABLE resources(path TEXT PRIMARY KEY,pak TEXT,type TEXT,content TEXT,instances INT,schema_issues INT); CREATE TABLE instances(path TEXT,idx INT,class TEXT,fields TEXT,userdata TEXT);')
classes=collections.Counter();camera=[];rank=[];damage=[];parry=[];curves=[];schema=[];nodes=[];edges=[];scenes=[];bankrefs=[];motionlists=[];parsed=0
for fp in (O/'parsed').rglob('*.json'):
 d=json.loads(fp.read_text(encoding='utf8'));p=d['Path'];meta=by_path.get(p,{});ins=d.get('Instances',[]);mismatch=d.get('SchemaMismatches',[])
 db.execute('INSERT OR REPLACE INTO resources VALUES(?,?,?,?,?,?)',(p,meta.get('pak'),meta.get('type'),p.split('/')[2],len(ins),len(mismatch)))
 schema.extend(dict(path=p,**x) for x in mismatch)
 instances={i['Index']:i for i in ins}
 for i in ins:
  cls=i['Class'];f=i.get('Fields',{});classes[cls]+=1
  if cls.startswith('chainsaw.') and '/lipsync/' not in p and '/sound/' not in p:
   db.execute('INSERT INTO instances VALUES(?,?,?,?,?)',(p,i['Index'],cls,json.dumps(f,ensure_ascii=False),i.get('Userdata')))
  base=dict(path=p,index=i['Index'],class_name=cls,schema_issues=len(mismatch))
  if cls=='chainsaw.PlayerCameraParam':
   camera.append(dict(base,**{k:f.get(k) for k in ['_JointName','_FieldOfView','_GazeDistance','_Offset','_PitchRangeDeg','_CollisionRadius','_EnableTightFollow']}))
  if cls=='chainsaw.GameRankSystem.RankSetDataClass':rank.append(dict(base,**f))
  if cls=='chainsaw.CharacterWeaponDamageRateUserData.Data':damage.append(dict(base,**f))
  if cls.endswith('ParryKnifeReduceActionData'):parry.append(dict(base,**f))
  if cls.endswith('RankParamInfo') and 'RankCurve' in f:
   ref=f['RankCurve'];curve=instances.get(ref.get('Ref'),{}).get('Fields',{}) if isinstance(ref,dict) else {}
   curves.append(dict(base,key=f.get('_KeyName'),keys=json.dumps(curve.get('Keys',[])),caption=f.get('Caption')))
 if meta.get('type')=='scn':
  cs=collections.Counter(i['Class'] for i in ins);scenes.append(dict(path=p,instances=len(ins),objects=len(d.get('Objects',[])),schema_issues=len(mismatch),spawn_instances=sum(v for k,v in cs.items() if 'Spawn' in k),gameplay_classes=json.dumps({k:v for k,v in cs.items() if k.startswith('chainsaw.')})))
 for nd in d.get('Nodes',[]):
  nodes.append(dict(path=p,id=nd.get('ID'),name=nd.get('Name'),full_name=nd.get('FullName'),parent=nd.get('Parent'),actions=json.dumps(nd.get('Actions',[]))))
  for kind in ['Children','States','EntryTransitions','AllStates']:
   for e in nd.get(kind,[]):edges.append(dict(path=p,source=nd.get('FullName'),source_id=nd.get('ID'),kind=kind,target=e.get('Target'),target_id=e.get('TargetID'),condition=json.dumps(e.get('Condition')),transition=json.dumps(e.get('Transition'))))
 if meta.get('type')=='motbank':
  for e in d.get('Entries',[]):bankrefs.append(dict(source=p,bank_id=e['BankID'],bank_type=e['BankType'],target=e['Path']))
 if meta.get('type')=='motlist':motionlists.append(dict(path=p,name=d.get('MotListName'),base=d.get('BaseMotListPath'),slots=len(d.get('Entries',[])),kinds=json.dumps(collections.Counter(e['Kind'] for e in d.get('Entries',[])))))
 parsed+=1
 if parsed%10000==0:db.commit();print('analysis',parsed,flush=True)
db.executescript('CREATE INDEX instance_class ON instances(class); CREATE INDEX instance_path ON instances(path);');db.commit();db.close()
for n,r in [('camera_parameters.csv',camera),('rank_mapping.csv',rank),('weapon_damage_rates.csv',damage),('parry_costs.csv',parry),('enemy_rank_curves.csv',curves),('schema_mismatches.csv',schema),('state_nodes.csv',nodes),('state_edges.csv',edges),('scene_catalog.csv',scenes),('motion_bank_refs.csv',bankrefs),('motion_lists.csv',motionlists)]:
 keys=list(dict.fromkeys(k for x in r for k in x));writecsv(n,r,keys)
writecsv('class_counts.csv',[dict(class_name=k,instances=v) for k,v in classes.most_common()])
logs=[]
for name in ['parse_log_all.jsonl','parse_log_animation.jsonl']:
 logs.extend(json.loads(x) for x in (O/name).read_text().splitlines())
fail=[x for x in logs if not x['Success']];save('parse_failures.json',fail)
ex=readcsv(O/'extraction_log.csv')+readcsv(O/'supplemental_extraction_log.csv');motions=readcsv(O/'motions_animation.csv')
summary=dict(effective_entries=len(inv),resolved_effective=sum(bool(r['path']) for r in inv),unknown=sum(not r['path'] for r in inv),extracted_files=sum(x['success']=='True' for x in ex),extracted_bytes=sum(int(x['size']) for x in ex if x['success']=='True'),parse_attempts=len(logs),parse_success=sum(x['Success'] for x in logs),parse_failures=len(fail),parsed_json_files=parsed,schema_mismatch_resources=len(set(x['path'] for x in schema)),schema_mismatch_classes=len(set(x['Class'] for x in schema)),motion_records=len(motions),motion_lists=len(motionlists),bank_references=len(bankrefs),state_nodes=len(nodes),state_edges=len(edges),camera_parameter_records=len(camera),rank_curve_records=len(curves),damage_rate_records=len(damage),character_resource_groups=len(chars),location_resource_groups=len(locs),scene_records=len(scenes))
save('research_summary.json',summary);print(json.dumps(summary,indent=2),flush=True)
# Hash all inputs and executable used, without re-reading 61GB of PAK payload.
sources=[]
for p in list((ROOT/'references/RE4').glob('*'))+[ROOT/'tools/REE.PAK.Tool/Projects/RE4_STM_Release.list',ROOT/'scripts/re4/Parser/bin/Release/net8.0/REE-Lib.dll']:
 if p.is_file():sources.append(dict(path=str(p),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
save('source_hashes.json',sources)
