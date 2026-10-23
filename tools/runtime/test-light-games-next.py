import importlib.util,pathlib,sys,tempfile,unittest,json,os,hashlib,io
from contextlib import redirect_stdout
from unittest.mock import patch
base=pathlib.Path('/helpers');sys.path.insert(0,str(base))
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,base/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
steam=load('steam_template','steam-template.py');load('native_config','native-config.py');load('native_console','native-console.py');runtime=load('light_games_next_runtime','light-games-next-runtime.py');installer=load('light_games_next_install','light-games-next-install.py')
class Native(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001'}
 def tearDown(self):self.tmp.cleanup()
 def test_nuclear_types_and_original_controls(self):
  argv,_,stop,secrets,_=runtime.configure(self.root,'nuclear',{**self.env,'MAX_PLAYERS':'20','MODDED_SERVER':'true','SERVER_NAME':'literal $(nope)','SERVER_PASSWORD':'private'})
  value=json.loads((self.root/'DedicatedServerConfig.json').read_text());self.assertEqual(value['ServerName'],'literal $(nope)');self.assertIs(value['ModdedServer'],True);self.assertEqual(value['QueryPort'],{'IsOverride':True,'Value':28001});self.assertEqual(stop,'\x03');self.assertEqual(secrets,['private']);self.assertIn('-DedicatedServer',argv)
 def test_preserves_unknown_rotation_and_bans(self):
  path=self.root/'DedicatedServerConfig.json';path.write_text(json.dumps({'MissionRotation':[{'custom':True}],'BanListPaths':['mine.txt'],'Extension':17}));runtime.configure(self.root,'nuclear',self.env);value=json.loads(path.read_text());self.assertEqual(value['MissionRotation'],[{'custom':True}]);self.assertEqual(value['BanListPaths'],['mine.txt']);self.assertEqual(value['Extension'],17);self.assertEqual(len(list((self.root/'.voltra/light-games-next/backups').glob('*'))),1)
 def test_puck_controls_and_publisher_launcher(self):
  argv,_,_,_,_=runtime.configure(self.root,'puck',{**self.env,'MAX_PLAYERS':'32','KICK_TIMEOUT':'0','FRAME_RATE':'380','SERVER_TICK_RATE':'360','CLIENT_TICK_RATE':'720','SRV_PASSWORD':'pw'})
  value=json.loads((self.root/'server_configuration.json').read_text());self.assertEqual([value[x] for x in ['maxPlayers','kickTimeout','targetFrameRate','serverTickRate','clientTickRate']],[32,0,380,360,720]);self.assertTrue(argv[1].endswith('start_server.sh'));self.assertEqual(value['password'],'pw')
 def test_banana_selected_folder_token_and_literal_argv(self):
  argv,_,stop,_,_=runtime.configure(self.root,'banana',{**self.env,'SERVER':'Mine','STEAM_GSLT':'token','SERVER_NAME':'LAN'})
  value=json.loads((self.root/'Servers/Mine/Config.json').read_text());self.assertEqual(value['Server']['Login_Token'],'token');self.assertEqual(value['Server']['STEAM_GSLT'],'token');self.assertEqual(argv[argv.index('+ServerName')+1],'Mine');self.assertEqual(stop,'quit')
 def test_noop_keeps_bytes_and_metadata(self):
  runtime.configure(self.root,'puck',self.env);path=self.root/'server_configuration.json';before=path.stat().st_mtime_ns;runtime.configure(self.root,'puck',self.env);self.assertEqual(path.stat().st_mtime_ns,before)
 def test_duplicate_json_rejected(self):
  (self.root/'server_configuration.json').write_text('{"port":1,"port":2}')
  with self.assertRaises(ValueError):runtime.configure(self.root,'puck',self.env)
 def test_symlink_and_traversal_rejected(self):
  (self.root/'server_configuration.json').symlink_to('/tmp/outside')
  with self.assertRaises(ValueError):runtime.configure(self.root,'puck',self.env)
  with self.assertRaises(ValueError):runtime.configure(self.root,'banana',{**self.env,'SERVER':'../escape'})
 def test_query_not_silently_remapped(self):
  for query in ['7777','28000']:
   with self.assertRaises(ValueError):runtime.configure(self.root,'nuclear',{**self.env,'QUERY_PORT':query})
 def test_private_gate_precedes_writes(self):
  with patch.object(steam,'update') as update:
   with self.assertRaises(ValueError):installer.install(self.root,'banana',{'STEAM_PASS':'secret'})
   update.assert_not_called();self.assertEqual(list(self.root.iterdir()),[])
 def test_failed_validate_restores_exact_bytes_mode(self):
  path=self.root/'server_configuration.json';original=b'\xef\xbb\xbf{ "custom": true }\r\n';path.write_bytes(original);path.chmod(0o640)
  def fail(*args,**kwargs):path.write_text('{}');raise RuntimeError('publisher failure')
  with patch.object(steam,'update',side_effect=fail):
   with self.assertRaises(RuntimeError):installer.install(self.root,'puck',{})
  self.assertEqual(path.read_bytes(),original);self.assertEqual(path.stat().st_mode & 0o777,0o640)
 def test_main_native_console_contract_bytes_and_raw_exit(self):
  previous=os.getcwd();os.chdir(self.root)
  try:
   with patch.dict(os.environ,{**self.env,'AUTO_UPDATE':'0'},clear=True),patch.object(sys,'argv',['runtime','nuclear']),patch.object(runtime,'run',return_value=37) as console:
    self.assertEqual(runtime.main(),37);self.assertIsInstance(console.call_args.kwargs['ready_marker'],bytes);self.assertIn('-logFile',console.call_args.args[1]);self.assertEqual(console.call_args.args[1][console.call_args.args[1].index('-logFile')+1],'-')
  finally:os.chdir(previous)
 def test_shared_receipt_publication_not_overridden_by_family(self):
  if os.geteuid()!=0:self.skipTest('Root installer metadata fixture')
  receipt=self.root/'.voltra/steam-template-release.json';receipt.parent.mkdir();receipt.write_text('{"buildid":1}');receipt.chmod(0o640);os.chown(receipt,988,988)
  def update(*args,**kwargs):
   receipt.unlink();receipt.write_text('{"buildid":2}');receipt.chmod(0o400);os.chown(receipt,1234,1234);return {'buildid':2}
  with patch.object(steam,'update',side_effect=update),patch.object(installer,'build_puck_plugin'):installer.install(self.root,'puck',{})
  self.assertEqual(json.loads(receipt.read_text())['buildid'],2);self.assertEqual(receipt.stat().st_uid,1234);self.assertEqual(receipt.stat().st_gid,1234);self.assertEqual(receipt.stat().st_mode & 0o777,0o400)
 def test_managed_auto_update_uses_original_derived_setting(self):
  previous=os.getcwd();os.chdir(self.root)
  try:
   with patch.dict(os.environ,{**self.env,'AUTO_UPDATE':'0','VOLTRA_STEAM_AUTO_UPDATE':'1'},clear=True),patch.object(sys,'argv',['runtime','nuclear']),patch.object(runtime,'run',return_value=0),patch.object(installer,'install') as install:
    runtime.main();install.assert_called_once();self.assertIs(install.call_args.args[3],False)
  finally:os.chdir(previous)
 def test_puck_migrates_current_native_controls_and_public_phases(self):
  runtime.configure(self.root,'puck',{**self.env,'FRAME_RATE':'130','SERVER_TICK_RATE':'90','CLIENT_TICK_RATE':'270'})
  current=json.loads((self.root/'server_config.json').read_text());legacy=json.loads((self.root/'server_configuration.json').read_text());public=json.loads((self.root/'public_game_mode_config.json').read_text())
  self.assertEqual(current['tickRate'],270);self.assertEqual(legacy['serverTickRate'],90);self.assertEqual(current['port'],28000);self.assertEqual(current['mods'][0],{'id':'3493628417','isEnabled':False,'isClientRequired':False});self.assertEqual(public['phaseDurationMap']['Play'],300);self.assertEqual(public['phaseDurationMap']['Intermission'],15);self.assertIn('PreGame',public['phaseDurationMap'])
 def test_puck_fragmented_native_proof_and_scene_readiness_both_required(self):
  env={**self.env,'SERVER_TICK_RATE':'100','CLIENT_TICK_RATE':'360','FRAME_RATE':'120','KICK_TIMEOUT':'300'};observer=runtime.PuckObserver(env)
  payload={'serverPhysicsTick':100,'advertisedClientInputTick':360,'engineTargetFrameRate':120,'configuredKickTimeout':300,'probedNativeKickTweenSeconds':300.0,'nativeQueryPort':28001,'nativeQueryListening':True,'failure':None}
  line=('[VoltraLegacyControls] Native proof '+json.dumps(payload)+'\n').encode()
  with redirect_stdout(io.StringIO()) as output:
   observer(line[:19]);observer(line[19:]);self.assertFalse(observer.emitted);observer(b'Puck B1235 is ready to accept clients on localhost\n')
  self.assertTrue(observer.emitted);self.assertEqual(output.getvalue().count('Voltra Puck compatibility ready'),1)
 def test_puck_mismatched_native_control_refuses_ready(self):
  observer=runtime.PuckObserver({**self.env,'SERVER_TICK_RATE':'100','CLIENT_TICK_RATE':'360','FRAME_RATE':'120','KICK_TIMEOUT':'300'})
  with self.assertRaises(ValueError):observer(b'[VoltraLegacyControls] Native proof {"serverPhysicsTick":99}\n')
  self.assertFalse(observer.emitted)
 def test_unchanged_puck_update_keeps_compiled_plugin_without_compiler_process(self):
  names=['Puck_Data/Managed/Puck.dll','Puck_Data/Managed/0Harmony.dll','.voltra/puck_legacy_controls.cs','.voltra/puck_legacy_controls.csproj','Plugins/VoltraLegacyControls/VoltraLegacyControls.dll'];hashes={}
  for name in names:
   path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'public fixture');hashes[name]=hashlib.sha256(path.read_bytes()).hexdigest()
  (self.root/'.voltra/puck-compat-release.json').write_text(json.dumps({'sha256':hashes}))
  with patch.object(installer.subprocess,'run') as process:installer.build_puck_plugin(self.root);process.assert_not_called()
if __name__=='__main__':unittest.main()
