"""Run prior repair regressions against exact canonical emitted modules, offline."""
import importlib.util,io,json,re,socket,subprocess,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave43-two-runtime-integration'
spec=importlib.util.spec_from_file_location('wave43_stage',ROOT/'tools/runtime/stage-two-runtime-wave43.py');stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)
canonical=json.loads(stage.CANON.read_bytes())
def emitted(key):
 tag=stage.MODULES[key][0]
 return dict(re.findall(r"cat > \.voltra/([^ ]+) <<'"+tag+r"'\n(.*?)\n"+tag,canonical[key]['egg']['scripts']['installation']['script'],re.S))
class Integration(unittest.TestCase):
 def test_valid_preflight_without_installed_payload(self):
  path=root/'openrct2/small-native-runtime.py'
  spec=importlib.util.spec_from_file_location('open_fixture',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  with tempfile.TemporaryDirectory() as d:
   target=Path(d)
   with patch.object(m.urllib.request,'urlopen',side_effect=AssertionError('network')):
    m.configure_openrct2(target,{},preflight=True,installing=True)
   self.assertEqual(list(target.iterdir()),[])
  config=types.ModuleType('native_config');config.private_write=lambda *a: self.fail('write');console=types.ModuleType('native_console');console.run=lambda *a: self.fail('process')
  with patch.dict(sys.modules,native_config=config,native_console=console):
   m=types.ModuleType('java_fixture');exec(emitted('necesse/egg-necesse.json')['java_games_runtime.py'],m.__dict__)
   m.validate_necesse({'SERVER_PORT':'28017','VOLTRA_ALLOCATED_PORTS':'28017'})
 def test_preservation_and_repeated_staging(self):
  before=json.loads((OUT/'before.json').read_bytes())
  self.assertEqual(stage.stage(before),canonical)
  self.assertEqual(stage.stage(canonical),canonical)
  self.assertEqual({k for k in before if before[k]!=canonical[k]},set(stage.MODULES))
  for key,(tag,modules) in stage.MODULES.items():
   old=dict(re.findall(r"cat > \.voltra/([^ ]+) <<'"+tag+r"'\n(.*?)\n"+tag,before[key]['egg']['scripts']['installation']['script'],re.S))
   new=emitted(key)
   self.assertEqual(set(old),set(new))
   for name,body in new.items():
    if name in modules:self.assertEqual(body,(stage.S/modules[name]).read_text().rstrip('\n'))
    else:self.assertEqual(body,old[name])
   p=json.loads(json.dumps(canonical[key]));p['egg']['scripts']['installation']['script']=before[key]['egg']['scripts']['installation']['script'];self.assertEqual(p,before[key])
with tempfile.TemporaryDirectory(prefix='wave43-emitted-') as directory:
 root=Path(directory)
 for key in stage.MODULES:
  target=root/key.split('/')[0];target.mkdir()
  for name,body in emitted(key).items():(target/name).write_text(body+'\n',encoding='utf-8')
 suite=unittest.defaultTestLoader.loadTestsFromTestCase(Integration)
 for game,filename,cls in [('openrct2','test-openrct2-wave39.py','Repair'),('necesse','test-necesse-wave39.py','NecesseSourceTests')]:
  source=(ROOT/'tools/runtime'/filename).read_text()
  if game=='necesse':
   source=re.sub(r"PROFILE = .*?\nEMITTED = .*?\n",'PROFILE = canonical["necesse/egg-necesse.json"]\nEMITTED = emitted("necesse/egg-necesse.json")\n',source)
  module=types.ModuleType('wave43_'+game);module.__file__=str(ROOT/'tools/runtime'/filename);module.__dict__.update(canonical=canonical,emitted=emitted)
  exec(compile(source,filename,'exec'),module.__dict__)
  module.S=module.SCRIPTS=root/game
  if game=='openrct2':delattr(module.Repair,'test_staged_profile')
  if game=='necesse':
   # Source references use hyphens; emitted imports keep their exact underscore layout.
   for target in emitted('necesse/egg-necesse.json'):
    src=target.replace('_','-')
    (root/game/src).write_bytes((root/game/target).read_bytes())
  suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(getattr(module,cls)))
 def denied(*a,**k):raise AssertionError('external network/process boundary prohibited')
 with patch.object(socket,'socket',side_effect=denied),patch.object(socket,'create_connection',side_effect=denied),patch.object(subprocess,'Popen',side_effect=denied):
  result=unittest.TextTestRunner(verbosity=2).run(suite)
 if not result.wasSuccessful():sys.exit(1)
