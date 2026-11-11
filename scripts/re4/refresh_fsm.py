import pathlib,json,csv,sqlite3,collections
O=pathlib.Path('reports/RE4')
def write(n,rows):
 with (O/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(dict.fromkeys(k for r in rows for k in r)));w.writeheader();w.writerows(rows)
nodes=[];edges=[];schema=[r for r in csv.DictReader((O/'schema_mismatches.csv').open(encoding='utf-8-sig')) if '.motfsm2.' not in r['path']];c=sqlite3.connect(O/'research.sqlite');sections=0;fsminstances=0
for p in (O/'parsed').rglob('*.motfsm2.*.json'):
 d=json.loads(p.read_text());path=d['Path'];mm=d.get('SchemaMismatches',[]);schema.extend(dict(path=path,**x) for x in mm);sections+=len(d.get('RszSections',[]));fsminstances+=sum(len(x['Instances']) for x in d.get('RszSections',[]));c.execute('UPDATE resources SET schema_issues=? WHERE path=?',(len(mm),path))
 for nd in d['Nodes']:
  nodes.append(dict(path=path,id=nd['ID'],name=nd['Name'],full_name=nd['FullName'],parent=nd['Parent'],parent_id=nd.get('ParentID'),actions=json.dumps(nd['Actions'])))
  for kind in ['Children','States','EntryTransitions','AllStates']:
   for e in nd.get(kind,[]):edges.append(dict(path=path,source=nd['FullName'],source_id=nd['ID'],kind=kind,target=e.get('Target'),target_id=e.get('TargetID'),condition=json.dumps(e.get('Condition')),transition=json.dumps(e.get('Transition'))))
c.commit();c.close();write('state_nodes.csv',nodes);write('state_edges.csv',edges);write('schema_mismatches.csv',schema)
s=json.loads((O/'research_summary.json').read_text());s.update(state_edges=len(edges),schema_mismatch_resources=len(set(x['path'] for x in schema)),schema_mismatch_classes=len(set(x['Class'] for x in schema)),fsm_rsz_sections=sections,fsm_rsz_instances=fsminstances);(O/'research_summary.json').write_text(json.dumps(s,indent=2));print(json.dumps(s,indent=2))
