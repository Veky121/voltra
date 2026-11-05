import importlib.util, json, re, tempfile, unittest, contextlib, socket
from pathlib import Path
from unittest.mock import patch, Mock
BASE=Path('internal/panel/game_library/scripts')
def load(path):
 s=importlib.util.spec_from_file_location('rising_fixture',path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class Rising(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.m=load(BASE/'steam-native-next.py');self.env={'SERVER_PORT':'4255','VOLTRA_ALLOCATED_PORTS':'4254,4255,4256','RCON_PASS':'fixture-secret'}
  self.addCleanup(patch.stopall)
  patch.object(socket,'socket',side_effect=AssertionError('network forbidden')).start()
  patch.object(self.m.steam,'bootstrap',side_effect=AssertionError('bootstrap forbidden')).start()
  patch.object(self.m.urllib.request,'urlopen',side_effect=AssertionError('network forbidden')).start()
 def test_preserve_repeated_operator_settings(self):
  f=self.root/'server.properties';raw=b'\xef\xbb\xbf# keep\r\nServer_Name=operator\r\nServer_Password=secret\\literal\r\nWorld_Name=operatorworld\r\nWorld_GameMode=Creative\r\nRCON_Enabled=false\r\nRCON_Password=private-value\r\nRCON_Port=4253\r\nServer_Port=4255\r\nUnknown[]=a\r\nUnknown[]=b\r\n';f.write_bytes(raw)
  for _ in range(2):
   argv,secrets=self.m.configure(self.root,'rising',self.env);self.assertEqual(f.read_bytes(),raw);self.assertIn('secret\\literal',secrets);self.assertNotIn('private-value',' '.join(argv))
 def test_seed_and_effective_rcon(self):
  self.m.configure(self.root,'rising',self.env);f=self.root/'server.properties';f.write_text(f.read_text().replace('RCON_Enabled=false','RCON_Enabled=true').replace('World_Name=myworld','World_Name=edited'))
  self.m.configure(self.root,'rising',{**self.env,'RCON':'false','WORLD_NAME':'ignored'})
  self.assertIn('World_Name=edited',f.read_text());self.assertIn('RCON_Port=4256',f.read_text())
 def test_refuse_before_side_effects(self):
  bad=[{'WORLD_NAME':'../bad'},{'VOLTRA_ALLOCATED_PORTS':'4255'},{'SRCDS_BETAID':'+bad'},{'VOLTRA_STEAM_AUTO_UPDATE':'bad'},{'RCON':'true','RCON_PASS':'x'},{'RCON_PORT':'0'}]
  for changes in bad:
   root=self.root/'absent'
   for action in (self.m.install,self.m.run):
    with patch.object(self.m.steam,'update',side_effect=AssertionError('update forbidden')):
     with self.assertRaises(ValueError):action(root,'rising',{**self.env,**changes})
    self.assertFalse(root.exists())
 def test_invalid_documents_unchanged(self):
  for raw in (b'World_Name=../bad\n',b'RCON_Enabled=TRUE\n',b'World_GameMode=Other\n',b'Server_Name=a\nserver_name=b\n',b'Password=a\nServer_Password=b\n',b'World_Name=a\nWorld_Name=b\n'):
   f=self.root/'server.properties';f.write_bytes(raw)
   with patch.object(self.m.steam,'update',side_effect=AssertionError('update forbidden')):
    with self.assertRaises(ValueError):self.m.run(self.root,'rising',{**self.env,'VOLTRA_STEAM_AUTO_UPDATE':'1'})
   self.assertEqual(f.read_bytes(),raw)
 def test_mocked_update_retains_operator_bytes_success_and_failure(self):
  self.m.configure(self.root,'rising',self.env);f=self.root/'server.properties';original=f.read_bytes();(self.root/'Worlds').mkdir();save=self.root/'Worlds/save.bin';save.write_bytes(b'operator-world')
  for failure in (False,True):
   def update(*args,**kw):
    f.write_text('publisher replacement');save.write_bytes(b'wrong')
    if failure:raise RuntimeError('mock update failure')
   with patch.object(self.m.steam,'update',side_effect=update):
    if failure:
     with self.assertRaises(RuntimeError):self.m.install(self.root,'rising',self.env)
    else:self.m.install(self.root,'rising',self.env)
   self.assertEqual(f.read_bytes(),original);self.assertEqual(save.read_bytes(),b'operator-world')
 def test_emitted_imports_and_startup(self):
  profile=json.loads(Path('.local/steam-native-next/rising-profiles.json').read_text())['rising_world/unity/egg-rising-world-unity.json'];script=profile['egg']['scripts']['installation']['script'];folder=self.root/'.voltra';folder.mkdir()
  for name,delimiter,source in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2\n",script,re.S):(folder/name).write_text(source)
  self.assertIn('.voltra/steam-native-next.py run rising',profile['egg']['startup']);self.assertIn('python3 .voltra/steam-native-next.py install rising',script)
  m=load(folder/'steam-native-next.py');console=Mock();console.run.return_value=0
  with patch.object(m.steam,'update') as update,patch.object(m,'helper',return_value=console):
   self.assertEqual(m.run(self.root,'rising',self.env),0);update.assert_not_called();self.assertTrue(console.run.call_args.args[1][0].endswith('RisingWorldServer.x64'))
 def test_successful_auto_update_entrypoint(self):
  console=Mock();console.run.return_value=0;original=self.m.helper
  with patch.object(self.m.steam,'update') as update,patch.object(self.m,'helper',side_effect=lambda name:console if name=='native-console' else original(name)):
   self.assertEqual(self.m.run(self.root,'rising',{**self.env,'VOLTRA_STEAM_AUTO_UPDATE':'1'}),0)
   update.assert_called_once();console.run.assert_called_once()
if __name__=='__main__':unittest.main()
