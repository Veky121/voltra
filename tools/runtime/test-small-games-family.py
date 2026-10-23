import importlib.util,pathlib,sys,tempfile,unittest,zipfile,stat
base=pathlib.Path('/helpers');sys.path.insert(0,str(base))
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,base/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
load('steam_template','steam-template.py');load('native_config','native-config.py');load('native_console','native-console.py');load('native_release','native-release.py');runtime=load('family_runtime','small-games-family-runtime.py');installer=load('family_install','small-games-family-install.py')
class Native(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000','SERVER_MEMORY':'512'}
  for name in ['clone/Server','stk/bin/supertuxkart','tachyon/TachyonsCEServer.jar','.voltra/java8/bin/java','mohaa/omohaaded']:
   path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.touch()
 def tearDown(self):self.tmp.cleanup()
 def test_clone_literal_arguments_and_password(self):
  name='literal $(touch nope) "name"';password='safe_secret';cwd,argv,env,stop,secrets,ready=runtime.configure(self.root,'clone',{**self.env,'SERVER_DISPLAY_NAME':name,'SERVER_PASSWORD':password,'LOG_LEVEL':'3'});self.assertEqual(argv[argv.index('-n')+1],name);self.assertEqual(argv[argv.index('-ps')+1],password);self.assertEqual(secrets,[password]);self.assertEqual(stop,'\x03')
 def test_clone_blank_password_and_unsafe_text(self):
  self.assertIn('-np',runtime.configure(self.root,'clone',self.env)[1])
  with self.assertRaises(ValueError):runtime.configure(self.root,'clone',{**self.env,'SERVER_DISPLAY_NAME':'bad\nname'})
 def test_tachyon_preserves_operator_settings_and_heap_headroom(self):
  cfg=self.root/'tachyon/config.cfg';cfg.write_text('-- keep\nUNKNOWN=value\nSERVER_PORT=30303\n');argv=runtime.configure(self.root,'tachyon',{**self.env,'UNIVERSE_WIDTH':'8','UNIVERSE_HEIGHT':'8','START_LEVEL_X':'4','START_LEVEL_Y':'4'})[1];self.assertIn('-Xmx384M',argv);self.assertIn('UNKNOWN=value',cfg.read_text());self.assertIn('-- keep',cfg.read_text());self.assertIn('SERVER_PORT=28000',cfg.read_text())
 def test_tachyon_bounds_and_duplicates(self):
  self.assertIn('/exit',runtime.configure(self.root,'tachyon',self.env))
  with self.assertRaises(ValueError):runtime.patch('SERVER_PORT=1\nSERVER_PORT=2\n',{'SERVER_PORT':'3'})
 def test_stk_all_original_controls_as_literal_arguments(self):
  argv=runtime.configure(self.root,'stk',{**self.env,'SERVER_NAME':'Voltra "STK"','CONFIG_NAME':'my-server.xml','MODE':'5','DIFFICULTY':'3','MAX_PLAYERS':'24','MOTD':'literal ; message'})[1];self.assertIn('--mode=5',argv);self.assertIn('--difficulty=3',argv);self.assertIn('--max-players=24',argv);self.assertIn('--motd=literal ; message',argv);self.assertIn('--no-graphics',argv)
 def test_allocation_paths_and_symlink_guards(self):
  for env in [{**self.env,'SERVER_PORT':'28001'},{**self.env,'CONFIG_NAME':'../config.xml'}]:
   with self.assertRaises(ValueError):runtime.configure(self.root,'stk',env)
  (self.root/'escape.xml').symlink_to('/etc/passwd')
  with self.assertRaises(ValueError):runtime.configure(self.root,'stk',{**self.env,'CONFIG_NAME':'escape.xml'})
 def test_mohaa_missing_licensed_assets_explicit(self):
  with self.assertRaisesRegex(ValueError,'legally acquired'):runtime.configure(self.root,'mohaa',self.env)
 def test_mohaa_original_fields_and_supported_writable_path(self):
  from unittest.mock import patch
  import io
  (self.root/'main').mkdir();(self.root/'main/Pak0.pk3').touch()
  env={**self.env,'BASE_PATH':str(self.root),'LOG_DIR':str(self.root/'Logs'),'CONFIG_URL':'https://example.invalid/original.cfg','SERVER_NAME':'Native MOHAA','SERVER_MAXCLIENTS':'14','RCON_PASSWORD':'private-rcon','SERVER_PASSWORD':'private-join','SERVER_MAP':'obj/obj_team2'}
  with patch('urllib.request.urlopen',return_value=io.BytesIO(b'// operator template\nseta developer 0\n')):argv=runtime.configure(self.root,'mohaa',env)[1]
  self.assertIn('fs_homepath',argv);self.assertNotIn('fs_outputpath',argv);self.assertIn(str(self.root/'Logs'),argv);config=(self.root/'main/voltra-server.cfg').read_text();self.assertIn('Native MOHAA',config);self.assertIn('private-rcon',config);self.assertIn('private-join',config);self.assertIn('obj/obj_team2',config);self.assertIn('exec server.cfg',config);self.assertIn('operator template',(self.root/'main/server.cfg').read_text())
 def test_zip_links_traversal_and_case_duplicates_rejected(self):
  for names,mode in [(['server/../../escape'],0),(['server/link'],stat.S_IFLNK|0o777),(['server/Config','server/config'],0)]:
   archive=self.root/'bad.zip'
   with zipfile.ZipFile(archive,'w') as source:
    for name in names:entry=zipfile.ZipInfo(name);entry.external_attr=mode<<16;source.writestr(entry,'data')
   with self.assertRaises(ValueError):installer.extract_zip(archive,self.root/'stage','server/')
 def test_explicit_unsupported_version_no_latest_fallback(self):
  self.assertEqual(installer.resolve('tachyon',{'VERSION':'latest'})['version'],'v1.0.2')
  with self.assertRaisesRegex(ValueError,'only reviewed'):installer.resolve('tachyon',{'VERSION':'does-not-exist'})
if __name__=='__main__':unittest.main()
