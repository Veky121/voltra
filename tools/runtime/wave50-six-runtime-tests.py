"""Focused source tests against canonical emitted helpers."""
import json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/game-parity-20261029/wave50-six-runtime-integration'
r=json.loads((OUT/'report.json').read_text());results=[]
for rec in r['recipes']:
 name=rec['name'];folder=OUT/name
 for p in list(folder.glob('*.py')):
  alias=folder/p.name.replace('_','-')
  if alias!=p:alias.write_bytes(p.read_bytes())
 test='test-wave48-valheim.py' if name=='valheim' else 'test-'+name+'-wave48.py'
 src=(ROOT/'tools/runtime'/test).read_text()
 # Existing fixtures keep their assertions, but load exact emitted modules.
 absolute=str(folder).replace('\\','/')
 src=src.replace("BASE/'internal/panel/game_library/scripts'",'Path('+repr(absolute)+')').replace("ROOT/'internal/panel/game_library/scripts'",'Path('+repr(absolute)+')').replace("Path('internal/panel/game_library/scripts')",'Path('+repr(absolute)+')').replace("Path('internal/panel/game_library/scripts/truck-trackmania-native.py')",'Path('+repr(absolute+'/truck-trackmania-native.py')+')').replace("Path('internal/panel/game_library/scripts/source-install.py')",'Path('+repr(absolute+'/source-install.py')+')')
 code='__file__='+repr(str(ROOT/'tools/runtime'/test))+'\n'+src
 p=subprocess.run([sys.executable,'-B','-c',code],cwd=ROOT,text=True,capture_output=True,timeout=120)
 (OUT/(name+'-tests.log')).write_text(p.stdout+p.stderr);results.append({'name':name,'exit_code':p.returncode,'log':name+'-tests.log'});print(name,p.returncode)
 bash=pathlib.Path('C:/Program Files/Git/bin/bash.exe')
 p=subprocess.run([str(bash),'-n',str(folder/'install.sh').replace('\\','/')],capture_output=True,text=True,timeout=30)
 (OUT/(name+'-syntax.log')).write_text(p.stdout+p.stderr);results.append({'name':name+' shell syntax','exit_code':p.returncode})
r['tests']=results;r['changed_files']=['internal/panel/game_library/overrides.json','internal/panel/game_library/scripts/valheim-vrising-install.py','tools/runtime/stage-vrising-wave48.py','tools/runtime/stage-zandronum-wave48.py','tools/runtime/test-vrising-wave48.py','tools/runtime/wave50-six-runtime-integration.py','tools/runtime/wave50-six-runtime-tests.py'];r['extra_changes']=['V Rising stager emits fixed shared installer on exact vanilla recipe','Zandronum stager avoids duplicate preflight on repeat staging'];r['source_sha256']={f:__import__('hashlib').sha256((ROOT/f).read_bytes()).hexdigest() for f in r['changed_files']};(OUT/'report.json').write_text(json.dumps(r,indent=2)+'\n')
