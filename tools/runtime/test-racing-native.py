import importlib.util
import json
import os
from pathlib import Path
import tempfile
import tomllib
import unittest
from unittest.mock import patch
import zipfile

spec=importlib.util.spec_from_file_location('racing',Path('internal/panel/game_library/scripts/racing-native.py'))
racing=importlib.util.module_from_spec(spec);spec.loader.exec_module(racing)

class Racing(unittest.TestCase):
 def test_beam_controls_and_preservation(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);p=root/'ServerConfig.toml';p.write_text('# retained\n[General]\nTags = "Custom"\nAuthKey = ""\n[Misc]\nSendErrors = false\n')
   env={'SERVER_PORT':'28012','NAME':'Quotes " and $ + 🚗','DESCRIPTION':'Custom description','AUTHKEY':'offline-config-fixture','PRIVATE':'true','MAX_PLAYERS':'12','MAX_CARS':'3','MAP':'/levels/custom/info.json','LOGCHAT':'false'}
   racing.configure(root,'beammp',env);data=tomllib.loads(p.read_text())
   self.assertEqual(data['General']['Name'],env['NAME']);self.assertEqual(data['General']['Port'],28012)
   self.assertEqual(data['General']['MaxPlayers'],12);self.assertEqual(data['General']['MaxCars'],3)
   self.assertFalse(data['General']['LogChat']);self.assertFalse(data['Misc']['SendErrors']);self.assertEqual(data['General']['Tags'],'Custom')
   self.assertTrue(p.read_text().startswith('# retained'));self.assertEqual(len(list((root/'.voltra/beammp/config-backups').iterdir())),1)
 def test_invalid_controls_no_mutation(self):
  for game,env in [('beammp',{'PRIVATE':'false','AUTHKEY':''}),('beammp',{'PRIVATE':'true','AUTHKEY':''}),('beammp',{'PRIVATE':'true','NAME':'bad\nname'}),('beammp',{'PRIVATE':'maybe'}),('kissmp',{'TICKRATE':'256'}),('kissmp',{'SERVER_PORT':'0'})]:
   with tempfile.TemporaryDirectory() as temp:
    root=Path(temp)
    with self.assertRaises(ValueError):racing.configure(root,game,env)
    self.assertFalse((root/('config.json' if game=='kissmp' else 'ServerConfig.toml')).exists())
 def test_kiss_preserves_file_controls(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);p=root/'config.json';p.write_text(json.dumps({'server_name':'Existing','server_identifier':'keep','mods':['abc.zip'],'require_scripts':True,'operator':{'x':2}}))
   racing.configure(root,'kissmp',{'SERVER_PORT':'28011','SERVER_NAME':'','MAX_PLAYERS':'','PUBLIC_SERVER':''})
   data=json.loads(p.read_text());self.assertEqual(data['port'],28011);self.assertEqual(data['server_name'],'Existing');self.assertEqual(data['server_identifier'],'keep');self.assertTrue(data['require_scripts']);self.assertEqual(data['mods'],['abc.zip']);self.assertEqual(data['operator'],{'x':2})
 def test_kiss_optional_controls(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);racing.configure(root,'kissmp',{'SERVER_PORT':'28022','SERVER_NAME':'A " $ name','MAX_PLAYERS':'20','TICKRATE':'120','MAX_CARS':'4','PUBLIC_SERVER':'false','UPNP_ENABLED':'0','REQUIRE_SCRIPTS':'true'})
   data=json.loads((root/'config.json').read_text());self.assertEqual(data['max_players'],20);self.assertEqual(data['tickrate'],120);self.assertEqual(data['max_vehicles_per_client'],4);self.assertTrue(data['require_scripts']);self.assertFalse(data['show_in_server_list'])
   original=data['server_identifier'];racing.configure(root,'kissmp',{'SERVER_PORT':'28022'});self.assertEqual(json.loads((root/'config.json').read_text())['server_identifier'],original)
 def test_symlink_escape_rejected(self):
  with tempfile.TemporaryDirectory() as temp,tempfile.TemporaryDirectory() as outside:
   root=Path(temp);target=Path(outside)/'config.json';target.write_text('{}');(root/'config.json').symlink_to(target)
   with self.assertRaises(ValueError):racing.configure(root,'kissmp',{})
   self.assertEqual(target.read_text(),'{}')
 def test_native_metadata_retained(self):
  with tempfile.TemporaryDirectory() as temp:
   p=Path(temp)/'config.json';p.write_text('{}');p.chmod(0o640);before=p.stat();racing.configure(Path(temp),'kissmp',{})
   self.assertEqual(p.stat().st_mode&0o777,0o640);self.assertEqual(p.stat().st_uid,before.st_uid)
 def test_pins_and_no_shell(self):
  for game in racing.REPOS:
   self.assertRegex(racing.PINNED[game]['sha256'],r'^[a-f0-9]{64}$');self.assertEqual(racing.select_release(game,{'VERSION':racing.PINNED[game]['version']}),racing.PINNED[game])
   with self.assertRaises(ValueError):racing.select_release(game,{'VERSION':'$(touch /tmp/unsafe)'})
 def test_install_preserves_config_and_reuses_verified_binary(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);p=root/'ServerConfig.toml';p.write_text('operator bytes');p.chmod(0o640)
   binary=b'\x7fELF\x02publisher-fixture'
   def download(identity,path):path.write_bytes(binary)
   env={'VERSION':'v3.9.3'}
   with patch.object(racing.release,'download',side_effect=download) as fetch:
    racing.install(root,'beammp',env)
    receipt=root/'.voltra/beammp/release.json';receipt.chmod(0o640)
    racing.install(root,'beammp',env);self.assertEqual(fetch.call_count,1)
   self.assertEqual(p.read_text(),'operator bytes');self.assertEqual(p.stat().st_mode&0o777,0o640);self.assertEqual(receipt.stat().st_mode&0o777,0o640)
 def test_invalid_download_retains_old_binary(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);old=root/'BeamMP-Server';old.write_bytes(b'old-executable')
   with patch.object(racing.release,'download',side_effect=lambda identity,path:path.write_bytes(b'not executable')):
    with self.assertRaises(ValueError):racing.install(root,'beammp',{'VERSION':'v3.9.3'})
   self.assertEqual(old.read_bytes(),b'old-executable');self.assertFalse((root/'.voltra/beammp/release.json').exists())
 def test_zip_only_selects_exact_binary(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)
   def download(identity,path):
    with zipfile.ZipFile(path,'w') as archive:
     archive.writestr('linux/kissmp-server',b'\x7fELF\x02fixture');archive.writestr('linux-arm/kissmp-server',b'\x7fELF\x02arm-fixture');archive.writestr('../../escape','bad')
   with patch.object(racing.release,'download',side_effect=download):racing.install(root,'kissmp',{'VERSION':'v0.8.0'})
   self.assertEqual((root/'kissmp-server').read_bytes(),b'\x7fELF\x02fixture');self.assertEqual(sorted(p.name for p in root.iterdir()),['.voltra','kissmp-server'])
 def test_zip_duplicate_binary_rejected(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)
   def download(identity,path):
    with zipfile.ZipFile(path,'w') as archive:
     archive.writestr('a/kissmp-server',b'\x7fELF\x02fixture');archive.writestr('b/kissmp-server',b'\x7fELF\x02fixture')
   with patch.object(racing.release,'download',side_effect=download):
    with self.assertRaises(ValueError):racing.install(root,'kissmp',{'VERSION':'v0.8.0'})
   self.assertFalse((root/'kissmp-server').exists())
 def test_publication_receipt_failure_rolls_back(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);binary=root/'BeamMP-Server';binary.write_bytes(b'original');binary.chmod(0o750)
   with patch.object(racing.release,'download',side_effect=lambda identity,path:path.write_bytes(b'\x7fELF\x02new')),patch.object(racing,'write',side_effect=OSError('receipt write fixture')):
    with self.assertRaises(OSError):racing.install(root,'beammp',{'VERSION':'v3.9.3'})
   self.assertEqual(binary.read_bytes(),b'original');self.assertEqual(binary.stat().st_mode&0o777,0o750)

unittest.main()
