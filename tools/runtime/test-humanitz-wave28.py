import importlib.util,json,pathlib,re,sys,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
SCRIPT=ROOT/'internal/panel/game_library/scripts'
class Humanitz(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
  egg=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['humanitz/egg-humanit-z.json']['egg']
  script=egg['scripts']['installation']['script']
  self.emitted=pathlib.Path(self.tmp.name)/'modules';self.emitted.mkdir()
  for m in re.finditer(r"cat > (\.voltra/[^\s]+) <<'([^']+)'\r?\n",script):
   body=script[m.end():];end=body.index('\n'+m[2]+'\n');(self.emitted/pathlib.Path(m[1]).name).write_text(body[:end]+'\n')
  self.assertTrue((self.emitted/'unreal_survival_runtime.py').exists())
  sys.path.insert(0,str(self.emitted));self.addCleanup(lambda:sys.path.remove(str(self.emitted)))
  for name in ('steam_template','native_console','native_config','unreal_survival_install','unreal_survival_runtime'):sys.modules.pop(name,None)
  spec=importlib.util.spec_from_file_location('humanitz_wave28_runtime',self.emitted/'humanitz_wave28_runtime.py');self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
  binary=self.root/'HumanitZServer/Binaries/Linux/HumanitZServer-Linux-Shipping';binary.parent.mkdir(parents=True);binary.write_bytes(b'fixture only')
  self.config=self.root/'HumanitZServer/GameServerSettings.ini'
  self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001'}
 def test_existing_native_authority(self):
  raw=b'\xef\xbb\xbf;keep\r\n[Host Settings]\r\nServerName=operator\r\nPassword=private-fixture\r\n[Other]\r\n+Array=x\r\n+Array=y\r\n';self.config.write_bytes(raw)
  argv,_,secrets=self.m.configure(self.root,self.env)
  self.assertEqual(self.config.read_bytes(),raw);self.assertFalse(any('servername=' in a for a in argv));self.assertIn('private-fixture',secrets)
 def test_seed_once(self):
  self.m.configure(self.root,self.env);raw=self.config.read_bytes();self.m.configure(self.root,{**self.env,'MAX_PLAYERS':'99'});self.assertEqual(raw,self.config.read_bytes())
 def test_refusal_unchanged(self):
  self.config.write_bytes(b'[Host Settings]\nPassword=x\n')
  with self.assertRaises(ValueError):self.m.configure(self.root,{**self.env,'QUERY_PORT':'28000'})
  self.assertEqual(self.config.read_bytes(),b'[Host Settings]\nPassword=x\n')
 def test_update_failure_does_not_launch(self):
  self.m.configure(self.root,self.env)
  with patch.object(self.m.Path,'cwd',return_value=self.root),patch.dict(self.m.os.environ,{**self.env,'AUTO_UPDATE':'1'},clear=True),patch.object(self.m,'install',side_effect=RuntimeError('fixture failure')),patch.object(self.m,'run') as run:
   with self.assertRaises(RuntimeError):self.m.main()
   run.assert_not_called()
 def test_update_success_reloads(self):
  with patch.object(self.m.Path,'cwd',return_value=self.root),patch.dict(self.m.os.environ,{**self.env,'AUTO_UPDATE':'1'},clear=True),patch.object(self.m,'install') as install,patch.object(self.m,'run',return_value=0) as run:
   self.assertEqual(self.m.main(),0);install.assert_called_once();run.assert_called_once()
 def test_actual_installer_restores_success_and_failure(self):
  installer=sys.modules['unreal_survival_install']
  self.m.configure(self.root,self.env)
  raw=b'; operator\r\n[Host Settings]\r\nPassword=private\r\n[Unknown]\r\n+Array=x\r\n+Array=y\r\n'
  self.config.write_bytes(raw)
  for failure in (False,True):
   def update(*args,**kwargs):
    self.config.write_bytes(b'publisher replacement')
    if failure:raise RuntimeError('fixture update failure')
   with patch.object(installer,'update',side_effect=update):
    if failure:
     with self.assertRaises(RuntimeError):installer.install(self.root,'humanitz',self.env)
    else:installer.install(self.root,'humanitz',self.env)
   self.assertEqual(self.config.read_bytes(),raw)
if __name__=='__main__':unittest.main()
