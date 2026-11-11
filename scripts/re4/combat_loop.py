import pathlib,json,csv,hashlib,sys,re,collections
ROOT=pathlib.Path(__file__).resolve().parents[2];R=ROOT/'reports/RE4';B=R/'parsed/natives/stm/_chainsaw';O=R/'combat_loop';O.mkdir(exist_ok=True)
sys.path.insert(0,str(ROOT/'scripts/re9_monsters'));from pak_extract import murmur3_32
used={}
def load(rel):
 p=B/(rel+'.json');d=json.loads(p.read_text(encoding='utf8'));used[d['Path']]=dict(path=d['Path'],sha256=hashlib.sha256(p.read_bytes()).hexdigest(),schema_mismatches=d.get('SchemaMismatches',[]));return d
def save(n,x):(O/n).write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf8')
def csvout(n,rs):
 if not rs:return
 with (O/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(dict.fromkeys(k for r in rs for k in r)));w.writeheader();w.writerows(rs)
def index(d):return {i['Index']:i for i in d.get('Instances',[])}
def expand(d,obj,depth=0,seen=()):
 ids=index(d)
 def ex(x,depth,seen):
  if depth>18:return x
  if isinstance(x,dict):
   if 'Ref' in x:
    n=x['Ref']
    if n in seen:return dict(x,Cycle=True)
    return ex(ids[n],depth+1,seen+(n,))
   return {k:ex(v,depth+1,seen) for k,v in x.items()}
  if isinstance(x,list):return [ex(v,depth+1,seen) for v in x]
  return x
 return ex(obj,depth,seen)
# Explicit weapon identifier join.
equip=load('appsystem/weapon/weaponequipparamcataloguserdata.user.2');wr=next(i for i in equip['Instances'] if i['Fields'].get('_WeaponID')==4000);save('wp4000_equipment_expanded.json',dict(Path=equip['Path'],Root=expand(equip,wr)))
weapon=[]
for rel in ['appsystem/weapon/weaponcataloguserdata_1st.user.2','appsystem/prefab/weapon/wp4000.pfb.17','appsystem/shell/bullet/wp4000/wp4000shellgeneratoruserdata.user.2','appsystem/shell/bullet/wp4000/wp4000shellinfo.user.2']:
 d=load(rel);weapon.append(d)
save('weapon_resource_chain.json',weapon)
# Flatten parameters with exact instance identity.
params=[]
def scalars(d,instances=None):
 for i in instances if instances is not None else d.get('Instances',[]):
  for k,v in i.get('Fields',{}).items():
   if isinstance(v,(str,int,float,bool)) or v is None:params.append(dict(path=d['Path'],index=i['Index'],class_name=i['Class'],field=k,value=v))
scalars(equip,[i for i in equip['Instances'] if 0<i['Index']<=32])
for d in weapon[2:]:scalars(d)
common=load('appsystem/character/ch0common/userdata/commonparam/ch0commonparamuserdata.user.2');scalars(common)
for mode in ['assisted','hardcore','professional']:
 d=load('appsystem/character/ch0common/userdata/commonparam/ch0commonparamuserdata_'+mode+'.user.2');scalars(d)
kicks=[];ids=index(common)
for i in common['Instances']:
 if i['Class'].endswith('.FatalKickApproachData'):
  for k,v in i['Fields'].items():
   if isinstance(v,list):
    for ref in v:
     if isinstance(ref,dict) and 'Ref' in ref:kicks.append(dict(path=common['Path'],index=i['Index'],motion=i['Fields']['_MotionName'],bank=i['Fields']['_BankID'],motion_id=i['Fields']['_MotionID'],adjust_end_frame=i['Fields']['_AdjustEndFrame'],adjust_distance=i['Fields']['_AdjustDistance'],**ids[ref['Ref']]['Fields']))
csvout('kick_approach.csv',kicks)
# Conditions are retained as typed references; no guessed enum decoding.
cond=load('appsystem/character/ch0common/userdata/ch0commonmotionfsmconditionuserdata.user.2');keys={i['Fields']['_Key']:i for i in cond['Instances'] if i['Class'].endswith('ConditionData')};save('shoot_condition_keys.json',[dict(Key=k,Data=expand(cond,keys[k])) for k in [2830214703,3130057401,2294950129,1385585625,201734832,682497857] if k in keys])
inp=load('appsystem/character/ch0common/behaviortree/ch0commoninput_cs.user.2');acts={i['Fields']['v1_ID']:i for i in inp['Instances'] if 'v1_ID' in i['Fields']};nodes=[i for i in inp['Instances'] if i['Class'].endswith('AppBehaviorTreeUserData.Node')];inode=[]
for n in nodes:
 f=n['Fields'];aa=[acts.get(a,{'MissingActionID':a}) for a in f['_ActionIDs']]
 inode.append(dict(Node=n,Actions=aa,Links=expand(inp,f['_Links'])))
save('input_tree_resolved.json',dict(Path=inp['Path'],Nodes=inode,Instances=inp['Instances']))
# Body layer order, head external bindings, camera state selection.
for rel,n in [('appsystem/character/ch0a0z0/ch0a0z0_head.pfb.17','leon_head_bindings.json'),('appsystem/character/ch0a0z0/ch0a0z0_body.pfb.17','leon_body_bindings.json'),('appsystem/camera/playercameracontroller/ch0a0z0/ch0a0z0camerasetting.user.2','camera_bindings.json')]:
 d=load(rel);save(n,d)
for name in ['chbattlenormal','chholdhandgun','chfatalkick','chholddefault']:
 rel='appsystem/camera/playercameracontroller/ch0a0z0/'+name+'.user.2'
 if (B/(rel+'.json')).exists():d=load(rel);scalars(d)
