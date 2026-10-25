#!/usr/bin/env python3
"""Source-only behavior fixtures; these do not prove a running game."""
import importlib.util,io,json,sys,tarfile,tempfile,unittest,os,hashlib
from pathlib import Path
from unittest.mock import patch
SCRIPTS=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
for name in ['steam_template','native_console','native_config','session_servers_runtime','session_servers_install']:
 spec=importlib.util.spec_from_file_location(name,SCRIPTS/(name.replace('_','-')+'.py'));module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
runtime=sys.modules['session_servers_runtime'];install=sys.modules['session_servers_install']

class SessionServers(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
 def env(self,**extra):return {'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,40783',**extra}
 def test_scp_original_localadmin_exit(self):
  argv,env,stop,ready=runtime.launch(self.root,'scp',self.env())
  self.assertEqual(argv,[str(self.root/'LocalAdmin'),'28000','--useDefault']);self.assertEqual(stop,'EXIT');self.assertIsInstance(ready,bytes);self.assertEqual(env['HOME'],str(self.root));self.assertEqual(env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'],str(self.root/'dotnet-bundle'))
 def test_scp_wizard_fresh_defaults_do_not_accept_terms_or_write_config(self):
  argv,env,_,_=runtime.launch(self.root,'scp',self.env())
  self.assertEqual(argv[-1],'--useDefault');self.assertNotIn('ACCEPT_SCPSL_EULA',env);self.assertNotIn('--acceptEULA',argv);self.assertEqual(list(self.root.iterdir()),[])
 def test_scp_wizard_existing_per_port_or_global_never_override(self):
  for name in ['28000/config_localadmin.txt','config_localadmin_global.txt']:
   with self.subTest(name=name):
    p=self.root/'.config/SCP Secret Laboratory/config'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator\r\n');p.chmod(0o640);before=self.identity(p)
    self.assertNotIn('--useDefault',runtime.launch(self.root,'scp',self.env())[0]);self.assertEqual(self.identity(p),before);p.unlink()
 def test_scp_wizard_hoster_policy_respects_appdata_configuration(self):
  policy=self.root/'hoster_policy.txt';policy.write_text('\ufeffGAMEDIR_FOR_CONFIGS: TRUE\n')
  self.assertIn('--useDefault',runtime.launch(self.root,'scp',self.env())[0])
  for name in ['28000/config_localadmin.txt','config_localadmin_global.txt']:
   p=self.root/'AppData/config'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('operator')
   self.assertNotIn('--useDefault',runtime.launch(self.root,'scp',self.env())[0]);p.unlink()
 def test_scp_wizard_other_port_and_nonlocaladmin_files_are_not_overwritten(self):
  p=self.root/'.config/SCP Secret Laboratory/config/28001/config_localadmin.txt';p.parent.mkdir(parents=True);p.write_text('other port');before=self.identity(p)
  self.assertIn('--useDefault',runtime.launch(self.root,'scp',self.env())[0]);self.assertEqual(self.identity(p),before)
 def test_scp_wizard_refuses_symlinks_and_nonfile_configuration_paths(self):
  for name in ['hoster_policy.txt','.config','.config/SCP Secret Laboratory/config/28000/config_localadmin.txt','.config/SCP Secret Laboratory/config/config_localadmin_global.txt']:
   with tempfile.TemporaryDirectory() as d:
    r=Path(d);p=r/name;p.parent.mkdir(parents=True,exist_ok=True);p.symlink_to(r/'missing')
    with self.assertRaisesRegex(ValueError,'Symlink'):runtime.launch(r,'scp',self.env())
  p=self.root/'.config/SCP Secret Laboratory/config/28000/config_localadmin.txt';p.mkdir(parents=True)
  with self.assertRaisesRegex(ValueError,'regular file'):runtime.launch(self.root,'scp',self.env())
 def test_scp_wizard_errors_fail_closed_and_other_games_unchanged(self):
  with patch.object(Path,'lstat',side_effect=PermissionError('unreadable configuration')),self.assertRaises(PermissionError):runtime.scp_first_run(self.root,28000)
  self.assertIn('--useDefault',runtime.launch(self.root,'exiled',self.env())[0])
 def test_scp_eula_default_does_not_accept_inherited_publisher_flag(self):
  for inherited in ['TRUE','1','false','garbage']:
   argv,env,_,_=runtime.launch(self.root,'scp',self.env(ACCEPT_SCPSL_EULA=inherited))
   self.assertNotIn('ACCEPT_SCPSL_EULA',env);self.assertNotIn('--acceptEULA',argv)
 def test_scp_eula_explicit_boolean_only(self):
  for value in ['1','true']:
   argv,env,_,_=runtime.launch(self.root,'scp',self.env(SCPSL_ACCEPT_EULA=value,ACCEPT_SCPSL_EULA='false'))
   self.assertEqual(env['ACCEPT_SCPSL_EULA'],'TRUE');self.assertNotIn('--acceptEULA',argv)
  for value in ['0','false']:
   _,env,_,_=runtime.launch(self.root,'scp',self.env(SCPSL_ACCEPT_EULA=value,ACCEPT_SCPSL_EULA='TRUE'))
   self.assertNotIn('ACCEPT_SCPSL_EULA',env)
 def test_scp_eula_invalid_rejected_without_writes(self):
  for value in ['yes','TRUE','','2','true\n']:
   with self.assertRaisesRegex(ValueError,'SCPSL_ACCEPT_EULA'):runtime.launch(self.root,'scp',self.env(SCPSL_ACCEPT_EULA=value))
  self.assertEqual(list(self.root.iterdir()),[])
 def test_scp_eula_persisted_state_unchanged_by_runtime(self):
  target=self.root/'.config/SCP Secret Laboratory/config/localadmin_internal_data.json';target.parent.mkdir(parents=True);target.write_bytes(b'{"EulaAccepted":"2026-01-01T00:00:00Z","Unknown":"operator"}\r\n');target.chmod(0o640);before=self.identity(target)
  for value in ['0','1']:
   runtime.launch(self.root,'scp',self.env(SCPSL_ACCEPT_EULA=value));self.assertEqual(self.identity(target),before)
 def test_scp_eula_persisted_state_restored_after_success_and_failure(self):
  target=self.root/'.config/SCP Secret Laboratory/config/localadmin_internal_data.json';target.parent.mkdir(parents=True);target.write_bytes(b'{"EulaAccepted":"2026-01-01T00:00:00Z","Unknown":"operator"}\r\n');target.chmod(0o640);before=self.identity(target)
  for failure in [False,True]:
   def update(*args,**kwargs):
    target.write_bytes(b'publisher replacement');target.chmod(0o600)
    if failure:raise RuntimeError('publisher failed')
    return {'appid':996560}
   with patch.object(install.steam_template,'update',side_effect=update),patch.object(install,'fetch',return_value=b'archive'),patch.object(install.hashlib,'sha512') as digest,patch.object(install,'archive_files',return_value=[]):
    digest.return_value.hexdigest.return_value=install.DOTNET['sha512']
    if failure:
     with self.assertRaisesRegex(RuntimeError,'publisher failed'):install.install(self.root,'scp',self.env())
    else:install.install(self.root,'scp',self.env())
   self.assertEqual(self.identity(target),before)
 def test_private_gate_before_writes(self):
  for field in ['STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS']:
   with self.subTest(field=field),self.assertRaises(ValueError):runtime.launch(self.root,'kf2',self.env(**{field:'private'}))
  self.assertEqual(list(self.root.iterdir()),[])
 def test_confined_extract_rejects_escape(self):
  for name in ['/tmp/elsewhere','../outside']:
   with self.assertRaises(ValueError):runtime.launch(self.root,'scp',self.env(DOTNET_BUNDLE_EXTRACT_BASE_DIR=name))
 def test_ports_are_explicit_distinct_and_conditional(self):
  for changes in [{'QUERY_PORT':'28000'},{'QUERY_PORT':'27015'},{'WEB_ADMIN':'true','ADMIN_PASS':'x','WEB_ADMIN_PORT':'8089'}]:
   with self.subTest(changes=changes),self.assertRaises(ValueError):runtime.launch(self.root,'kf2',self.env(**changes))
 def test_kf_webadmin_config_and_secret_not_in_argv(self):
  argv,env,stop,ready=runtime.launch(self.root,'kf2',self.env(WEB_ADMIN='true',WEB_ADMIN_PORT='28002',ADMIN_PASS='secret?with=chars',SERVER_NAME='Fixture',DIFFICULTY='3',EXTRA_FLAGS='-log -unattended'))
  self.assertNotIn('secret',repr(argv));self.assertEqual(stop,'\x03');self.assertIn('?Difficulty=3',argv[1]);self.assertIn('-unattended',argv)
  self.assertIn('ListenPort = 28002',(self.root/'KFGame/Config/KFWeb.ini').read_text());self.assertIn('AdminPassword = secret?with=chars',(self.root/'KFGame/Config/LinuxServer-KFGame.ini').read_text())
 def test_unreal_unmanaged_repeated_arrays_and_comments_preserved(self):
  path=self.root/'KFGame/Config/KFWeb.ini';path.parent.mkdir(parents=True);path.write_text(';keep\n[IPDRV.WebServer]\nbenabled=false\nListenPort=8080\n[Workshop]\nItem=1\nItem=2\n')
  runtime.launch(self.root,'kf2',self.env());text=path.read_text();self.assertIn(';keep',text);self.assertIn('Item=1\nItem=2',text);self.assertEqual(text.count('bEnabled'),1)
 def test_unsafe_extra_and_map_injection_rejected(self):
  for changes in [{'MAP_NAME':'KF-X?AdminPassword=x'},{'EXTRA_FLAGS':'-Port=9'},{'EXTRA_FLAGS':'$(touch /tmp/no)'},{'SERVER_NAME':'name\nAdminPassword=x'}]:
   with self.subTest(changes=changes),self.assertRaises(ValueError):runtime.launch(self.root,'kf2',self.env(**changes))
 def test_exact_pin_does_not_network(self):
  value=install.resolve_exiled('9.15.2','0',lambda *args:self.fail('Unexpected request'));self.assertEqual(value['sha256'],install.EXILED_PIN['assets'][0]['digest'][7:])
 def test_release_selection_and_prerelease_control(self):
  stable=json.loads(json.dumps(install.EXILED_PIN));beta=json.loads(json.dumps(stable));beta.update(tag_name='v9.16.0-beta.1',prerelease=True,published_at='2099-01-01');beta['assets'][0]['browser_download_url']='https://github.com/ExMod-Team/EXILED/releases/download/v9.16.0-beta.1/Exiled.tar.gz'
  request=lambda *args:json.dumps([beta,stable]).encode()
  self.assertEqual(install.resolve_exiled('latest','0',request)['tag'],'v9.15.2');self.assertEqual(install.resolve_exiled('latest','1',request)['tag'],'v9.16.0-beta.1')
 def test_wrong_exact_or_missing_digest_never_falls_back(self):
  for version,release in [('9.1.0',install.EXILED_PIN),('9.15.3',{**install.EXILED_PIN,'tag_name':'v9.15.3','assets':[{**install.EXILED_PIN['assets'][0],'digest':None}]})]:
   with self.assertRaises(ValueError):install.resolve_exiled(version,'0',lambda *args:json.dumps(release).encode())
 def archive(self,name,kind=tarfile.REGTYPE):
  output=io.BytesIO()
  with tarfile.open(fileobj=output,mode='w:gz') as tar:
   member=tarfile.TarInfo(name);member.type=kind;member.size=3 if kind==tarfile.REGTYPE else 0;tar.addfile(member,io.BytesIO(b'abc') if member.size else None)
  return output.getvalue()
 def test_archive_rejects_traversal_links_wrong_root_before_publication(self):
  for name,kind in [('../outside',tarfile.REGTYPE),('/absolute',tarfile.REGTYPE),('EXILED/link',tarfile.SYMTYPE),('other/file.dll',tarfile.REGTYPE)]:
   with self.subTest(name=name),self.assertRaises(ValueError):install.publish_archive(self.root,self.archive(name,kind),True)
  self.assertEqual(list(self.root.iterdir()),[])
 def test_manual_archive_mapping_preserves_existing_settings(self):
  target=self.root/'.config/EXILED/Configs/global.yml';target.parent.mkdir(parents=True);target.write_text('operator')
  install.publish_archive(self.root,self.archive('EXILED/Configs/global.yml'),True);self.assertEqual(target.read_text(),'operator')
  install.publish_archive(self.root,self.archive('SCP Secret Laboratory/LabAPI/plugins/global/Exiled.Loader.dll'),True);self.assertEqual((self.root/'.config/SCP Secret Laboratory/LabAPI/plugins/global/Exiled.Loader.dll').read_bytes(),b'abc')
 def test_original_fields_and_defaults_retained(self):
  root=SCRIPTS.parents[3];catalog=json.loads((root/'internal/panel/game_library/upstream/catalog.json').read_text());profiles=json.loads((root/'.local/session-servers/profiles.json').read_text())
  for path,profile in profiles.items():
   original=next(row['egg'] for row in catalog['entries'] if row['path']==path);variables={v['env_variable']:v for v in profile['egg']['variables']}
   for old in original['variables']:
    self.assertEqual(variables[old['env_variable']]['default_value'],old['default_value']);self.assertEqual(variables[old['env_variable']]['user_viewable'],old['user_viewable']);self.assertEqual(variables[old['env_variable']]['user_editable'],old['user_editable'])
   self.assertEqual(profile['verification'],'not_verified')
 def test_reinstall_preserves_unknown_admin_config_on_failure(self):
  target=self.root/'KFGame/Config/MultiAdmin.ini';target.parent.mkdir(parents=True);target.write_bytes(b'private admin data\r\n');target.chmod(0o640)
  def failed_update(*args,**kwargs):target.write_bytes(b'publisher replaced');target.chmod(0o600);raise RuntimeError('install failed')
  with patch.object(install.steam_template,'update',side_effect=failed_update),self.assertRaises(RuntimeError):install.install(self.root,'kf2',self.env())
  self.assertEqual(target.read_bytes(),b'private admin data\r\n');self.assertEqual(target.stat().st_mode & 0o777,0o640)
 def test_config_symlink_rejected(self):
  target=self.root/'KFGame';outside=self.root/'outside';outside.mkdir();target.symlink_to(outside,target_is_directory=True)
  with self.assertRaises(ValueError):runtime.launch(self.root,'kf2',self.env())
 def test_installer_private_gate_precedes_metadata_lookup(self):
  with patch.object(install,'resolve_exiled',side_effect=AssertionError('network attempted')),self.assertRaises(ValueError):install.install(self.root,'exiled',self.env(STEAM_PASS='private'))
  self.assertEqual(list(self.root.iterdir()),[])
 def test_kf_steam_offset_overflow_missing_and_collisions_before_writes(self):
  for changes in [{'VOLTRA_ALLOCATED_PORTS':'28000,28001,28002'},{'SERVER_PORT':'52753','VOLTRA_ALLOCATED_PORTS':'52753,28001,28002'},{'QUERY_PORT':'40783'},{'WEB_ADMIN':'true','ADMIN_PASS':'x','WEB_ADMIN_PORT':'40783'}]:
   with self.subTest(changes=changes),self.assertRaises(ValueError):runtime.launch(self.root,'kf2',self.env(**changes))
   self.assertEqual(list(self.root.iterdir()),[])
 def test_kf_install_guard_precedes_steam_mutation(self):
  with patch.object(install.steam_template,'update',side_effect=AssertionError('publisher mutation')),self.assertRaises(ValueError):install.install(self.root,'kf2',self.env(VOLTRA_ALLOCATED_PORTS='28000,28001'))
  self.assertEqual(list(self.root.iterdir()),[])
 def test_kf_highest_primary_and_steam_override_rejected(self):
  self.assertEqual(runtime.kf2_ports(self.env(SERVER_PORT='52752',VOLTRA_ALLOCATED_PORTS='52752,65535,28001'))[:2],(52752,28001))
  with self.assertRaises(ValueError):runtime.launch(self.root,'kf2',self.env(EXTRA_FLAGS='-SteamPort=9'))
 def test_kf_stage_reserves_fixed_steam_before_optional_roles(self):
  root=SCRIPTS.parents[3];profiles=json.loads((root/'.local/session-servers/profiles.json').read_text());profile=profiles['killing_floor_2/egg-killing-floor2.json']
  self.assertEqual(profile['required_ports'],3);fixed,query,web=profile['port_rules'];self.assertEqual(fixed['offsets'],[12783]);self.assertEqual(query['exclude_offsets'],[12783]);self.assertEqual(query['count'],3);self.assertEqual(web['count'],4);self.assertEqual(web['when_value'],'true');self.assertEqual(web['exclude_offsets'],[12783])
 def payload(self,files):
  output=io.BytesIO()
  with tarfile.open(fileobj=output,mode='w:gz') as tar:
   for name,content in files.items():
    member=tarfile.TarInfo(name);member.size=len(content);member.mode=0o644;tar.addfile(member,io.BytesIO(content))
  return output.getvalue()
 def identity(self,path):
  metadata=path.stat();return path.read_bytes(),metadata.st_mode & 0o777,metadata.st_uid,metadata.st_gid
 def test_exiled_receipt_owned_unchanged_updates_with_metadata(self):
  self.assertEqual(os.geteuid(),0,'Owner fixtures require isolated root Linux test runner')
  os.chown(self.root,12345,12346)
  name='EXILED/Plugins/Exiled.Events.dll';path=self.root/'.config'/name
  install.publish_archive(self.root,self.payload({name:b'first'}),True,{'tag':'v1'})
  self.assertEqual(self.identity(path),(b'first',0o644,12345,12346));path.chmod(0o640)
  install.publish_archive(self.root,self.payload({name:b'new publisher bytes'}),True,{'tag':'v2'})
  self.assertEqual(self.identity(path),(b'new publisher bytes',0o640,12345,12346))
  receipt=json.loads((self.root/'.voltra/exiled-release.json').read_text());self.assertEqual(receipt['tag'],'v2');self.assertEqual(receipt['files']['.config/'+name]['sha256'],hashlib.sha256(b'new publisher bytes').hexdigest())
 def test_exiled_modified_and_untracked_binary_collisions_preflight(self):
  name='EXILED/Plugins/Exiled.Events.dll';path=self.root/'.config'/name
  install.publish_archive(self.root,self.payload({name:b'publisher'}),True);receipt=self.identity(self.root/'.voltra/exiled-release.json')
  path.write_bytes(b'operator patch');path.chmod(0o600);before=self.identity(path)
  with self.assertRaisesRegex(ValueError,'modified or untracked collision'):install.publish_archive(self.root,self.payload({'EXILED/Plugins/New.dll':b'new',name:b'next'}),True)
  self.assertEqual(self.identity(path),before);self.assertEqual(self.identity(self.root/'.voltra/exiled-release.json'),receipt);self.assertFalse((path.parent/'New.dll').exists())
  untracked=path.parent/'Untracked.dll';untracked.write_bytes(b'custom')
  with self.assertRaisesRegex(ValueError,'modified or untracked collision'):install.publish_archive(self.root,self.payload({'EXILED/Plugins/Untracked.dll':b'publisher'}),True)
  self.assertEqual(untracked.read_bytes(),b'custom')
 def test_exiled_mid_batch_failure_rolls_back_bytes_metadata_receipt_and_new_files(self):
  os.chown(self.root,12345,12346)
  name='EXILED/Plugins/Exiled.Events.dll';path=self.root/'.config'/name
  install.publish_archive(self.root,self.payload({name:b'old'}),True,{'tag':'old'});path.chmod(0o640)
  before=self.identity(path);receipt=self.identity(self.root/'.voltra/exiled-release.json');original=install.steam_template._publish;failed=False
  def fail_after_second_write(root,name,writer,default_mode=0o644):
   nonlocal failed
   result=original(root,name,writer,default_mode)
   if name.endswith('New.dll') and not failed:failed=True;os.chmod(Path(root)/name,0o600);os.chown(Path(root)/name,0,0);raise OSError('injected post-publication failure')
   return result
  with patch.object(install.steam_template,'_publish',side_effect=fail_after_second_write),self.assertRaisesRegex(OSError,'injected'):install.publish_archive(self.root,self.payload({name:b'new','EXILED/Plugins/New.dll':b'created'}),True,{'tag':'new'})
  self.assertEqual(self.identity(path),before);self.assertEqual(self.identity(self.root/'.voltra/exiled-release.json'),receipt);self.assertFalse((path.parent/'New.dll').exists())
 def test_exiled_receipt_failure_rolls_back_successfully_written_files(self):
  os.chown(self.root,12345,12346)
  name='EXILED/Plugins/Exiled.Events.dll';path=self.root/'.config'/name
  install.publish_archive(self.root,self.payload({name:b'old'}),True);path.chmod(0o640);before=self.identity(path);record=self.root/'.voltra/exiled-release.json';old=self.identity(record);original=install.steam_template._publish;failed=False
  def failure(root,name,writer,default_mode=0o644):
   nonlocal failed
   result=original(root,name,writer,default_mode)
   if name=='.voltra/exiled-release.json' and not failed:failed=True;os.chown(path,0,0);path.chmod(0o600);raise PermissionError('injected receipt failure')
   return result
  with patch.object(install.steam_template,'_publish',side_effect=failure),self.assertRaisesRegex(PermissionError,'receipt failure'):install.publish_archive(self.root,self.payload({name:b'new'}),True)
  self.assertEqual(self.identity(path),before);self.assertEqual(self.identity(record),old)
 def test_exiled_symlink_parent_preflight_prevents_partial_publication(self):
  name='EXILED/Plugins/Exiled.Events.dll';outside=self.root/'operator';outside.mkdir();base=self.root/'.config/EXILED';base.mkdir(parents=True);(base/'Plugins').symlink_to(outside,target_is_directory=True)
  with self.assertRaises((ValueError,OSError)):install.publish_archive(self.root,self.payload({'EXILED/Deps/First.dll':b'first',name:b'next'}),True)
  self.assertFalse((base/'Deps/First.dll').exists());self.assertEqual(list(outside.iterdir()),[])
 def test_exiled_owner_assignment_failure_preserves_existing_payload(self):
  os.chown(self.root,12345,12346);name='EXILED/Plugins/Exiled.Events.dll';path=self.root/'.config'/name
  install.publish_archive(self.root,self.payload({name:b'old'}),True);path.chmod(0o640);before=self.identity(path);record=self.identity(self.root/'.voltra/exiled-release.json');original=os.fchown;failed=False
  def failure(descriptor,uid,gid):
   nonlocal failed
   if not failed:failed=True;raise PermissionError('injected owner assignment failure')
   return original(descriptor,uid,gid)
  # Lock fchown is separate from payload publication: fail the publisher's first
  # assignment while leaving normal lock acquisition intact.
  original_publish=install.steam_template._publish
  def publisher(root,name,writer,default_mode=0o644):
   with patch.object(os,'fchown',side_effect=failure):return original_publish(root,name,writer,default_mode)
  with patch.object(install.steam_template,'_publish',side_effect=publisher),self.assertRaisesRegex(PermissionError,'owner assignment'):install.publish_archive(self.root,self.payload({name:b'new'}),True)
  self.assertEqual(self.identity(path),before);self.assertEqual(self.identity(self.root/'.voltra/exiled-release.json'),record)
 def test_exiled_canonical_duplicate_archive_paths_rejected(self):
  with self.assertRaisesRegex(ValueError,'Duplicate'):install.publish_archive(self.root,self.payload({'EXILED/Plugins/a.dll':b'a','EXILED//Plugins/a.dll':b'b'}),True)
  self.assertEqual(list(self.root.iterdir()),[])

if __name__=='__main__':unittest.main()
