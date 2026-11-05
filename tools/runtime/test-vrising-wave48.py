"""Source-only V Rising regressions. No external process/network permitted."""
import importlib.util, json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch, Mock
BASE=Path(__file__).resolve().parents[2]
S=BASE/'internal/panel/game_library/scripts'
sys.dont_write_bytecode=True
for name in ('steam-template','native-config','enshrouded-proton','valheim-vrising-install','vrising-runtime'):
 spec=importlib.util.spec_from_file_location(name.replace('-','_'),S/(name+'.py'));mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod;spec.loader.exec_module(mod)
v=sys.modules['vrising_runtime'];installer=sys.modules['valheim_vrising_install']
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.env={'SERVER_PORT':'9876','VOLTRA_ALLOCATED_PORTS':'9876,9877,25575'}
  self.target=self.root/'save-data/Settings/ServerHostSettings.json'
  for obj,name in ((v.subprocess,'run'),(v.subprocess,'Popen'),(v.socket,'create_connection'),(installer,'acquire'),(installer,'update')):
   p=patch.object(obj,name,side_effect=AssertionError('External boundary forbidden'));p.start();self.addCleanup(p.stop)
  p=patch.object(v,'location',return_value=self.root/'mock-proton');p.start();self.addCleanup(p.stop)
  (self.root/'VRisingServer.exe').write_bytes(b'fixture')
 def configure(self):return v.configure(self.root,self.env)
 def seed(self):self.configure();return json.loads(self.target.read_text())
 def test_existing_authority_and_exact_bytes(self):
  data=self.seed();data.update(Name='Operator',Password='secret',SaveName='OperatorWorld',Unknown=[{'x':1},2]);data['Rcon'].update(Password='rcon-secret',Enabled=True,Unknown=[1,2])
  raw=('\ufeff'+json.dumps(data,ensure_ascii=False,indent=4)+'\r\n').encode();self.target.write_bytes(raw)
  args,env,secrets,log,rcon=self.configure();self.assertEqual(self.target.read_bytes(),raw);self.assertIn('secret',secrets);self.assertEqual(rcon,(25575,'rcon-secret'));self.assertNotIn('VR_PASSWORD',env)
 def test_refusal_unchanged(self):
  for raw in (b'{"Name":1,"name":2}',b'[]',b'{"x":NaN}',b'{"Rcon":[]}',b'{"Port":1234}',b'{"MaxConnectedUsers":[]}',b'{"Rcon":{"Enabled":[]}}',b'{"SaveName":"../escape"}'):
   self.target.parent.mkdir(parents=True,exist_ok=True);self.target.write_bytes(raw)
   with self.assertRaises((ValueError,TypeError)):self.configure()
   self.assertEqual(self.target.read_bytes(),raw)
 def test_preflight_no_writes(self):
  (self.root/'VRisingServer.exe').unlink();v.configure(self.root,self.env,preflight=True)
  self.assertEqual(list(self.root.iterdir()),[])
  for extra in ({'VR_SECURE':'yes'},{'VR_SAVE_NAME':'../escape'},{'SERVER_PORT':'70000','VOLTRA_ALLOCATED_PORTS':'70000,9877,25575'}):
   with self.assertRaises(ValueError):v.configure(self.root,{**self.env,**extra},preflight=True)
   self.assertEqual(list(self.root.iterdir()),[])
 def test_missing_binary_does_not_write(self):
  (self.root/'VRisingServer.exe').unlink()
  with self.assertRaises(ValueError):self.configure()
  self.assertEqual(list(self.root.iterdir()),[])
 def test_mock_update_success_failure_preserves_saves_mods(self):
  self.seed();protected={}
  for name in ('save-data/Saves/world.db','BepInEx/plugins/operator.dll'):
   p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator');protected[p]=p.read_bytes()
  for failure in (False,True):
   update=Mock(side_effect=RuntimeError('mock failure') if failure else None);run=Mock(return_value=0)
   with patch.object(installer,'install',update),patch.object(v,'run',run),patch.object(Path,'cwd',return_value=self.root),patch.dict(os.environ,{**self.env,'VOLTRA_STEAM_AUTO_UPDATE':'1'},clear=True):
    if failure:
     with self.assertRaises(RuntimeError):v.main()
     run.assert_not_called()
    else:self.assertEqual(v.main(),0);run.assert_called_once()
   for p,raw in protected.items():self.assertEqual(p.read_bytes(),raw)
 def test_invalid_before_update(self):
  with patch.object(installer,'install') as update,patch.object(Path,'cwd',return_value=self.root),patch.dict(os.environ,{**self.env,'VR_SECURE':'yes','VOLTRA_STEAM_AUTO_UPDATE':'1'},clear=True):
   with self.assertRaises(ValueError):v.main()
   update.assert_not_called();self.assertFalse(self.target.exists())
 def test_actual_installer_refuses_before_acquisition(self):
  for extra in ({'VR_SECURE':'yes'},{'VR_SAVE_NAME':'../escape'},{'SERVER_PORT':'70000'}):
   with self.assertRaises(ValueError):installer.install(self.root,'vrising',{**self.env,**extra})
   installer.update.assert_not_called();installer.acquire.assert_not_called()
   self.assertFalse(self.target.exists());self.assertFalse((self.root/'.voltra').exists())
 def test_actual_installer_success_failure_retention(self):
  self.seed();protected={}
  for name in ('save-data/Saves/world.db','BepInEx/plugins/operator.dll','save-data/Settings/ServerHostSettings.json'):
   p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True)
   if not p.exists():p.write_bytes(b'operator')
   protected[p]=p.read_bytes()
  for failure in (False,True):
   with patch.object(installer,'update',side_effect=RuntimeError('mock Steam failure') if failure else None) as update,patch.object(sys.modules['enshrouded_proton'],'provision',return_value={}),patch.object(installer.os,'chown',create=True):
    if failure:
     with self.assertRaises(RuntimeError):installer.install(self.root,'vrising',self.env)
    else:installer.install(self.root,'vrising',self.env)
    update.assert_called_once()
   for p,raw in protected.items():self.assertEqual(p.read_bytes(),raw)
 def test_secret_redaction(self):
  r=v.Redactor(['native-secret']);self.assertNotIn(b'native-secret',r.feed(b'native-secret\n',final=True))
if __name__=='__main__':unittest.main(verbosity=2)
