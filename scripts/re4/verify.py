import pathlib,csv,json,hashlib,random,re,sqlite3,math
O=pathlib.Path('reports/RE4');logs=[]
for n in ['extraction_log.csv','supplemental_extraction_log.csv']:logs+=list(csv.DictReader((O/n).open(encoding='utf-8-sig')))
success=[x for x in logs if x['success']=='True'];errors=[]
for r in success:
 p=O/'extracted'/r['path']
 if not p.exists() or p.stat().st_size!=int(r['size']):errors.append('missing/size:'+r['path'])
sample=random.Random(20261107).sample(success,min(128,len(success)))
for r in sample:
 if hashlib.sha256((O/'extracted'/r['path']).read_bytes()).hexdigest()!=r['sha256']:errors.append('sha256:'+r['path'])
links=[]
for m in re.finditer(r'\]\(([^)]+)\)',(O/'RE4_五维研究报告.md').read_text(encoding="utf-8-sig")):
 p=m[1]
 if not p.startswith('http'):
  links.append(p)
  if not (O/p).exists():errors.append('link:'+p)
c=sqlite3.connect(O/'research.sqlite');check=c.execute('PRAGMA quick_check').fetchone()[0];instances=c.execute('SELECT count(*) FROM instances').fetchone()[0];resources=c.execute('SELECT count(*) FROM resources').fetchone()[0];c.close()
if check!='ok':errors.append('sqlite:'+check)
motions=list(csv.DictReader((O/'motions_animation.csv').open()))
for m in motions:
 if float(m['fps'])<=0 or float(m['frames'])<0 or not math.isfinite(float(m['seconds'])):errors.append('invalid motion:'+m['name'])
fsm=[json.loads(x) for x in (O/'parse_log_fsm.jsonl').read_text(encoding="utf-8-sig").splitlines()]
if not all(x['Success'] for x in fsm):errors.append('fsm failures')
result=dict(extracted_files_length_checked=len(success),sha256_sample_checked=len(sample),report_links_checked=len(links),sqlite_quick_check=check,sqlite_resources=resources,sqlite_gameplay_instances=instances,motion_metadata_checked=len(motions),fsm_files_checked=len(fsm),errors=errors)
(O/'validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));assert not errors

