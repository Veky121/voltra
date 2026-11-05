"""Run existing assertions against canonical emitted modules, never games."""
import json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/game-parity-20261029/wave47-six-runtime-integration'
records=[]
def run(label,argv):
 p=subprocess.run(argv,cwd=ROOT,text=True,capture_output=True);(OUT/(label+'.log')).write_text(p.stdout+p.stderr);records.append({'label':label,'exit':p.returncode,'log':label+'.log'});print(label,p.returncode)
canonical=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())
for name,tests in {'gtac':['test-gtac-wave45.py','test-gtac.py'],'ragecoop':['test-ragecoop-wave45.py','test-ragecoop.py'],'ksp_dmp':['wave45-ksp-dmp-test.py','ksp-test.py'],'romestead':['test-wave45-romestead.py'],'rust_autowipe':['test-rust-autowipe-wave45.py']}.items():
 folder=OUT/name
 # Alias only names for existing tests that import repository source filenames.
 for file in list(folder.glob('*.py')):
  alias=folder/file.name.replace('_','-')
  if alias!=file:alias.write_bytes(file.read_bytes())
 recipe=next(r['recipe'] for r in json.loads((OUT/'integration.json').read_text())['recipes'] if r['name']==name)
 (folder/'profiles.json').write_text(json.dumps({recipe:canonical[recipe]}))
 for test in tests:
  src=(ROOT/'tools/runtime'/test).read_text()
  src=src.replace("BASE=Path('internal/panel/game_library/scripts')",'BASE=Path('+repr(str(folder))+')')
  src=src.replace("HELPERS=BASE/'internal/panel/game_library/scripts'",'HELPERS=pathlib.Path('+repr(str(folder))+')')
  src=src.replace("base=pathlib.Path('/helpers')",'base=pathlib.Path('+repr(str(folder))+')')
  src=src.replace("STAGE=ROOT/'artifacts/game-parity-20261029/wave45-romestead'",'STAGE=Path('+repr(str(folder))+')')
  src=src.replace("ROOT/'internal/panel/game_library/scripts/rust-install.py'",'Path('+repr(str(folder/'rust_install.py'))+')')
  code='__file__='+repr(str(ROOT/'tools/runtime'/test))+'\n'+src
  run(name+'-'+test,[sys.executable,'-B','-c',code])
for test in ['clusterio-config.test.mjs','clusterio-wave45.test.mjs']:
 src=(ROOT/'tools/runtime'/test).read_text().replace('../../internal/panel/game_library/scripts/clusterio-start.mjs','../../artifacts/game-parity-20261029/wave47-six-runtime-integration/clusterio/clusterio-start.mjs').replace("path.resolve('internal/panel/game_library/scripts')","path.resolve('artifacts/game-parity-20261029/wave47-six-runtime-integration/clusterio')")
 file=ROOT/'tools/runtime'/('wave47-'+test);file.write_text(src)
 try:run(test,['node','--test',str(file)])
 finally:file.unlink()
(OUT/'test-results.json').write_text(json.dumps(records,indent=2)+'\n')