# All four linked FSMs and their edges, resolving local expression GUIDs by file.
fsms=[];edges=[];actions=[];exprs={}
def vars_walk(d):
 yield from d.get('Variables',[])
 for e in d.get('Embedded',[]):yield from vars_walk(e)
for name in ['ch0common','ch0commonarm','ch0commonupperbody','ch0commonupperbodyadd']:
 d=load('appsystem/character/ch0common/motion/fsm/'+name+'.motfsm2.43');fsms.append(d)
 ex=json.loads((O/(name+'.motfsm2.43.expressions.json')).read_text());vs=list(vars_walk(ex['Variables']))
 for sub in ex['SubVariables']:vs.extend(vars_walk(sub))
 vm={v['guid']:v for v in vs};exprs[name]=vm
 for n in d['Nodes']:
  for a in n['Actions']:actions.append(dict(path=d['Path'],node_id=n['ID'],node=n['Name'],instance=a['Index'],class_name=a['Class'],enabled=a['Fields'].get('v0_Enabled'),fields=json.dumps(a['Fields'],ensure_ascii=False)))
  for kind in ['States','Children','EntryTransitions','AllStates']:
   for e in n[kind]:
    c=e.get('Condition') or {};guid=c.get('Fields',{}).get('v3_Expression');edges.append(dict(path=d['Path'],source_id=n['ID'],source=n['Name'],kind=kind,target_id=e.get('TargetID'),target=e['Target'],condition_class=c.get('Class'),expression_guid=guid,expression_name=vm.get(guid,{}).get('Name'),condition=json.dumps(c,ensure_ascii=False),transition=json.dumps(e.get('Transition'),ensure_ascii=False)))
save('player_fsms.json',fsms);csvout('player_fsm_edges.csv',edges);csvout('player_fsm_actions.csv',actions)
# Reactions, head/leg/default overrides, actual per-weapon modifier records.
enemy=[]
for name in ['ch1c0z0damagereactionuserdata','ch1c0z0weapondamagerateuserdatadefault','ch1c0z0weapondamagerateuserdatahead','ch1c0z0weapondamagerateuserdatalegs','ch1c0equipweaponstatusrateuserdata','ch1c0z0damagerateuserdata']:
 d=load('appsystem/character/ch1c0z0/userdata/'+name+'.user.2');enemy.append(d)
 if 'weapondamagerate' in name:scalars(d,[i for i in d['Instances'] if i['Fields'].get('_WeaponID')==4000])
 else:scalars(d)
save('enemy_reaction_chain.json',enemy)
d=load('appsystem/character/userdata/fatalrangeuserdata.user.2');save('fatal_ranges_expanded.json',dict(Path=d['Path'],Root=expand(d,d['Instances'][-1])))
# Loc40 encounter sample: preserve flags, no unsupported simultaneous population claim.
scene=load('leveldesign/location/loc40/level_loc40_100.scn.20');spawn=[]
for i in scene['Instances']:
 if i['Class']=='chainsaw.CharacterSpawnController':spawn.append(expand(scene,i))
save('loc40_100_spawn_controls.json',dict(Path=scene['Path'],SchemaMismatches=scene['SchemaMismatches'],Controllers=spawn,ClassCounts=collections.Counter(i['Class'] for i in scene['Instances'])))
d=load('leveldesign/location/loc40/chcxattr_loc40.scn.20');save('loc40_space_controls.json',dict(Path=d['Path'],Instances=[i for i in d['Instances'] if i['Class'].startswith('chainsaw.')],SchemaMismatches=d['SchemaMismatches']))
# Actual bank and tree references.
banks=[]
for rel in ['appsystem/character/ch0common/motion/ch0commonbank.motbank.3','animation/ch/cha0/motbank/cha0.motbank.3','animation/ch/cha0/motbank/cha0_wp4000.motbank.3']:
 banks.append(load(rel))
save('animation_bank_chain.json',banks)
trees=load('appsystem/character/ch0common/motion/list/cha_hold.motlist.663');save('hold_shoot_trees.json',dict(Path=trees['Path'],Entries=[e for e in trees['Entries'] if e['ID'] in [140,160,500]]))
for rel in ['animation/ch/cha0/motlist/cha0_wp4000h.motlist.663','animation/ch/cha0/motlist/cha0_general.motlist.663']:load(rel)
# Name hashes: candidates from actual names plus explicit hypotheses, all labelled.
names=collections.defaultdict(set)
for d in fsms:
 for n in d['Nodes']:names[n['Name']].add(d['Path'])
for p in (O/'uvar').rglob('*.json'):
 if p.name=='log.json':continue
 d=json.loads(p.read_text())
 for v in vars_walk(d):names[v['Name']].add(str(p.relative_to(R)))
for n in ['Hold','Shoot','Reload','FatalKick','GunFire']:names[n].add('explicit candidate; verify by hash only')
hr=[dict(name=n,hash=murmur3_32(n.encode('utf-16-le')),sources=' | '.join(sorted(src))) for n,src in names.items() if n]
csvout('name_hash_candidates.csv',hr);csvout('parameters.csv',params);save('source_manifest.json',list(used.values()))
save('summary.json',dict(source_files=len(used),source_schema_warning_files=sum(bool(x['schema_mismatches']) for x in used.values()),player_nodes=sum(len(d['Nodes']) for d in fsms),edges=len(edges),actions=len(actions),parameters=len(params),kick_distance_records=len(kicks),scene_spawn_controllers=len(spawn),named_expression_edges=sum(bool(e['expression_name']) for e in edges),expression_edges=sum(bool(e['expression_guid']) for e in edges),hash_candidates=len(hr)))
print((O/'summary.json').read_text())
