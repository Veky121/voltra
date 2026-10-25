#!/usr/bin/env python3
import importlib.util,io,json,os,signal,subprocess,sys,tempfile,unittest,select,time
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];SCRIPTS=ROOT/'internal/panel/game_library/scripts'
spec=importlib.util.spec_from_file_location('wasteland_servers',SCRIPTS/'wasteland-servers.py');adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
class Wasteland(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
 def plains(self):return self.put('EULA.txt',(ROOT/'artifacts/plains-of-pain-publisher-EULA.txt').read_bytes())
 def env(self,**changes):return {'PLAINS_ACCEPT_EULA':adapter.PINS['plains_eula']['sha256'],'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001',**changes}
 def put(self,name,data):
  path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);return path
 def identity(self,path):
  meta=path.stat();return path.read_bytes(),meta.st_mode&0o777,meta.st_uid,meta.st_gid
 def test_original44_controls_defaults_rules_permissions(self):
  catalog=json.loads((ROOT/'internal/panel/game_library/upstream/catalog.json').read_text());profiles=json.loads((ROOT/'.local/wasteland-servers/profiles.json').read_text());count=0
  for path,profile in profiles.items():
   old=next(e['egg'] for e in catalog['entries'] if e['path']==path);current={v['env_variable']:v for v in profile['egg']['variables']}
   for v in old['variables']:
    count+=1
    for key in ['default_value','rules','user_viewable','user_editable']:self.assertEqual(current[v['env_variable']][key],v[key])
   self.assertEqual(profile['verification'],'not_verified');self.assertEqual(profile['required_ports'],2)
  self.assertEqual(count,44)
 def test_private_gate_before_publisher_or_config(self):
  for game in adapter.GAMES:
   with patch.object(adapter.steam,'update') as update,self.assertRaises(ValueError):adapter.install(self.root,game,self.env(STEAM_PASS='private'))
   update.assert_not_called()
  self.assertEqual(list(self.root.iterdir()),[])
 def test_invalid_ports_or_extra_shell_before_writes(self):
  for values in [{'QUERY_PORT':'28000'},{'QUERY_PORT':'65536'},{'QUERY_PORT':'27015'},{'OTHER_ARGS':'$(touch /tmp/no)'},{'OTHER_ARGS':'-Port=9'}]:
   with self.subTest(values=values),self.assertRaises(ValueError):adapter.configure(self.root,'night',self.env(**values))
  self.assertEqual(list(self.root.iterdir()),[])
 def test_night_all_original_config_controls_correct_motd(self):
  argv,secrets,log=adapter.configure(self.root,'night',self.env(SERVER_NAME='Fixture',SERVER_PASSWORD='secret',SERVER_ADMIN_PASSWORD='admin',SERVER_SAVEGAME='OriginalSave',SERVER_MOTD='Correct MOTD',DIFFICULTY='Legend',PVP='0',OTHER_ARGS='-unattended -Custom="literal value"'))
  text=(self.root/'LF/Saved/Config/ServerSettings.ini').read_text()
  for value in ['ServerName= Fixture','Password= secret','SaveName= OriginalSave','IngameAdminPassword= admin','DefaultMessageOfTheDay= Correct MOTD','Difficulty= Legend','MODSelect= 0']:self.assertIn(value,text)
  self.assertIn('-Custom=literal value',argv);self.assertEqual(log,'LF/Saved/Logs/LF.log');self.assertEqual(secrets,('secret','admin'))
 def test_night_unknown_game_settings_and_mode_preserved(self):
  cfg=self.put('LF/Saved/Config/ServerSettings.ini',b';operator\n[serversettings]\nservername=old\n[GameSettings/Advanced]\nWorkshop=1\nWorkshop=2\n');cfg.chmod(0o640)
  adapter.configure(self.root,'night',self.env());text=cfg.read_text();self.assertIn(';operator',text);self.assertIn('Workshop=1\nWorkshop=2',text);self.assertEqual(text.count('ServerName'),1);self.assertEqual(cfg.stat().st_mode&0o777,0o640)
 def test_noone_all_original_config_controls(self):
  adapter.configure(self.root,'noone',self.env(STEAM_NETWORKING='True',SERVER_SAVE_NAME='OldSave',SERVER_NAME='Fixture',SERVER_NEED_PASSWORD='True',SERVER_PASSWORD='secret',SERVER_PLAYERS='100',SERVER_NUM_ZOMBIES='25',SERVER_REGION='EU',SERVER_ADMIN_PASSWORD='admin'))
  engine=(self.root/'WRSH/Saved/Config/WindowsServer/Engine.ini').read_text();game=(self.root/'WRSH/Saved/Config/WindowsServer/Game.ini').read_text()
  self.assertIn('bUseSteamNetworking = True',engine);self.assertIn('GameServerQueryPort = 28001',engine)
  for value in ['SaveName = OldSave','ServerName = Fixture','NeedPassword = True','Password = secret','MaxPlayers = 100','NumOfZombieSpawn = 25','Region = EU','AdminPassword = admin']:self.assertIn(value,game)
 def test_noone_bad_second_config_validates_before_first_write(self):
  engine=self.put('WRSH/Saved/Config/WindowsServer/Engine.ini',b';original\n');game=self.put('WRSH/Saved/Config/WindowsServer/Game.ini',b'[ServerSetting]\nServerName=a\nservername=b\n')
  with self.assertRaises(ValueError):adapter.configure(self.root,'noone',self.env())
  self.assertEqual(engine.read_bytes(),b';original\n');self.assertIn(b'ServerName=a',game.read_bytes())
 def test_plains_typed_json_unknown_admin_mod_settings(self):
  self.plains()
  self.put('configs/default.json',b'{"adminSteamIds":["operator"],"mods":{"keep":true},"saveFolder":"custom"}')
  argv,secrets,log=adapter.configure(self.root,'plains',self.env(WORLD_ID='7',WORLD_SIZE='51',DIFFICULTY='4',MAP_ID='256',SEED='-123',MAX_PLAYERS='200',SERVER_PASSWORD='secret'))
  value=json.loads((self.root/'configs/server.json').read_text());self.assertEqual(value['worldId'],7);self.assertEqual(value['worldSize'],51);self.assertEqual(value['seed'],-123);self.assertEqual(value['maxPlayers'],200);self.assertEqual(value['adminSteamIds'],['operator']);self.assertEqual(value['mods'],{'keep':True});self.assertEqual(value['saveFolder'],'custom');self.assertIsNone(log);self.assertNotIn('secret',repr(argv))
 def test_plains_invalid_schema_or_duplicate_not_silently_replaced(self):
  self.plains()
  config=self.put('configs/server.json',b'{"worldId":1,"worldId":2}')
  with self.assertRaises(ValueError):adapter.configure(self.root,'plains',self.env())
  self.assertEqual(config.read_bytes(),b'{"worldId":1,"worldId":2}')
 def test_native_signed_bounds_and_save_path_controls(self):
  self.plains()
  self.put('configs/default.json',b'{}')
  for game,values in [('plains',{'SEED':'2147483648'}),('night',{'SERVER_SAVEGAME':'../escape'}),('noone',{'SERVER_SAVE_NAME':'../escape'}),('night',{'SERVER_MOTD':'line\nPassword=x'})]:
   with self.subTest(game=game,values=values),self.assertRaises(ValueError):adapter.configure(self.root,game,self.env(**values))
 def test_failed_update_preserves_all_files_owner_mode(self):
  os.chown(self.root,12345,12346);save=self.put('LF/Saved/SaveGames/OriginalSave/world.sav',b'operator save');os.chown(save,12345,12346);save.chmod(0o640);before=self.identity(save)
  def update(*args,**kwargs):save.write_bytes(b'publisher modified');save.chmod(0o600);os.chown(save,0,0);raise RuntimeError('failed Steam update')
  with patch.object(adapter.steam,'update',side_effect=update),self.assertRaises(RuntimeError):adapter.install(self.root,'night',self.env())
  self.assertEqual(self.identity(save),before)
 def test_current_steam_receipt_new_bytes_owner_mode_not_stale_restore(self):
  os.chown(self.root,12345,12346);record=self.put('.voltra/steam-template-release.json',b'old build');os.chown(record,12345,12346);record.chmod(0o640);config=self.put('WRSH/Saved/Config/WindowsServer/Game.ini',b'operator config');before=self.identity(config)
  def update(*args,**kwargs):adapter.steam._publish(self.root,'.voltra/steam-template-release.json',lambda output:output.write(b'new build'));config.write_bytes(b'changed');return {'build':2}
  with patch.object(adapter.steam,'update',side_effect=update):result=adapter.install(self.root,'noone',self.env())
  self.assertEqual(result,{'build':2});self.assertEqual(self.identity(record),(b'new build',0o640,12345,12346));self.assertEqual(self.identity(config),before)
 def test_failed_restore_retains_recovery_and_other_restores(self):
  first=self.put('WRSH/Saved/SaveGames/first.sav',b'old first');second=self.put('WRSH/Saved/SaveGames/second.sav',b'old second');original=adapter.steam._publish
  def update(*args,**kwargs):first.write_bytes(b'new first');second.write_bytes(b'new second');return {}
  def publish(root,name,writer,default_mode=0o644):
   if name.endswith('first.sav'):raise PermissionError('injected failure')
   return original(root,name,writer,default_mode)
  with patch.object(adapter.steam,'update',side_effect=update),patch.object(adapter.steam,'_publish',side_effect=publish),self.assertRaisesRegex(RuntimeError,'recovery copies retained'):adapter.install(self.root,'noone',self.env())
  self.assertEqual(second.read_bytes(),b'old second');folders=list(self.root.glob('.wasteland-preserve-*'));self.assertEqual(len(folders),1);manifest=json.loads((folders[0]/'recovery.json').read_text());saved=manifest['files']['WRSH/Saved/SaveGames/first.sav'];self.assertEqual((folders[0]/saved['backup']).read_bytes(),b'old first')
 def test_mod_preservation_and_original_platforms(self):
  mod=self.put('BepInEx/plugins/custom.dll',b'operator');before=self.identity(mod)
  with patch.object(adapter.steam,'update',return_value={'build':9}) as update:adapter.install(self.root,'noone',self.env())
  self.assertEqual(self.identity(mod),before);self.assertEqual(update.call_args.kwargs['platform'],'windows');self.assertTrue(update.call_args.kwargs['force_platform'])
 def test_plains_default_bootstrap_only_when_missing_with_volume_owner(self):
  self.plains()
  os.chown(self.root,12345,12346);self.put('configs/default.json',b'{"publisher":true}')
  with patch.object(adapter.steam,'update',return_value={}):adapter.install(self.root,'plains',self.env())
  config=self.root/'configs/server.json';self.assertEqual(self.identity(config),(b'{"publisher":true}',0o600,12345,12346));config.write_bytes(b'{"operator":true}');before=self.identity(config)
  with patch.object(adapter.steam,'update',return_value={}):adapter.install(self.root,'plains',self.env())
  self.assertEqual(self.identity(config),before)
 def test_preservation_symlink_prevents_publisher_run(self):
  outside=self.root/'outside';outside.mkdir();(self.root/'LF').mkdir();(self.root/'LF/Saved').symlink_to(outside,target_is_directory=True)
  with patch.object(adapter.steam,'update') as update,self.assertRaises(ValueError):adapter.install(self.root,'night',self.env())
  update.assert_not_called()
 def test_explicit_sigint_and_raw_exit_for_each_game(self):
  for game in adapter.GAMES:
   if game=='plains':self.plains();self.put('configs/default.json',b'{}')
   with patch.object(adapter.wine,'prepare',return_value={'HOME':str(self.root)}),patch.object(adapter.console,'run',return_value=254) as run:
    code=adapter.run(self.root,game,self.env(AUTO_UPDATE='0'))
   self.assertEqual(code,254);self.assertEqual(run.call_args.kwargs['stop_signal'],signal.SIGINT);self.assertTrue(run.call_args.kwargs['terminal_input'])
 def test_log_does_not_replay_history_and_redacts_fragments(self):
  log=self.put('LF/Saved/Logs/LF.log',b'Successfully updated session historical\n');follower=adapter.logs.NativeLog(self.root,'LF/Saved/Logs/LF.log',('private-token',),adapter.steam);output=[];follower.scan(output.append);self.assertEqual(b''.join(output),b'')
  with log.open('ab') as stream:stream.write(b'fresh private-')
  follower.scan(output.append)
  with log.open('ab') as stream:stream.write(b'token\n')
  follower.scan(output.append);data=b''.join(output);self.assertIn(b'fresh',data);self.assertNotIn(b'private-token',data);self.assertNotIn(b'historical',data)
 def test_log_rejects_symlink_and_fifo_without_blocking(self):
  outside=self.put('outside.log',b'secret');target=self.root/'log';target.symlink_to(outside)
  with self.assertRaises((ValueError,OSError)):adapter.logs.NativeLog(self.root,'log',(),adapter.steam)
  target.unlink();os.mkfifo(target)
  with self.assertRaises(ValueError):adapter.logs.NativeLog(self.root,'log',(),adapter.steam)
 def test_log_rotation_and_truncation_follow_new_bytes(self):
  log=self.put('log',b'old');follower=adapter.logs.NativeLog(self.root,'log',(),adapter.steam);output=[];log.write_bytes(b'x');follower.scan(output.append);log.rename(self.root/'old.log');log.write_bytes(b'new\n');follower.scan(output.append);self.assertEqual(b''.join(output),b'xnew\n')
 def test_plains_agreement_exact_hash_before_any_update_config_or_native(self):
  for supplied in [None,'0','true','false',True,'1','9b8cab','f'*64]:
   env=self.env(PLAINS_ACCEPT_EULA=supplied,AUTO_UPDATE='1')
   for action in [adapter.install,adapter.configure,adapter.run]:
    with self.subTest(supplied=str(supplied),action=action.__name__),patch.object(adapter.steam,'update') as update,patch.object(adapter.console,'run') as native,patch.object(adapter,'write') as write,self.assertRaisesRegex(ValueError,'explicitly agree'):
     action(self.root,'plains',env)
    update.assert_not_called();native.assert_not_called();write.assert_not_called()
  self.assertEqual(list(self.root.iterdir()),[])
 def test_plains_exact_packaged_bytes_required_before_bootstrap(self):
  reviewed=(ROOT/'artifacts/plains-of-pain-publisher-EULA.txt').read_bytes()
  import hashlib
  self.assertEqual(hashlib.sha256(reviewed).hexdigest(),adapter.PINS['plains_eula']['sha256']);self.assertIn(b'\r\n',reviewed)
  self.put('configs/default.json',b'{"publisher":true}')
  for payload in [None,b'',reviewed.replace(b'\r\n',b'\n'),reviewed[:-1],bytes([reviewed[0]^1])+reviewed[1:],reviewed+b'x',b'x'*65537]:
   target=self.root/'EULA.txt'
   if target.exists():target.unlink()
   if payload is not None:target.write_bytes(payload)
   with self.subTest(size=None if payload is None else len(payload)),patch.object(adapter.steam,'update',return_value={}),self.assertRaises((ValueError,OSError)):
    adapter.install(self.root,'plains',self.env())
   self.assertFalse((self.root/'configs/server.json').exists())
  self.plains()
  with patch.object(adapter.steam,'update',return_value={'fixture':True}):self.assertEqual(adapter.install(self.root,'plains',self.env()),{'fixture':True})
  self.assertEqual((self.root/'configs/server.json').read_bytes(),b'{"publisher":true}')
 def test_plains_eula_link_directory_fifo_rejected_without_blocking(self):
  outside=self.put('operator-terms',b'outside');terms=self.root/'EULA.txt'
  for kind in ['symlink','directory','fifo']:
   if kind=='symlink':terms.symlink_to(outside)
   elif kind=='directory':terms.mkdir()
   else:os.mkfifo(terms)
   try:
    start=time.monotonic()
    with self.subTest(kind=kind),self.assertRaises((ValueError,OSError)):adapter.verify_plains_eula(self.root)
    self.assertLess(time.monotonic()-start,1)
   finally:
    if kind=='directory':terms.rmdir()
    else:terms.unlink()
 def test_plains_revised_terms_deny_launch_without_config_or_process_mutation(self):
  terms=self.plains();config=self.put('configs/server.json',b'{"operator":true}');config.chmod(0o640);before=self.identity(config)
  terms.write_bytes(b'x'*adapter.PINS['plains_eula']['bytes'])
  with patch.object(adapter.console,'run') as native,patch.object(adapter.steam,'update') as update,self.assertRaisesRegex(ValueError,'reviewed terms'):
   adapter.run(self.root,'plains',self.env(AUTO_UPDATE='0'))
  native.assert_not_called();update.assert_not_called();self.assertEqual(self.identity(config),before)
 def test_plains_consent_and_terms_checked_again_after_auto_update(self):
  self.plains();config=self.put('configs/server.json',b'{"operator":true}');before=self.identity(config)
  def changed(*args,**kwargs):(self.root/'EULA.txt').write_bytes(b'x'*adapter.PINS['plains_eula']['bytes']);return {}
  with patch.object(adapter.steam,'update',side_effect=changed),patch.object(adapter.console,'run') as native,self.assertRaisesRegex(ValueError,'reviewed terms'):
   adapter.run(self.root,'plains',self.env(AUTO_UPDATE='1'))
  native.assert_not_called();self.assertEqual(self.identity(config),before)
 def test_tiny_real_process_receives_sigint_not_etx_and_exit42_remains42(self):
  child="import signal,sys,os,time\nsignal.signal(signal.SIGINT,lambda *_:sys.exit(42))\nprint('TINY_NATIVE_READY',os.getpid(),os.getpgrp(),signal.pthread_sigmask(signal.SIG_BLOCK,[]),flush=True)\nwhile True: time.sleep(.02)\n"
  launcher="import importlib.util,sys,os,signal; from pathlib import Path; s=importlib.util.spec_from_file_location('wasteland_fixture',"+repr(str(SCRIPTS/'wasteland-servers.py'))+"); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); sys.exit(m.console.run(Path("+repr(str(self.root))+"),[sys.executable,'-u','-c',"+repr(child)+"],dict(os.environ),'\\x03',terminal_input=True,stop_signal=signal.SIGINT,stop_signal_timeout=2))"
  process=subprocess.Popen([sys.executable,'-u','-c',launcher],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True);data=b''
  try:
   deadline=time.monotonic()+8
   while b'TINY_NATIVE_READY' not in data and time.monotonic()<deadline:
    if select.select([process.stdout],[],[],.2)[0]:
     part=os.read(process.stdout.fileno(),65536)
     if not part:break
     data+=part
   self.assertIn(b'TINY_NATIVE_READY',data);process.send_signal(signal.SIGTERM);remaining,_=process.communicate(timeout=8);self.assertEqual(process.returncode,42,data+remaining)
  finally:
   if process.poll() is None:process.kill();process.communicate(timeout=3)
if __name__=='__main__':unittest.main()
