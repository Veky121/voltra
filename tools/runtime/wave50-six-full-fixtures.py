import json,pathlib,subprocess,sys
ROOT=pathlib.Path.cwd();OUT=ROOT/'artifacts/game-parity-20261029/wave50-six-runtime-integration';r=json.loads((OUT/'report.json').read_text());results=[]
for name,test in [('valheim','test-valheim-vrising.py'),('vrising','test-valheim-vrising.py'),('trackmania','test-truck-trackmania-native.py'),('urbanterror','test-quake-family.py'),('srb2','test-sonic-rimworld.py'),('zandronum','test-id-family.py')]:
 if len(sys.argv)>1 and name!=sys.argv[1]:continue
 sources={p.name.replace('-','_'):p.read_text() for p in (ROOT/'internal/panel/game_library/scripts').glob('*.py')}
 sources.update({p.name:p.read_text() for p in (ROOT/'internal/panel/game_library/scripts').glob('*.json')})
 for p in (OUT/name).iterdir():
  if p.suffix in ('.py','.json'):sources[p.name]=p.read_text()
 # Include hyphen filenames for importlib fixtures without changing emitted bytes.
 for filename,body in list(sources.items()):sources[filename.replace('_','-')]=body
 testsrc=(ROOT/'tools/runtime'/test).read_text().replace("Path('/repo/internal/panel/game_library/scripts')","Path('/helpers')").replace("Path('internal/panel/game_library/scripts')","Path('/helpers')").replace("Path('internal/panel/game_library/scripts/truck-trackmania-native.py')","Path('/helpers/truck-trackmania-native.py')").replace("ROOT/'internal/panel/game_library/scripts'","Path('/helpers')")
 testsrc=testsrc.replace("Path(__file__).resolve().parents[2]","Path('/workspace')")
 sources['test_full.py']=testsrc
 code="import json,pathlib,subprocess,sys\nsources=json.loads("+repr(json.dumps(sources))+ ")\nroot=pathlib.Path('/helpers');root.mkdir()\nfor name,body in sources.items():(root/name).write_text(body)\nsys.exit(subprocess.call([sys.executable,'-B','/helpers/test_full.py'],cwd=root))\n"
 args=['docker','run','--rm','-i','--pull','never','--network','none','--memory','384m','--cpus','1','--pids-limit','128','--mount','type=bind,source='+str(ROOT)+',target=/workspace,readonly','--cap-drop','ALL','--security-opt','no-new-privileges','python:3.13-slim','python3','-B','-']
 try:
  p=subprocess.run(args,input=code,text=True,capture_output=True,timeout=90);log=p.stdout+p.stderr;exitcode=p.returncode
 except subprocess.TimeoutExpired as e:log=str(e);exitcode=-1
 (OUT/(name+'-full-fixtures.log')).write_text(log);results.append({'name':name,'exit_code':exitcode,'log':name+'-full-fixtures.log'});print(name,exitcode)
r['full_helper_fixtures']=[x for x in r.get('full_helper_fixtures',[]) if x['name'] not in {y['name'] for y in results}]+results;r['utility']='Cached python:3.13-slim, --pull never --network none --rm, 384MiB/1CPU/128pids, timeout90s; synthetic helper processes only';(OUT/'report.json').write_text(json.dumps(r,indent=2)+'\n')
