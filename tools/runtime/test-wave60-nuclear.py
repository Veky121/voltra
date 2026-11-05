import pathlib,sys,unittest,tempfile,os,json,runpy,importlib,hashlib
from unittest.mock import patch
BASE=pathlib.Path(__file__).resolve().parents[2]/'artifacts/game-parity-20261029/wave60-nuclear/emitted'
sys.path.insert(0,str(BASE))
r=importlib.import_module('light_games_next_runtime');i=importlib.import_module('light_games_next_install');s=importlib.import_module('steam_template')
class Nuclear(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.previous=os.getcwd();os.chdir(self.root)
  self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001','AUTO_UPDATE':'1'}
 def tearDown(self):os.chdir(self.previous);self.tmp.cleanup()
 def snapshot(self):return {str(p.relative_to(self.root)):(p.read_bytes(),p.stat().st_mode,p.stat().st_uid,p.stat().st_gid) for p in self.root.rglob('*') if p.is_file()}
 def entry(self,name,env):
  with patch.dict(os.environ,env,clear=True),patch.object(sys,'argv',[name,'nuclear']):return runpy.run_path(str(BASE/name),run_name='__main__')
 def test_actual_emitted_entrypoints_refuse_before_publisher_and_writes(self):
  for name in ['light_games_next_install.py','light_games_next_runtime.py']:
   for change in [{'QUERY_PORT':'28000'},{'QUERY_PORT':'7777'},{'MAX_PLAYERS':'oops'},{'STEAM_PASS':'private'}]:
    with self.subTest(name=name,change=change),patch.object(s,'update') as update,patch.object(s,'_publish') as publish,patch.object(r,'run') as process:
     before=self.snapshot()
     with self.assertRaises(ValueError):self.entry(name,{**self.env,**change})
     update.assert_not_called();publish.assert_not_called();process.assert_not_called();self.assertEqual(before,self.snapshot())
 def test_malformed_duplicate_and_symlink_refuse_before_acquisition(self):
  path=self.root/'DedicatedServerConfig.json'
  for content in ['{','{"Password":"a","Password":"b"}','[]']:
   path.write_text(content)
   with patch.object(s,'update') as update:
    with self.assertRaises(ValueError):i.install(self.root,'nuclear',self.env)
    update.assert_not_called()
  path.unlink();path.symlink_to(self.root/'outside')
  with patch.object(s,'update') as update:
   with self.assertRaises(ValueError):i.install(self.root,'nuclear',self.env)
   update.assert_not_called()
 def test_seed_once_ports_and_secret_console_contract(self):
  r.configure(self.root,'nuclear',self.env)
  path=self.root/'DedicatedServerConfig.json';value=json.loads(path.read_text());value.update(ServerName='Owner',Password='owner-secret',MaxPlayers=12,ModdedServer=True,Extension={'keep':1},MissionRotation=[{'owner':True}]);path.write_text(json.dumps(value));path.chmod(0o640)
  argv,env,stop,secrets,ready=r.configure(self.root,'nuclear',{**self.env,'SERVER_PORT':'28002','VOLTRA_ALLOCATED_PORTS':'28002,28001'})
  got=json.loads(path.read_text())
  for key in ['ServerName','Password','MaxPlayers','ModdedServer','Extension','MissionRotation']:self.assertEqual(got[key],value[key])
  self.assertEqual(got['Port']['Value'],28002);self.assertEqual(secrets,['owner-secret']);self.assertEqual(stop,'\x03');self.assertIn('Waiting for Players',ready);self.assertEqual(path.stat().st_mode&0o777,0o640)
  redactor=s.Redactor(secrets);self.assertNotIn(b'owner-secret',redactor.feed(b'owner-secret',final=True))
 def test_mocked_publisher_success_failure_preserves_operator_bytes_metadata(self):
  path=self.root/'DedicatedServerConfig.json';original=b'\xef\xbb\xbf{ "Password": "owner-secret", "unknown": 1 }\r\n';path.write_bytes(original);path.chmod(0o640)
  for relative in ['NuclearOption-Missions/operator.txt','ban-owner.txt','save/owner.dat','mods/owner.dat']:
   p=self.root/relative;p.parent.mkdir(exist_ok=True);p.write_bytes(b'operator')
  before=self.snapshot()
  for failure in [False,True]:
   def publisher(*args,**kwargs):
    path.write_text('{}')
    if failure:raise RuntimeError('mock acquisition failure')
    return {'mock':True}
   with patch.object(s,'update',side_effect=publisher):
    if failure:
     with self.assertRaises(RuntimeError):i.install(self.root,'nuclear',self.env)
    else:i.install(self.root,'nuclear',self.env)
   self.assertEqual(before,self.snapshot())
 def test_actual_emitted_success_entrypoints(self):
  console=importlib.import_module('native_console')
  with patch.object(s,'update',return_value={'mock':True}) as update:
   self.entry('light_games_next_install.py',self.env);update.assert_called_once()
  with patch.object(i,'install') as install,patch.object(console,'run',return_value=0) as process:
   with self.assertRaises(SystemExit) as exit:self.entry('light_games_next_runtime.py',self.env)
   self.assertEqual(exit.exception.code,0);install.assert_called_once();process.assert_called_once()
 def test_runtime_caller_update_before_console_and_native_password_redacted(self):
  r.configure(self.root,'nuclear',self.env)
  with patch.object(i,'install') as install,patch.object(r,'run',return_value=7) as run,patch.dict(os.environ,self.env,clear=True),patch.object(sys,'argv',['runtime','nuclear']):
   self.assertEqual(r.main(),7);install.assert_called_once();self.assertFalse(install.call_args.args[3]);self.assertEqual(run.call_args.kwargs['credentials'],['ChangeMe']);self.assertIsInstance(run.call_args.kwargs['ready_marker'],bytes)
if __name__=='__main__':unittest.main(verbosity=2)
