#!/usr/bin/env python3
"""Source-only behavior fixtures; these do not prove a running game."""
import importlib.util,io,json,sys,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
SCRIPTS=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
for name in ['steam_template','native_console','native_config','session_servers_runtime','session_servers_install']:
 spec=importlib.util.spec_from_file_location(name,SCRIPTS/(name.replace('_','-')+'.py'));module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
runtime=sys.modules['session_servers_runtime'];install=sys.modules['session_servers_install']

class SessionServers(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
 def env(self,**extra):return {'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002',**extra}
 def test_scp_original_localadmin_exit(self):
  argv,env,stop,ready=runtime.launch(self.root,'scp',self.env())
  self.assertEqual(argv,[str(self.root/'LocalAdmin'),'28000']);self.assertEqual(stop,'EXIT');self.assertIsInstance(ready,bytes);self.assertEqual(env['HOME'],str(self.root));self.assertEqual(env['DOTNET_BUNDLE_EXTRACT_BASE_DIR'],str(self.root/'dotnet-bundle'))
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

if __name__=='__main__':unittest.main()
