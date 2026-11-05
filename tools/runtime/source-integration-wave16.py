"""Exact source integration; never runs an installer or acquires payloads."""
import ast,copy,difflib,hashlib,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]; BASE=ROOT/'artifacts/game-parity-20261029'; OUT=BASE/'root-wave16-source-integration'; CANON=ROOT/'internal/panel/game_library/overrides.json'
INPUTS=[('nitrox-update-followup','profile-proposal.json'),('levilamina-installer-followup','profile.pending.json'),('liteloader-bootstrap-followup','profile.pending.json'),('exiled-integration-followup','profiles.pending.json')]
def sha(b):return hashlib.sha256(b).hexdigest()
def prepare(before):
 result=copy.deepcopy(before); rows=[]
 for owner,file in INPUTS:
  path=BASE/owner/file;key,p=next(iter(json.loads(path.read_text(encoding='utf-8-sig')).items()));old=before[key];new=copy.deepcopy(old)
  assert p.get('defaults')==old.get('defaults') and p['egg']['docker_images']==old['egg']['docker_images']
  # Preserve every existing record, including duplicate names and its position.
  additions=[v for v in p['egg']['variables'] if v['env_variable'] not in {x['env_variable'] for x in old['egg']['variables']}]
  new['egg']['variables']=copy.deepcopy(old['egg']['variables'])+additions
  new['egg']['startup']=p['egg']['startup'];new['egg']['scripts']['installation']=copy.deepcopy(p['egg']['scripts']['installation'])
  script=new['egg']['scripts']['installation']['script'];modules={}
  pattern=r"(cat > [^\n]*?/([^/\s\"]+)\"? <<'([^']+)'\n)(.*?)(\n\3(?:\n|$))"
  def normalize(m):
   name=m[2];body=m[4]
   if name in ('native_config.py','native-config.py'):body=(ROOT/'internal/panel/game_library/scripts/native-config.py').read_text(encoding='utf-8-sig').rstrip('\n')
   modules[name]=body
   return m[1]+body+m[5]
  script=re.sub(pattern,normalize,script,flags=re.S);new['egg']['scripts']['installation']['script']=script
  for name,body in modules.items():
   if name.endswith('.py'):compile(body,name,'exec')
  imports={}
  names={n.removesuffix('.py') for n in modules}
  for name,body in modules.items():
   if not name.endswith('.py'):continue
   found=set()
   for node in ast.walk(ast.parse(body)):
    if isinstance(node,ast.Import):found.update(a.name.split('.')[0] for a in node.names)
    elif isinstance(node,ast.ImportFrom) and node.module:found.add(node.module.split('.')[0])
   imports[name]=sorted(found-sys.stdlib_module_names-names)
  result[key]=new;rows.append(dict(recipe=key,owner=owner,candidate=str(path.relative_to(ROOT)),candidate_sha256=sha(path.read_bytes()),emitted_sha256={n:sha(b.encode()) for n,b in modules.items()},non_stdlib_or_dynamic_import_review=imports,added_controls=additions))
 return result,rows
if __name__=='__main__':
 OUT.mkdir(exist_ok=True);raw=CANON.read_bytes();before=json.loads(raw);after,rows=prepare(before);again,_=prepare(after);assert after==again
 snapshot=OUT/'baseline-overrides.json'
 if not snapshot.exists():snapshot.write_bytes(raw)
 for row in rows:
  k=row['recipe'];(OUT/(row['owner']+'-exact.diff')).write_text(''.join(difflib.unified_diff(json.dumps(before[k],indent=2).splitlines(True),json.dumps(after[k],indent=2).splitlines(True),fromfile='before/'+k,tofile='after/'+k)),encoding='utf-8')
 assert all(before[k]==after[k] for k in before if k not in {r['recipe'] for r in rows})
 if '--apply' in sys.argv:
  assert CANON.read_bytes()==raw;CANON.write_text(json.dumps(after,indent=2)+'\n',encoding='utf-8')
 (OUT/'integration.json').write_text(json.dumps(rows,indent=2)+'\n');print('Profiles',len(rows),'repeatable; applied', '--apply' in sys.argv)
