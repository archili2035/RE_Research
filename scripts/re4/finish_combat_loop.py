import pathlib,json,csv,hashlib,collections,re,sys
ROOT=pathlib.Path(__file__).resolve().parents[2];R=ROOT/'reports/RE4';O=R/'combat_loop'
def read(n):return json.loads((O/n).read_text(encoding='utf-8-sig'))
def save(n,x):(O/n).write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf8')
def outcsv(n,rows):
 with (O/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(dict.fromkeys(k for r in rows for k in r)));w.writeheader();w.writerows(rows)
errors=[];d=read('input_tree_resolved.json');ids={i['Index']:i for i in d['Instances']};root=d['Instances'][-1]['Fields'];infos=[ids[x['Ref']] for x in root['_ActionInfoList']];condinfo={ids[x['Ref']]['Fields']['_ID']:ids[x['Ref']] for x in root['_ConditionInfoList']}
def expand(x,seen=()):
 if isinstance(x,dict):
  if 'Ref' in x:
   k=x['Ref']
   if k in seen:return dict(x,Cycle=True)
   return expand(ids[k],seen+(k,))
  return {k:expand(v,seen) for k,v in x.items()}
 if isinstance(x,list):return [expand(v,seen) for v in x]
 return x
verified=[]
for obj in d['Nodes']:
 n=obj['Node'];f=n['Fields'];acts=[];links=[]
 for aid in f['_ActionIDs']:
  info=infos[aid];act=ids[info['Fields']['_Action']['Ref']]
  if info['Fields']['_NodeID']!=f['_ID']:errors.append('input action owner mismatch')
  acts.append(dict(ActionID=aid,Info=info,Action=expand(act)))
 for ref in f['_Links']:
  lk=ids[ref['Ref']]['Fields'];ci=lk['_ConditionID'];links.append(dict(**lk,ConditionInfo=expand(condinfo[ci]) if ci!=4294967295 else None))
 verified.append(dict(Node=n,Actions=acts,Links=links))
save('input_tree_verified.json',dict(Path=d['Path'],Nodes=verified))
# Verify local graph identities and expression wiring. Preserve unresolved GUIDs.
fsms=read('player_fsms.json');edge_count=0;unresolved=[];expression_nodes=0
for f in fsms:
 nodes={n['ID'] for n in f['Nodes']}
 if len(nodes)!=len(f['Nodes']):errors.append('duplicate node IDs:'+f['Path'])
 for n in f['Nodes']:
  for kind in ['States','Children','EntryTransitions','AllStates']:
   for e in n[kind]:
    edge_count+=1
    if e.get('TargetID') and e['TargetID'] not in nodes:errors.append('dangling state target:'+f['Path']+':'+e['TargetID'])
def variables(d):
 yield from d.get('Variables',[])
 for e in d.get('Embedded',[]):yield from variables(e)
for p in O.glob('*.expressions.json'):
 x=json.loads(p.read_text());vs=list(variables(x['Variables']))
 for sub in x['SubVariables']:vs.extend(variables(sub))
 for v in vs:
  ns=v.get('Expression') or [];expression_nodes+=len(ns);ni={n['nodeId'] for n in ns}
  for e in v.get('Connections') or []:
   if e['sourceId'] not in ni or e['targetId'] not in ni:errors.append('expression edge:'+v['guid'])
  if ns and v.get('OutputNode') not in ni:errors.append('expression output:'+v['guid'])
for row in csv.DictReader((O/'player_fsm_edges.csv').open(encoding='utf-8-sig')):
 if row['expression_guid'] and not row['expression_name']:unresolved.append(row)
outcsv('unresolved_expression_edges.csv',unresolved)
# Check stored source provenance.
manifest=read('source_manifest.json')
for m in manifest:
 p=R/'parsed'/(m['path']+'.json')
 if hashlib.sha256(p.read_bytes()).hexdigest()!=m['sha256']:errors.append('source changed:'+m['path'])
# A workflow sequence, not a fabricated runtime trace.
timeline=[
 dict(phase='输入请求',evidence='输入树 Node 51；ActionInfo 40/41/42',observed='请求 ShootTrigger；ResetDryFire；BookShoot',timing='无测量时刻',unknown='命令 1785394695 和 CheckType 0 的枚举语义'),
 dict(phase='射击许可',evidence='Tree_checkShootEnable；ShootEnable GUID',observed='变量、动作指令、Hold 相关条件、DryFire 回调和逻辑节点共同参与',timing='无可靠总延迟',unknown='逻辑操作码与游戏回调实现未完全解释'),
 dict(phase='弹药／武器分支',evidence='Shoot → checkAmmo → checkFullAutoGun',observed='有条件进入普通射击或 LOOP_SHOOT；空弹分支单列',timing='序列化转移',unknown='CheckCondition Target 4/5 未独立映射枚举'),
 dict(phase='动画与出弹',evidence='Node 11708713；Bank 2 Motion 500',observed='AppPlayMotion、GenerateShell、MuzzleFlash、GunFire、Rapid 动作并列存在',timing='Motion500/501/502 各声明50帧/60fps',unknown='Timing=0 的回调阶段及射速生效公式'),
 dict(phase='命中与敌人反应',evidence='wp4000shellinfo；ch1c0z0 头部／反应表',observed='独立 Damage/Wince/Break/Stopping；头部 Damage 覆盖1.2',timing='没有闭合到确定硬直帧',unknown='最终阈值、部位绑定与运行时修正完整链'),
 dict(phase='体术接近',evidence='KickApproachData Bank1000 Motion900',observed='3个距离配置分别使用BeginFrame35/25/15和插值10/15/20',timing='AdjustEndFrame43',unknown='有效命中帧与最终位移求值'),
 dict(phase='退出／恢复',evidence='Tree_checkUnderlayerShootCansel；Shoot→Hold',observed='下层结束、状态与动作条件；存在exitFrame和interpolationFrame',timing='不把转移参数等同于输入锁定时间',unknown='完整取消窗口和角色恢复移动的实测时刻')]
outcsv('action_timeline.csv',timeline)
validation=dict(source_files_checked=len(manifest),source_crc_warning_files=sum(bool(m['schema_mismatches']) for m in manifest),input_nodes_checked=len(verified),input_action_infos_checked=len(infos),input_condition_infos_checked=len(condinfo),fsm_files_checked=len(fsms),fsm_edges_checked=edge_count,expression_nodes_checked=expression_nodes,unresolved_expression_edges=len(unresolved),errors=errors)
save('validation.json',validation);print(json.dumps(validation,ensure_ascii=False,indent=2));assert not errors
