"""Exact six-recipe source integration. No native actions or status promotion."""
import copy, hashlib, json, pathlib, re
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave47-six-runtime-integration'
CAT=ROOT/'internal/panel/game_library/overrides.json'
NAMES=['clusterio','gtac','ragecoop','ksp_dmp','romestead','rust_autowipe']
def emissions(script):
 return {m[1]:m[3] for m in re.finditer(r"cat > .voltra/([^ ]+) <<'(VOLTRA_SOURCE|VOLTRA_HELPER)'\n(.*?)\n\2",script,re.S)}
def integrate():
 baseline=json.loads((OUT/'baseline.json').read_text()); current=json.loads(CAT.read_text()); result=copy.deepcopy(current); records=[]
 for name in NAMES:
  folder=ROOT/'artifacts/game-parity-20261029'/('wave45-'+name)
  staged=json.loads((folder/('profile.json' if name=='gtac' else 'profiles.json')).read_text());recipe,profile=next(iter(staged.items()))
  before=copy.deepcopy(baseline[recipe]); after=copy.deepcopy(profile)
  for p in [before,after]:
   for key in ['revision','verification','detail']:p.pop(key,None)
   p['egg']['scripts']['installation']['script']=''
  assert before==after,recipe+' metadata drift'
  script=profile['egg']['scripts']['installation']['script']
  # Prior stagers embedded Windows CRLF bytes in JSON strings. Confirm these
  # are newline-only differences before emitting valid LF shell heredocs.
  for filename,body in emissions(script).items():
   source=ROOT/'internal/panel/game_library/scripts'/filename
   if not source.exists():source=source.with_name(filename.replace('_','-'))
   if source.exists():assert body.replace('\r','').rstrip()==source.read_text().rstrip(),filename+' specialized emission needs review'
  script=script.replace('\r\n','\n')
  result[recipe]['egg']['scripts']['installation']['script']=script
  check=copy.deepcopy(result[recipe]);check['egg']['scripts']['installation']['script']=current[recipe]['egg']['scripts']['installation']['script'];assert check==current[recipe]
  out=OUT/name;out.mkdir(exist_ok=True)
  (out/'install.sh').write_text(script,newline='\n')
  for filename,body in emissions(script).items():
   (out/filename).write_text(body,newline='\n')
   if filename.endswith('.py'):compile(body,filename,'exec')
  records.append({'name':name,'recipe':recipe,'checks':json.loads((folder/'report.json').read_text())['checks'],'emitted_sha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in emissions(script).items()},'script_sha256':hashlib.sha256(script.encode()).hexdigest()})
 owned={r['recipe'] for r in records};assert all(current[k]==result[k] for k in current if k not in owned)
 CAT.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',newline='\n')
 (OUT/'integration.json').write_text(json.dumps({'recipes':records,'unrelated_count':len(current)-6,'metadata_unchanged':True},indent=2)+'\n')
 print('Integrated six exact installer scripts; preserved metadata and',len(current)-6,'other profiles')
if __name__=='__main__':integrate()

