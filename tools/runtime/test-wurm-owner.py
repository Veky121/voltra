"""Extract actual staged installer heredocs, then test emitted imports and behavior."""
import json,re,tempfile,sys,unittest,importlib,os
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
TMP=tempfile.TemporaryDirectory(prefix='wurm-emitted-')
DEST=Path(TMP.name)
profile=json.loads((ROOT/'artifacts/game-parity-20261029/wave30-wurm/recipe-fragment.json').read_text())['wurm_unlimited/egg-wurm-unlimited.json']
script=profile['egg']['scripts']['installation']['script']
for match in re.finditer(r"cat > (\S+) <<'([^']+)'\n(.*?)\n\2",script,re.S):
    target=DEST/Path(match[1]).name
    target.write_text(match[3],encoding='utf-8')
sys.path.insert(0,str(DEST))
w=importlib.import_module('wurm_owner')
class Wurm(unittest.TestCase):
 def setUp(self):
    self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
    (self.root/'WurmServerLauncher').write_text('native fixture');(self.root/'WurmServerLauncher').chmod(0o700)
    self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001'}
 def tearDown(self): self.tmp.cleanup()
 def test_seed_and_native_edits(self):
    w.configure(self.root,self.env)
    target=self.root/'LaunchConfig.ini';target.write_bytes(b'; unknown\r\nCleanLogsOnStart = false  \r\nSecret=keep\r\n')
    old=target.read_bytes();argv,_,_=w.configure(self.root,self.env)
    self.assertEqual(target.read_bytes(),old)
    self.assertEqual(argv[1:5],['ip=0.0.0.0','externalport=28000','start=dist/Adventure','maxplayers=25'])
 def test_refuse_before_writes_or_acquisition(self):
    for change in ({'MAX_PLAYERS':'0'},{'QUERY_PORT':'28000'},{'PVP':'yes'},{'SERVER_WORLD':'../outside'},{'SERVERPWD':'x\nsecret'}):
      with patch.object(w,'shared_install',side_effect=AssertionError('must not acquire')):
       with self.assertRaises(ValueError):w.install(self.root,{**self.env,**change})
      self.assertFalse((self.root/'LaunchConfig.ini').exists())
 def test_parser_refusals(self):
    for raw in (b'CleanLogsOnStart=true\ncleanlogsonstart=false',b'CleanLogsOnStart=yes',b'[Runtime]\nUnknown=1',b'\x00'):
      with self.assertRaises(ValueError):w.launch_config(raw,'true')
 def test_mocked_update_retains_world_and_launcher_success_failure(self):
    import stationeers_wurm_starbound_install as shared
    for fail in (False,True):
      world=self.root/'dist/Adventure';world.mkdir(parents=True,exist_ok=True);(world/'save').write_bytes(b'operator save')
      target=self.root/'LaunchConfig.ini';old=b';keep\r\nCleanLogsOnStart=false\r\n';target.write_bytes(old)
      def operation():
       world.mkdir(parents=True);(world/'save').write_bytes(b'publisher')
       target.write_bytes(b'publisher launcher')
       if fail: raise RuntimeError('mock publisher failure')
       return {'build':'mock'}
      def acquire(root,kind,env): return shared.preserve_wurm_update(root,env,operation)
      with patch.object(w,'shared_install',side_effect=acquire):
       if fail:
        with self.assertRaises(RuntimeError):w.install(self.root,self.env)
       else:self.assertEqual(w.install(self.root,self.env),{'build':'mock'})
      self.assertEqual(target.read_bytes(),old);self.assertEqual((world/'save').read_bytes(),b'operator save')
if __name__=='__main__':
 try:unittest.main()
 finally:TMP.cleanup()
