import importlib.util
import json
import os
import signal
import sys
import threading
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('racing',Path('internal/panel/game_library/scripts/assetto-ams-native.py'));racing=importlib.util.module_from_spec(spec);spec.loader.exec_module(racing)

class Racing(unittest.TestCase):
 def test_private_display_survives_native_stop_and_is_reaped_after_real_child_exit(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary);binary=root/'Xvfb';events=root/'display-events';marker=Path('/tmp/.X11-unix/X99');self.assertFalse(marker.exists())
   binary.write_text('#!'+sys.executable+'\nimport pathlib,signal,time,sys\np=pathlib.Path("/tmp/.X11-unix/X99");p.parent.mkdir(parents=True,exist_ok=True);p.touch()\ndef stop(*args):\n pathlib.Path('+repr(str(events))+').write_text("display terminated after native child")\n p.unlink();sys.exit(0)\nsignal.signal(signal.SIGTERM,stop)\nwhile True:time.sleep(.05)\n');binary.chmod(0o755)
   child="import pathlib,signal,time,sys\ndef stop(*args):\n assert pathlib.Path('/tmp/.X11-unix/X99').exists(); print('NATIVE_QUIT_DISPLAY_ALIVE',flush=True);sys.exit(0)\nsignal.signal(signal.SIGINT,stop)\nprint('NATIVE_READY',flush=True)\nwhile True:time.sleep(.05)"
   old={s:signal.getsignal(s) for s in (signal.SIGINT,signal.SIGTERM)};timer=threading.Timer(.4,lambda:os.kill(os.getpid(),signal.SIGTERM));timer.start()
   try:
    with patch.dict(os.environ,{'PATH':str(root)+os.pathsep+os.environ['PATH']}),patch.object(racing,'configure',return_value=([sys.executable,'-c',child],())):
     self.assertEqual(racing.run(root,'ams2',{}),0)
   finally:
    timer.cancel()
    for s,handler in old.items():signal.signal(s,handler)
   self.assertFalse(marker.exists());self.assertEqual(events.read_text(),'display terminated after native child')
 def test_original_freeroam_architecture_selection_uses_distinct_pinned_publisher_archives(self):
  for machine,expected,size in [('x86_64','linux-x64',46236246),('amd64','linux-x64',46236246),('aarch64','linux-arm64',44371542),('arm64','linux-arm64',44371542)]:
   with patch.object(racing.platform,'machine',return_value=machine):
    selected=racing.assettoserver_release();self.assertIn(expected,selected['url']);self.assertEqual(selected['bytes'],size);self.assertRegex(selected['sha256'],'^[0-9a-f]{64}$')
  self.assertNotEqual(racing.ASSETTO_SERVER['sha256'],racing.ASSETTO_SERVER_ARM64['sha256'])
  with patch.object(racing.platform,'machine',return_value='unreviewed'):
   with self.assertRaises(ValueError):racing.assettoserver_release()
 def test_role_selection_reserves_explicit_ports_before_automatic_roles(self):
  env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','QUERY_PORT':'28001','STEAM_PORT':''}
  self.assertEqual(racing.roles(env,['STEAM_PORT','QUERY_PORT']),{'primary':28000,'QUERY_PORT':28001,'STEAM_PORT':28002})
  for value in ('28000','28009','0','-1','1;echo bad'):
   with self.assertRaises(ValueError):racing.roles({**env,'QUERY_PORT':value},['STEAM_PORT','QUERY_PORT'])
 def test_all_original_ac_controls_are_literal_private_ini_with_operator_sections(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary);(root/'cfg').mkdir();p=root/'cfg/server_cfg.ini';p.write_text('; operator\n[SERVER]\nTRACK=operator_track\nUDP_PLUGIN_ADDRESS=127.0.0.1:12000\n[PRACTICE]\nNAME=Freeroam\n')
   env={'SERVER_PORT':'1','VOLTRA_ALLOCATED_PORTS':'1,8','HTTP_PORT':'8','HOSTNAME':'Literal $ + "name"','PASSWORD':'','ADMIN_PASSWORD':'privatefixture','PUBLIC_SERVER':'0'}
   argv,secrets=racing.configure(root,'assetto',env);content=p.read_text();self.assertEqual(argv,[str(root/'acServer')]);self.assertNotIn('privatefixture',' '.join(argv));self.assertEqual(secrets,('privatefixture',''))
   for expected in ('TRACK=operator_track','UDP_PLUGIN_ADDRESS=127.0.0.1:12000','NAME=Freeroam','NAME = Literal $ + "name"','HTTP_PORT = 8','UDP_PORT = 1','TCP_PORT = 1','REGISTER_TO_LOBBY = 0'):self.assertIn(expected,content)
   self.assertTrue(content.startswith('; operator'))
 def test_freeroam_retains_ai_yaml_entry_list_plugins_and_car_track_choices(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary);(root/'cfg').mkdir();(root/'cfg/server_cfg.ini').write_text('[SERVER]\nTRACK=owned_track\n')
   files={'cfg/extra_cfg.yml':b'# operator\nEnableAi: true\nEnablePlugins: [OperatorPlugin]\n','cfg/entry_list.ini':b'[CAR_0]\nMODEL=owned_car\nAI=fixed\n','plugins/OperatorPlugin/custom.json':b'{"operator":"keep"}'}
   for name,data in files.items():p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
   argv,_=racing.configure(root,'assettoserver',{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001','SERVER_NAME':'Free $ + roam','SERVER_PASSWORD':'fixturejoin','ADMIN_PASSWORD':'fixtureadmin','MAX_CLIENTS':'25'})
   self.assertEqual(argv,[str(root/'AssettoServer')]);self.assertIn('MAX_CLIENTS = 25',(root/'cfg/server_cfg.ini').read_text())
   for name,data in files.items():self.assertEqual((root/name).read_bytes(),data)
 def test_ams_colon_grammar_preserves_comments_strings_and_nested_addons(self):
  content='// heading\nname : "old // literal" // inline\npassword : "old"\nsteamPort : 1\nhostPort : 2\nqueryPort : 3\nmaxPlayerCount : 4\naddons : { name : "untouched", maxPlayerCount : 99, text : "literal } // :" }\n/* comment */'
  values={'name':'Literal " \\ $ +','password':'','steamPort':28001,'hostPort':28000,'queryPort':28002,'maxPlayerCount':32}
  result=racing.patch_colon_config(content,values);self.assertIn('name : '+json.dumps(values['name'])+' // inline',result);self.assertIn('addons : { name : "untouched", maxPlayerCount : 99, text : "literal } // :" }',result);self.assertTrue(result.startswith('// heading'));self.assertTrue(result.endswith('/* comment */'));self.assertEqual(racing.patch_colon_config(result,values),result)
 def test_ams_braced_native_fields_and_rejection_before_unsafe_rewrite(self):
  self.assertEqual(racing.patch_colon_config('{ "name": "old", "nested": {"name":"keep"}}',{'name':'new'}),'{ "name": "new", "nested": {"name":"keep"}}')
  for content in ('name: "a"\nname: "b"','nested:{name:"a"}','name: {}','/* unclosed','name: "unterminated','{name: "x"','{name:"x"]'):
   with self.assertRaises(ValueError):racing.patch_colon_config(content,{'name':'new'})
 def test_original_ams_controls_configure_without_argv_secrets(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary);(root/'server.cfg').write_text('name:"old"\npassword:"old"\nsteamPort:1\nhostPort:2\nqueryPort:3\nmaxPlayerCount:4\ncustom:{retained:true}\n')
   env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','STEAM_PORT':'28001','QUERY_PORT':'28002','SERVER_NAME':'AMS literal $ +','SERVER_PASSWORD':'secretfixture','MAX_PLAYERS':'32'}
   argv,secrets=racing.configure(root,'ams2',env);self.assertEqual(argv,['wine',str(root/'DedicatedServerCmd.exe')]);self.assertNotIn('secretfixture',' '.join(argv));self.assertEqual(secrets,('secretfixture',));self.assertIn('custom:{retained:true}',(root/'server.cfg').read_text());self.assertIn('maxPlayerCount:32',(root/'server.cfg').read_text())
 def test_injection_symlink_and_native_password_constraints(self):
  with tempfile.TemporaryDirectory() as temporary,tempfile.TemporaryDirectory() as outside:
   root=Path(temporary);(root/'cfg').mkdir();target=Path(outside)/'server_cfg.ini';target.write_text('keep');(root/'cfg/server_cfg.ini').symlink_to(target)
   env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001','ADMIN_PASSWORD':'fixtureadmin'}
   with self.assertRaises(ValueError):racing.configure(root,'assetto',env)
   self.assertEqual(target.read_text(),'keep')
  for value in ('name\nADMIN_PASSWORD=bad','value\x00bad'):
   with self.assertRaises(ValueError):racing.text({'HOSTNAME':value},'HOSTNAME')
 def test_private_steam_gate_attempts_no_account_login_or_file_mutation(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary)
   with patch.object(racing.steam,'update') as updater:
    with self.assertRaisesRegex(ValueError,'credential transport'):racing.install_steam(root,'assetto',{'STEAM_USER':'operator','STEAM_PASS':'secret'})
    updater.assert_not_called();self.assertFalse((root/'.voltra').exists())
 def test_steam_preserves_operator_bytes_and_metadata_even_on_failed_validate(self):
  for failure in (False,True):
   with tempfile.TemporaryDirectory() as temporary:
    root=Path(temporary);(root/'content').mkdir();config=root/'server.cfg';config.write_bytes(b'operator config');asset=root/'content/custom.bin';asset.write_bytes(b'operator asset');asset.chmod(0o640)
    racing.helper('steam-template');restore=racing.helper('source-install').restore_file;original=racing.helper
    def update(*args,**kwargs):
     config.write_bytes(b'publisher config');asset.write_bytes(b'publisher asset');asset.chmod(0o600)
     if failure:raise RuntimeError('bounded fixture failure')
     return {'buildid':123}
    with patch.object(racing.steam,'update',side_effect=update),patch.object(racing,'helper',side_effect=lambda name:types.SimpleNamespace(restore_file=restore) if name=='source-install' else original(name)):
     if failure:
      with self.assertRaises(RuntimeError):racing.install_steam(root,'ams2',{})
     else:self.assertEqual(racing.install_steam(root,'ams2',{}),{'buildid':123})
    self.assertEqual(config.read_bytes(),b'operator config');self.assertEqual(asset.read_bytes(),b'operator asset');self.assertEqual(asset.stat().st_mode&0o777,0o640)

unittest.main()
