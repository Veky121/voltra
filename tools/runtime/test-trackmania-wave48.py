import importlib.util,io,json,os,socket,subprocess,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('track48',Path('internal/panel/game_library/scripts/truck-trackmania-native.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
XML='<dedicated><!-- unknown -->\r\n<masterserver_account><login></login><password></password></masterserver_account>\r\n<server_options><name>old</name><comment>old</comment><password></password><array><row>1</row><row>2</row></array></server_options>\r\n<system_config><server_port>2350</server_port><xmlrpc_port>5000</xmlrpc_port></system_config></dedicated>\r\n'
ENV={'SERVER_PORT':'28002','SERVER_PASSWORD':'secret<&'}
class Trackmania(unittest.TestCase):
 def setUp(self):
  if not hasattr(os,'fchown'):
   p=patch.object(os,'fchown',create=True);p.start();self.addCleanup(p.stop)
  self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup);self.root=Path(self.t.name)
  for obj,name in [(socket,'socket'),(subprocess,'Popen'),(subprocess,'run'),(os,'system')]:
   p=patch.object(obj,name,side_effect=AssertionError('unmocked boundary'));p.start();self.addCleanup(p.stop)
  for obj,name in [(m.release,'download'),(m.steam,'update'),(m,'helper')]:
   p=patch.object(obj,name,side_effect=AssertionError('unmocked acquisition/process'));p.start();self.addCleanup(p.stop)
 def config(self,data=XML):
  p=self.root/'UserData/Config/dedicated_cfg.txt';p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data.encode());return p
 def test_config_bytes_arrays_secrets_and_ports(self):
  p=self.config();argv,secrets=m.configure(self.root,'trackmania',ENV)
  expected=XML.replace('<name>old</name>','<name>Trackmania</name>').replace('<comment>old</comment>','<comment></comment>').replace('<password></password></server_options>','<password>secret&lt;&amp;</password></server_options>').replace('<password></password><array>','<password>secret&lt;&amp;</password><array>').replace('<server_port>2350','<server_port>28002')
  self.assertEqual(p.read_bytes(),expected.encode());self.assertIn(ENV['SERVER_PASSWORD'],secrets);self.assertNotIn('secret',str(argv));self.assertIn('/game_settings=MatchSettings/example.txt',argv)
 def test_refusal_before_writes_or_download(self):
  p=self.config();before=p.read_bytes()
  for extra in [{'SERVER_PORT':'65536'},{'SERVER_PORT':' +2'},{'SERVER_NAME':'bad\n'},{'GAME_CONFIG':'../escape'},{'MASTERSERVER_PASSWORD':'x'*31}]:
   with self.assertRaises(ValueError):m.install(self.root,'trackmania',{**ENV,**extra})
   self.assertEqual(p.read_bytes(),before);self.assertFalse((self.root/'.voltra').exists())
 def test_malformed_and_unknown_bytes_refuse_unchanged(self):
  for data in [b'\xff',XML.replace('<name>old</name>','<name>a</name><name>b</name>').encode()]:
   p=self.config();p.write_bytes(data)
   with self.assertRaises((ValueError,UnicodeError)):m.configure(self.root,'trackmania',ENV)
   self.assertEqual(p.read_bytes(),data);self.assertFalse((self.root/'.voltra').exists())
 def install_fixture(self,fail=False,missing=False):
  operator=self.config();save=self.root/'UserData/Replays/operator.Gbx';save.parent.mkdir();save.write_bytes(b'operator\x00\xff')
  mod=self.root/'plugin.bin';mod.write_bytes(b'mod\xff')
  def download(meta,path):
   if fail:raise OSError('mock download failure')
   with zipfile.ZipFile(path,'w') as z:
    z.writestr('TrackmaniaServer',b'mocked executable, never run')
    if not missing:z.writestr('UserData/Config/dedicated_cfg.default.txt',XML)
    z.writestr('UserData/Maps/MatchSettings/example.txt','publisher playlist')
    z.writestr('UserData/Replays/operator.Gbx','replacement')
    z.writestr('plugin.bin','replacement')
  # Preserve uses only source-install restore_file. No subprocess or network.
  source=importlib.util.spec_from_file_location('restore48',Path('internal/panel/game_library/scripts/source-install.py'));restore=importlib.util.module_from_spec(source);source.loader.exec_module(restore)
  with patch.object(m.release,'download',side_effect=download),patch.object(m,'helper',side_effect=lambda name:restore if name=='source-install' else self.fail('unexpected helper')):
   if fail or missing:
    with self.assertRaises((OSError,ValueError)):m.install(self.root,'trackmania',ENV)
   else:m.install(self.root,'trackmania',ENV)
  self.assertEqual(operator.read_bytes(),XML.encode());self.assertEqual(save.read_bytes(),b'operator\x00\xff');self.assertEqual(mod.read_bytes(),b'mod\xff')
  if missing:self.assertFalse((self.root/'TrackmaniaServer').exists())
 def test_mock_update_success(self):self.install_fixture()
 def test_mock_update_failure(self):self.install_fixture(fail=True)
 def test_missing_geometry_before_payload_write(self):self.install_fixture(missing=True)
 def test_symlink_destination_refuses_before_any_payload_write(self):
  self.config();outside=self.root/'outside';outside.mkdir()
  try:(self.root/'UserData/Maps').mkdir();(self.root/'UserData/Maps/escape').symlink_to(outside,target_is_directory=True)
  except OSError as e:self.skipTest('Windows symlink privilege unavailable: '+str(e))
  with self.assertRaises(ValueError):m.install(self.root,'trackmania',{**ENV,'GAME_CONFIG':'escape/test.txt'})
  self.assertFalse((self.root/'.voltra').exists())
 def test_launch_refuses_invalid_port_before_process(self):
  p=self.config()
  with self.assertRaises(ValueError):m.run(self.root,'trackmania',{**ENV,'SERVER_PORT':'0'})
  self.assertEqual(p.read_bytes(),XML.encode())
 def test_emitted_filenames(self):
  profile=json.loads(Path('artifacts/game-parity-20261029/wave48-trackmania/profile-fragment.json').read_text())['trackmania/egg-trackmania.json']
  script=profile['egg']['scripts']['installation']['script']
  self.assertIn('cat > .voltra/steam_template.py',script)
  import re
  emitted=dict(re.findall(r"cat > (\S+) <<'VOLTRA_NATIVE_SOURCE'\n([\s\S]*?)\nVOLTRA_NATIVE_SOURCE",script))
  self.assertEqual(emitted['.voltra/truck-trackmania-native.py'],Path('internal/panel/game_library/scripts/truck-trackmania-native.py').read_text())
  self.assertIn('.voltra/native-config.py',emitted)
  for name,content in emitted.items():compile(content,name,'exec')
unittest.main()
