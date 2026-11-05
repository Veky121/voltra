"""Retarget retained source fixtures to the six canonical emissions; no stagers."""
from pathlib import Path
import subprocess,sys,json,os,shutil
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/game-parity-20261029/wave61-six-canonical-integration';BASE=ROOT/'artifacts/game-parity-20261029'
results=[]
def run(label,source):
 path=OUT/(label+'.py');path.write_text(source)
 p=subprocess.run([sys.executable,'-B',str(path)],cwd=ROOT,capture_output=True,text=True)
 (OUT/(label+'.log')).write_text(p.stdout+p.stderr)
 results.append({'name':label,'command':[sys.executable,'-B',str(path.relative_to(ROOT))],'exit':p.returncode,'log':label+'.log'})
def relocate(source,oldfile):
 return source.replace("Path(__file__).resolve().parents[2]",'Path('+repr(str(ROOT))+')').replace("pathlib.Path(__file__).resolve().parents[2]",'pathlib.Path('+repr(str(ROOT))+')')
# Imports compile and execute without publisher or native process calls.
for d in OUT.glob('emitted-*'):
 for f in d.glob('*.py'):
  code='import sys,importlib.util;sys.path.insert(0,'+repr(str(d))+');s=importlib.util.spec_from_file_location("emitted_import",'+repr(str(f))+');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)'
  p=subprocess.run([sys.executable,'-B','-c',code],capture_output=True,text=True)
  results.append({'name':'import '+str(f.relative_to(OUT)),'exit':p.returncode,'error':p.stderr})
s=(ROOT/'tools/runtime/test-goldsrc-wave60.py').read_text();s=relocate(s,'');s=s.replace("OUT=ROOT/'artifacts/game-parity-20261029/wave60-goldsrc-admission'",'OUT=Path('+repr(str(OUT))+')'.replace('Path(','pathlib.Path('));s=s.replace('OUT=Path(', 'OUT=pathlib.Path(');run('goldsrc',s)
for label,index,file in [('nuclear',2,'test-wave60-nuclear.py'),('solace',3,'test-wave60-solace.py')]:
 s=relocate((ROOT/'tools/runtime'/file).read_text(),'')
 if label=='nuclear':s=s.replace("BASE=pathlib.Path("+repr(str(ROOT))+")/'artifacts/game-parity-20261029/wave60-nuclear/emitted'",'BASE=pathlib.Path('+repr(str(OUT/'emitted-2'))+')')
 else:s=s.replace("OUT = ROOT / 'artifacts/game-parity-20261029/wave60-solace'",'OUT = Path('+repr(str(OUT/'solace-fixture'))+')');(OUT/'solace-fixture').mkdir(exist_ok=True);shutil.copytree(OUT/'emitted-3',OUT/'solace-fixture/emitted',dirs_exist_ok=True)
 run(label,s)
s=relocate((ROOT/'tools/runtime/test-starmade-wave60.py').read_text(),'').replace("out=repo/'artifacts/game-parity-20261029/wave60-starmade'",'out=Path('+repr(str(OUT))+')').replace("(out/'final/recipe-fragment.json')","(out/'profiles.pending.json')")
run('starmade',s)
s=(BASE/'wave60-nzportable/test_source.py').read_text();start=s.index('entry=json.loads');end=s.index('sys.path.insert(0,str(emitted))');s=s[:start]+"emitted=Path("+repr(str(OUT/'emitted-5'))+")\n"+s[end:];s=s.replace("(OUT/'test-results.json')","(Path("+repr(str(OUT))+ ")/'nzp-results.json')");run('nzportable',s)
s=(ROOT/'tools/runtime/test-fantasy-worlds.py').read_text()
s=s.replace("BASE = Path(os.environ.get('FANTASY_SCRIPTS', '/scripts'))",'BASE=Path('+repr(str(OUT/'emitted-3'))+')')
for f in (OUT/'emitted-3').iterdir():
 s=s.replace(repr(f.name.replace('_','-')),repr(f.name))
run('fantasy-siblings',s)
s=(BASE/'wave60-goldsrc-admission/sven-regressions.py').read_text();run('goldsrc-siblings',s)
(OUT/'tests.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2));sys.exit(any(x['exit'] for x in results))
