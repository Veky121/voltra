#!/usr/bin/env python3
import importlib.util,json,os,tempfile,unittest,hashlib,io
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];SCRIPTS=ROOT/'internal/panel/game_library/scripts'
spec=importlib.util.spec_from_file_location('forest_survival',SCRIPTS/'forest-survival.py');adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
class ForestSurvival(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
 def env(self,**changes):return {'SERVER_PORT':'28000','QUERY_PORT':'28001','STEAM_PORT':'28002','BLOBSYNC_PORT':'28002','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002',**changes}
 def identity(self,path):
  info=path.stat();return path.read_bytes(),info.st_mode&0o777,info.st_uid,info.st_gid
 def put(self,name,data):
  path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);return path
 def world(self,name='Old',guid='11223344-5566-7788-99aa-bbccddeeff00'):
  root=self.root/adapter.SUN/'Worlds'/(name+'~'+guid);root.mkdir(parents=True);(root/'WorldSetting.json').write_text('{"keep":true}');return root
 def test_all_original_defaults_permissions_retained(self):
  catalog=json.loads((ROOT/'internal/panel/game_library/upstream/catalog.json').read_text());profiles=json.loads((ROOT/'.local/forest-survival/profiles.json').read_text());count=0
  for path,profile in profiles.items():
   original=next(row['egg'] for row in catalog['entries'] if row['path']==path);variables={v['env_variable']:v for v in profile['egg']['variables']}
   for old in original['variables']:
    count+=1
    for key in ['default_value','user_viewable','user_editable','rules']:self.assertEqual(variables[old['env_variable']][key],old[key])
   self.assertEqual(profile['verification'],'not_verified')
  self.assertEqual(count,40)
 def test_private_credentials_rejected_before_mutation(self):
  for game in adapter.GAMES:
   with patch.object(adapter.steam,'update') as update,self.assertRaises(ValueError):adapter.install(self.root,game,self.env(STEAM_PASS='private'))
   update.assert_not_called()
  self.assertEqual(list(self.root.iterdir()),[])
 def test_original_port_roles_reject_collisions_missing_overflow(self):
  for values in [{'QUERY_PORT':'28000'},{'STEAM_PORT':'27016'},{'QUERY_PORT':'65536'}]:
   with self.assertRaises(ValueError):adapter.configure(self.root,'forest',self.env(**values))
  self.assertEqual(list(self.root.iterdir()),[])
 def test_forest_original_controls_and_unknown_save_settings(self):
  config=self.put(adapter.FOREST_CONFIG,b'//operator comment\nslot 5\nserverAutoSaveInterval 7\nsaveFolderPath custom\nmodExtension keep\n');config.chmod(0o640)
  argv,secrets,ready=adapter.configure(self.root,'forest',self.env(SERVER_NAME='Fixture',STEAM_ACC='publisher-token',SERVER_PASS='secret',ADMIN_PASS='admin',INIT_TYPE='Continue',VAC='on',SERVER_DIFFICULTY='Hard'))
  text=config.read_text();self.assertIn('serverSteamAccount publisher-token',text);self.assertIn('serverPasswordAdmin admin',text);self.assertIn('initType Continue',text);self.assertIn('difficulty Hard',text);self.assertIn('slot 5\nserverAutoSaveInterval 7\nsaveFolderPath custom\nmodExtension keep',text);self.assertEqual(config.stat().st_mode&0o777,0o640);self.assertEqual(ready,b'Game autosave started');self.assertIn('publisher-token',secrets);self.assertEqual(argv[3],'wine')
 def test_forest_config_injection_duplicate_and_bounds(self):
  with self.assertRaises(ValueError):adapter.configure(self.root,'forest',self.env(SERVER_NAME='x\nallowCheats on'))
  self.put(adapter.FOREST_CONFIG,b'serverName old\nserverName duplicate\n')
  with self.assertRaises(ValueError):adapter.configure(self.root,'forest',self.env())
 def test_sons_typed_config_legacy_slot_and_owners_preserved(self):
  cfg=self.put('serverconfig/dedicatedserver.cfg',b'{"SaveMode":"continue","CustomGameModeSettings":{"TreesRegrowth":false},"Extension":7}');owners=self.put('serverconfig/ownerswhitelist.txt',b'76561198000000000\n')
  argv,secrets,ready=adapter.configure(self.root,'sons',self.env(SAVE_SLOT='0000000001',SKIP_TESTS='true',SRV_PW='secret',GAME_MODE='custom'))
  value=json.loads(cfg.read_text());self.assertEqual(value['SaveSlot'],1);self.assertIs(value['SkipNetworkAccessibilityTest'],True);self.assertEqual(value['CustomGameModeSettings'],{'TreesRegrowth':False});self.assertEqual(value['SaveMode'],'continue');self.assertEqual(value['Extension'],7);self.assertEqual(owners.read_bytes(),b'76561198000000000\n');self.assertNotIn('secret',repr(argv));self.assertEqual(secrets,('secret',));self.assertEqual(ready,b'#DSL Dedicated server loaded.')
 def test_sons_invalid_slot_and_blob_collision_fail_before_config(self):
  for values in [{'SAVE_SLOT':'2147483648'},{'BLOBSYNC_PORT':'28001'},{'SAVE_SLOT':'0'}]:
   with self.assertRaises(ValueError):adapter.configure(self.root,'sons',self.env(**values))
  self.assertEqual(list(self.root.iterdir()),[])
 def test_sunken_name_rename_keeps_admin_bans_world_metadata(self):
  world=self.world();admin=world/'AdminSteamIDs.txt';admin.write_bytes(b'operator\n');admin.chmod(0o640);before=self.identity(admin)
  target=adapter.world(self.root,self.env(SERVER_NAME='New'),False);self.assertEqual(target.name,'New~11223344-5566-7788-99aa-bbccddeeff00');self.assertEqual(self.identity(target/'AdminSteamIDs.txt'),before);self.assertEqual((target/'WorldSetting.json').read_text(),'{"keep":true}');self.assertFalse(world.exists())
 def test_sunken_duplicate_guid_and_traversal_never_delete_world(self):
  one=self.world('One');two=self.world('Two')
  with self.assertRaisesRegex(ValueError,'Multiple'):adapter.world(self.root,self.env(),False)
  self.assertTrue(one.is_dir());self.assertTrue(two.is_dir())
  with self.assertRaises(ValueError):adapter.world(self.root,self.env(SERVER_NAME='../outside'),False)
 def test_sunken_original_argv_controls_and_world_prerequisite(self):
  with self.assertRaisesRegex(ValueError,'Upload'):adapter.configure(self.root,'sunken',self.env())
  self.world('Pterodactyl World');argv,secrets,ready=adapter.configure(self.root,'sunken',self.env(REGION='eu',MAX_PLAYER='15',PASSWORD='private',SERVER_IP='127.0.0.1'))
  self.assertIn('-worldGuid',argv);self.assertEqual(argv[argv.index('-region')+1],'eu');self.assertEqual(argv[argv.index('-publicPort')+1],'28000');self.assertIn('private',secrets);self.assertIsInstance(ready,bytes)
 def test_failed_steam_update_restores_saves_owner_mode(self):
  os.chown(self.root,12345,12346);target=self.put('serverconfig/Saves/slot/save.json',b'actual operator save');os.chown(target,12345,12346);target.chmod(0o640);before=self.identity(target)
  def update(*args,**kwargs):target.write_bytes(b'publisher changed');os.chown(target,0,0);target.chmod(0o600);raise RuntimeError('publisher failed')
  with patch.object(adapter.steam,'update',side_effect=update),self.assertRaises(RuntimeError):adapter.install(self.root,'sons',self.env())
  self.assertEqual(self.identity(target),before)
 def test_successful_update_restores_admin_mods_and_new_receipt(self):
  target=self.put('BepInEx/plugins/custom.dll',b'operator plugin');target.chmod(0o640);before=self.identity(target)
  def update(*args,**kwargs):target.write_bytes(b'publisher changed');target.chmod(0o600);return {'new_build':42}
  with patch.object(adapter.steam,'update',side_effect=update):receipt=adapter.install(self.root,'sons',self.env())
  self.assertEqual(receipt,{'new_build':42});self.assertEqual(self.identity(target),before)
 def test_preservation_symlink_rejected_before_steam(self):
  outside=self.root/'outside';outside.mkdir();(self.root/'serverconfig').symlink_to(outside,target_is_directory=True)
  with patch.object(adapter.steam,'update') as update,self.assertRaises(ValueError):adapter.install(self.root,'sons',self.env())
  update.assert_not_called()
 def test_windows_platform_forced_before_anonymous_install(self):
  with patch.object(adapter.steam,'update',return_value={'new':True}) as update:adapter.install(self.root,'sons',self.env())
  self.assertEqual(update.call_args.kwargs['platform'],'windows');self.assertTrue(update.call_args.kwargs['force_platform']);self.assertEqual(update.call_args.kwargs['required'],('SonsOfTheForestDS.exe',))
 def test_sunken_sample_fetch_failure_never_publishes_partial_world(self):
  with patch.object(adapter.urllib.request,'urlopen',side_effect=OSError('download failure')),self.assertRaises(OSError):adapter.world(self.root,self.env(),True)
  self.assertFalse((self.root/adapter.SUN/'Worlds').exists())
 def sample(self):
  contents={'StartGameConfig.json':b'{"fixture":true}','WorldSetting.json':b'{"version":"fixture"}','world.json':b'opaque world fixture'}
  files=[{'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'git_blob_sha1':hashlib.sha1(('blob '+str(len(data))+'\0').encode()+data).hexdigest(),'url':'https://fixture.invalid/'+name} for name,data in contents.items()]
  return {'guid':'11223344-5566-7788-99aa-bbccddeeff00','files':files},contents
 def test_sunken_complete_sample_publication_owned_and_no_overwrite(self):
  sample,contents=self.sample();os.chown(self.root,12345,12346)
  with patch.dict(adapter.PINS,{'sample_world':sample}),patch.object(adapter.urllib.request,'urlopen',side_effect=lambda request,**kwargs:io.BytesIO(contents[request.full_url.rsplit('/',1)[1]])):
   target=adapter.world(self.root,self.env(),True)
  for name,data in contents.items():self.assertEqual(self.identity(target/name),(data,0o600,12345,12346))
  (target/'world.json').write_bytes(b'operator progressed world')
  with patch.object(adapter.urllib.request,'urlopen',side_effect=AssertionError('existing world must never download')):adapter.world(self.root,self.env(),True)
  self.assertEqual((target/'world.json').read_bytes(),b'operator progressed world')
 def test_sunken_member_failure_rolls_back_new_directory(self):
  sample,contents=self.sample();original=adapter.steam._publish
  def failure(root,name,writer,default_mode=0o644):
   if name.endswith('WorldSetting.json'):raise OSError('injected world publication failure')
   return original(root,name,writer,default_mode)
  with patch.dict(adapter.PINS,{'sample_world':sample}),patch.object(adapter.urllib.request,'urlopen',side_effect=lambda request,**kwargs:io.BytesIO(contents[request.full_url.rsplit('/',1)[1]])),patch.object(adapter.steam,'_publish',side_effect=failure),self.assertRaisesRegex(OSError,'injected'):adapter.world(self.root,self.env(),True)
  self.assertEqual(list((self.root/adapter.SUN/'Worlds').iterdir()),[])
 def test_sunken_sample_sha_mismatch_rejected_before_any_publication(self):
  sample,contents=self.sample();sample['files'][0]['sha256']='0'*64
  with patch.dict(adapter.PINS,{'sample_world':sample}),patch.object(adapter.urllib.request,'urlopen',side_effect=lambda request,**kwargs:io.BytesIO(contents[request.full_url.rsplit('/',1)[1]])),self.assertRaisesRegex(ValueError,'identity mismatch'):adapter.world(self.root,self.env(),True)
  self.assertEqual(list(self.root.iterdir()),[])
 def test_failed_restore_keeps_recovery_copies_and_restores_other_files(self):
  first=self.put('serverconfig/Saves/slot/first.json',b'first original');second=self.put('serverconfig/Saves/slot/second.json',b'second original');original=adapter.steam._publish
  def update(*args,**kwargs):first.write_bytes(b'changed first');second.write_bytes(b'changed second');return {'new_build':9}
  def publication(root,name,writer,default_mode=0o644):
   if name.endswith('first.json'):raise PermissionError('injected restoration denial')
   return original(root,name,writer,default_mode)
  with patch.object(adapter.steam,'update',side_effect=update),patch.object(adapter.steam,'_publish',side_effect=publication),self.assertRaisesRegex(RuntimeError,'recovery copies retained'):adapter.install(self.root,'sons',self.env())
  self.assertEqual(second.read_bytes(),b'second original');folders=list(self.root.glob('.forest-preserve-*'));self.assertEqual(len(folders),1);manifest=json.loads((folders[0]/'recovery.json').read_text());entry=manifest['files']['serverconfig/Saves/slot/first.json'];self.assertEqual((folders[0]/entry['backup']).read_bytes(),b'first original');self.assertIn('serverconfig/Saves/slot/first.json',manifest['failed_paths'])
 def test_original_control_c_uses_explicit_sigint_and_preserves_raw_exit(self):
  with patch.object(adapter.wine,'prepare',return_value={'HOME':str(self.root)}),patch.object(adapter.console,'run',return_value=254) as run:
   result=adapter.run(self.root,'forest',self.env(AUTO_UPDATE='0'))
  self.assertEqual(result,254);self.assertEqual(run.call_args.kwargs['stop_signal'],adapter.signal.SIGINT);self.assertTrue(run.call_args.kwargs['terminal_input']);self.assertEqual(run.call_args.args[3],'\x03');self.assertIsInstance(run.call_args.kwargs['ready_marker'],bytes)
if __name__=='__main__':unittest.main()
