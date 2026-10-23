import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec=importlib.util.spec_from_file_location('next_games',Path('internal/panel/game_library/scripts/steam-native-next.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Native(unittest.TestCase):
 def test_colony_preserves_native_world_mode_seed_mods_and_listing(self):
  for mode in ('NewOptions','LoadOptions'):
   with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);config={mode:{'WorldName':'old','Seed':'operator seed','EnabledMods':['operator']},'ServerSettings':{'NetworkType':'SteamOnline','ServerListPublicly':False,'RCONPassword':'operator-private'}};(root/'server.config.json').write_text(json.dumps(config))
    argv,secrets=m.configure(root,'colony',{'WORLD_NAME':'newworld','SERVER_NAME':'literal $ + &','MAX_PLAYERS':'8','SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001','SERVER_STEAMPORT':'28001'})
    actual=json.loads((root/'server.config.json').read_text());self.assertEqual(actual[mode]['WorldName'],'newworld');self.assertEqual(actual[mode]['Seed'],'operator seed');self.assertFalse(actual['ServerSettings']['ServerListPublicly']);self.assertEqual(actual['ServerSettings']['RCONPassword'],'operator-private');self.assertEqual(actual['ServerSettings']['ServerName'],'literal $ + &');self.assertIn('+server.steamport',argv);self.assertNotIn('operator-private',' '.join(argv));self.assertIn('operator-private',secrets)
 def test_colony_duplicate_json_and_ambiguous_world_modes_rejected(self):
  with self.assertRaises(ValueError):m.json_unique('{"ServerSettings":{},"ServerSettings":{}}')
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'server.config.json').write_text('{"NewOptions":{},"LoadOptions":{},"ServerSettings":{}}')
   with self.assertRaises(ValueError):m.configure(root,'colony',{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001'})
 def test_hurtworld_command_language_injection_rejected_literal_shell_tokens_retained(self):
  env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001','HOSTNAME':'literal $ + & name','MAX_PLAYERS':'80','CREATIVE_MODE':'1','ADMINS':'76561198000000001'}
  argv,_=m.configure(Path('/server'),'hurtworld',env);self.assertIn('maxplayers 80',argv[argv.index('-exec')+1]);self.assertIn('servername literal $ + & name',argv[argv.index('-exec')+1]);self.assertIn('addadmin 76561198000000001',argv[argv.index('-exec')+1])
  for name in ['name;quit','name";quit','name\\escape']:
   with self.assertRaises(ValueError):m.configure(Path('/server'),'hurtworld',{**env,'HOSTNAME':name})
 def test_optional_hurtworld_administrator_not_fabricated(self):
  argv,_=m.configure(Path('/server'),'hurtworld',{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001'});self.assertNotIn('addadmin',' '.join(argv))
 def test_native_port_roles_and_negative_query_offset_are_distinct(self):
  env={'SERVER_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002'}
  self.assertEqual(m.roles(env,['RCON_PORT'],(-1,))['RCON_PORT'],28002)
  for other in [{'RCON_PORT':'28000'},{'RCON_PORT':'28001'},{'VOLTRA_ALLOCATED_PORTS':'28001,28002'}]:
   with self.assertRaises(ValueError):m.roles({**env,**other},['RCON_PORT'],(-1,))
 def test_holdfast_composes_managed_globals_after_import_before_rotation(self):
  content='# Operator global comment\nserver_name Old\nimport private/header.txt\n# server_password old\n!map_rotation start\nmap_name operator_map\nimport private/map.txt\n!map_rotation end\n'
  updated=m.patch_holdfast(content,{'server_name':'literal $ + &','maximum_players':32,'server_password':'private'})
  self.assertLess(updated.index('import private/header'),updated.index('server_name literal'));self.assertLess(updated.index('server_name literal'),updated.index('!map_rotation'));self.assertIn('map_name operator_map\nimport private/map.txt',updated);self.assertEqual(m.patch_holdfast(updated,{'server_name':'literal $ + &','maximum_players':32,'server_password':'private'}),updated)
  with self.assertRaises(ValueError):m.patch_holdfast('server_name x\nserver_name y\n',{'server_name':'z'})
 def test_holdfast_keeps_all_log_moderation_paths_without_password_argv(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);f=root/'holdfastnaw-dedicated/configs/operator.txt';f.parent.mkdir(parents=True);f.write_text('# operator\n!map_rotation start\nmap_name operator_map\n!map_rotation end\n')
   env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','ADMIN_PASS':'operator-secret','SERVER_PASS':'join-secret','SERVER_CONFIG_PATH':'operator.txt'}
   argv,secrets=m.configure(root,'holdfast',env)
   for flag in ['-adminCommandsLogFilePath','-playersLogFilePath','-scoreboardLogFilePath','-chatLogFilePath','-workshopDataPath','-micSpammersPlayersFilePath','-mutedVoipPlayersFilePath','-mutedChatPlayersFilePath','-bannedPlayersFilePath','-logArchivesDirectory']:self.assertIn(flag,argv)
   self.assertNotIn('operator-secret',' '.join(argv));self.assertNotIn('94.130.66.231',' '.join(argv));self.assertIn('operator-secret',secrets)
 def test_rising_disabled_and_enabled_rcon_preserve_native_properties_and_unknowns(self):
  for enabled in ('false','true'):
   with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);f=root/'server.properties';f.write_text('# operator\nServer_Name=old\nPassword=old\nOperator_Unknown=true\n');env={'SERVER_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','RCON':enabled,'RCON_PORT':'','RCON_PASS':'operator-secret','SRV_PW':'literal $ + &','SRV_NAME':'native','WORLD_NAME':'persist','GAME_MODE':'Creative'}
    argv,secrets=m.configure(root,'rising',env);updated=f.read_text();self.assertIn('Operator_Unknown=true',updated);self.assertIn('Password=literal $ + &',updated);self.assertIn('World_GameMode=Creative',updated);self.assertIn('RCON_Port='+('28002' if enabled=='true' else '4253'),updated);self.assertNotIn('operator-secret',' '.join(argv))
 def test_properties_duplicate_and_path_traversal_fail(self):
  with self.assertRaises(ValueError):m.patch_properties('Server_Name=a\nServer_Name=b\n',{'Server_Name':'x'})
  for path in ['/tmp/x','../x','C:\\x','a/../x']:
   with self.assertRaises(ValueError):m.relative({'PATH':path},'PATH','default')
   with self.assertRaises(ValueError):m.world_name({'WORLD_NAME':path},'default',40)
 def test_strict_state_and_plugin_metadata_survive_failed_installer(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);f=root/'Worlds/operator/state.bin';f.parent.mkdir(parents=True);f.write_bytes(b'world\x00\xff');f.chmod(0o640);os.utime(f,ns=(123456789000,987654321000));plugin=root/'oxide/plugins/Operator.cs';plugin.parent.mkdir(parents=True);plugin.write_bytes(b'operator plugin and author license')
   with self.assertRaises(RuntimeError):
    with m.preserve(root):f.write_bytes(b'wrong');f.chmod(0o777);plugin.write_bytes(b'wrong');raise RuntimeError('Steam validation failed')
   self.assertEqual(f.read_bytes(),b'world\x00\xff');self.assertEqual(f.stat().st_mode&0o777,0o640);self.assertEqual(f.stat().st_mtime_ns,987654321000);self.assertEqual(plugin.read_bytes(),b'operator plugin and author license')
 def test_zip_traversal_symlink_and_duplicate_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);archive=root/'unsafe.zip'
   for name in ['../escape','/escape','C:/escape','nested\\escape']:
    with zipfile.ZipFile(archive,'w') as z:z.writestr(name,b'bad')
    with self.assertRaises(ValueError):m.unzip(root,archive)
   with zipfile.ZipFile(archive,'w') as z:
    info=zipfile.ZipInfo('link');info.external_attr=0o120777<<16;z.writestr(info,b'/tmp')
   with self.assertRaises(ValueError):m.unzip(root,archive)
 def test_plugin_selection_validation_happens_before_network_and_existing_edits_stay(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);f=root/'oxide/plugins/Operator.cs';f.parent.mkdir(parents=True);f.write_bytes(b'operator source/license')
   with patch.object(m.urllib.request,'urlopen',side_effect=AssertionError('No network expected')):
    m.plugins(root,'Operator')
    for names in ['../escape','https://other/path','Operator,Operator']:
     with self.assertRaises(ValueError):m.plugins(root,names)
   self.assertEqual(f.read_bytes(),b'operator source/license')

unittest.main()
