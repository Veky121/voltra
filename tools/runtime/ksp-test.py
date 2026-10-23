import importlib.util,json,os,pathlib,sys,tempfile,unittest,xml.etree.ElementTree as ET,zipfile,stat
base=pathlib.Path('/helpers');sys.path.insert(0,str(base))
def load(name,file):
 s=importlib.util.spec_from_file_location(name,base/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
load('steam_template','steam-template.py');load('native_config','native-config.py');load('native_console','native-console.py');r=load('ksp_runtime','ksp-runtime.py');i=load('ksp_install','ksp-install.py')
class KSP(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);(self.root/'DMPServer.dll').touch();(self.root/'LMPServer').mkdir();(self.root/'LMPServer/Server.dll').touch();self.env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001'}
 def tearDown(self):self.temp.cleanup()
 def test_dmp_original_controls_and_literal_name(self):
  env={**self.env,'MODPACKMODE':'CKAN','WARPMODE':'MCW_VOTE','GAMEMODE':'SCIENCE','DIFFICULTY':'HARD','WHITELIST':'True','SERVERNAME':'literal $name = value','STATUS_PORT':'28001'}
  cwd,argv,environment,stop,credentials,ready=r.configure(self.root,'dmp',env);text=(self.root/'Config/Settings.txt').read_text();self.assertIn('serverName=literal $name = value',text);self.assertIn('warpMode=MCW_VOTE',text);self.assertIn('whitelisted=True',text);self.assertIn('httpPort=28001',text);self.assertEqual(stop,'/exit');self.assertEqual(argv[0:2],['dotnet','exec'])
 def test_dmp_unknown_lines_and_duplicate_guard(self):
  text=r.properties('# keep\nunknown=value\nport=123\n',{'port':28000});self.assertIn('# keep\nunknown=value',text);self.assertIn('port=28000',text)
  with self.assertRaises(ValueError):r.properties('port=1\nport=2\n',{'port':3})
 def test_lmp_all_original_case_sensitive_controls(self):
  env={**self.env,'SERVER_NAME':'Literal & <server>','PASSWORD':'secret&value','ADMIN_PASSWORD':'admin"value','MaxPlayers':'6','GameDifficulty':'Hard','GameMode':'Career'}
  cwd,argv,environment,stop,credentials,ready=r.configure(self.root,'lmp',env);config=ET.parse(self.root/'LMPServer/Config/GeneralSettings.xml').getroot();self.assertEqual(config.findtext('ServerName'),'Literal & <server>');self.assertEqual(config.findtext('Password'),'secret&value');self.assertEqual(config.findtext('AdminPassword'),'admin"value');self.assertEqual(config.findtext('MaxPlayers'),'6');self.assertEqual(config.findtext('GameMode'),'Career');self.assertEqual(stop,'\x03');self.assertIn('secret&value',credentials)
 def test_lmp_preserves_xml_comments_unknown_and_utf16(self):
  path=self.root/'LMPServer/Config/GeneralSettings.xml';path.parent.mkdir();path.write_text('<GeneralSettingsDefinition><!--keep--><Unknown>7</Unknown><MaxPlayers>9</MaxPlayers></GeneralSettingsDefinition>',encoding='utf-16');r.configure(self.root,'lmp',self.env);text=path.read_text();self.assertIn('<!--keep-->',text);self.assertIn('<Unknown>7</Unknown>',text)
 def test_lmp_explicit_preset_archives_once_and_custom_keeps_values(self):
  r.configure(self.root,'lmp',{**self.env,'GameDifficulty':'Easy'});path=self.root/'LMPServer/Config/GameplaySettings.xml';path.write_text('<GameplaySettingsDefinition><Custom>9</Custom></GameplaySettingsDefinition>');r.configure(self.root,'lmp',{**self.env,'GameDifficulty':'Easy'});self.assertTrue(path.exists());r.configure(self.root,'lmp',{**self.env,'GameDifficulty':'Custom'});self.assertTrue(path.exists());r.configure(self.root,'lmp',{**self.env,'GameDifficulty':'Hard'});self.assertFalse(path.exists());self.assertTrue(any((self.root/'.voltra/ksp/config-backups').glob('*GameplaySettings.xml')))
 def test_allocations_enums_and_injection_rejected(self):
  for change in [{'SERVER_PORT':'12'},{'STATUS_PORT':'28000'},{'STATUS_PORT':'28002'},{'SERVERNAME':'line\nbreak'},{'MODPACKMODE':'shell command'},{'DIFFICULTY':'bad'}]:
   with self.assertRaises(ValueError):r.configure(self.root,'dmp',{**self.env,**change})
 def test_xml_entities_and_external_paths_rejected(self):
  path=self.root/'LMPServer/Config/GeneralSettings.xml';path.parent.mkdir();path.write_text('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><GeneralSettingsDefinition/>')
  with self.assertRaises(ValueError):r.configure(self.root,'lmp',self.env)
  path.unlink();path.symlink_to('/etc/passwd')
  with self.assertRaises(ValueError):r.configure(self.root,'lmp',self.env)
 def test_zip_traversal_symlink_and_duplicate_rejected(self):
  for name,mode in [('DMPServer/../../outside',0),('DMPServer/link',stat.S_IFLNK|0o777)]:
   archive=self.root/'bad.zip'
   with zipfile.ZipFile(archive,'w') as z:entry=zipfile.ZipInfo(name);entry.external_attr=mode<<16;z.writestr(entry,'data')
   with self.assertRaises(ValueError):i.unpack(archive,self.root/'stage','DMPServer')
 def test_explicit_net10_patch_and_unsupported_source_rejection(self):
  source=self.root/'source';(source/'Server/Utilities').mkdir(parents=True);project=source/'Server/Server.csproj';project.write_text('<Project Sdk="Microsoft.NET.Sdk"><TargetFramework>net6.0</TargetFramework></Project>');checker=source/'Server/Utilities/DotNetRuntimeChecker.cs';checker.write_text('private const int RequiredMajorVersion = 6; .NET 6')
  changed=i.patch_source(source);self.assertIn('Server/Server.csproj',changed);self.assertIn('net10.0',project.read_text());self.assertIn('= 10;',checker.read_text());project.write_text('<Project><TargetFramework>net472</TargetFramework></Project>')
  with self.assertRaises(ValueError):i.patch_source(source)
 def test_dmp_socket_shutdown_patch_is_idempotent_and_preserves_protocol_buffer(self):
  source=self.root/'dmp';(source/'Server').mkdir(parents=True);(source/'Common').mkdir();project=source/'Server/Server.csproj';project.write_text('<TargetFrameworks>net472;net6.0</TargetFrameworks>');client=source/'Server/ClientHandler.cs';client.write_text('TCPServer.Server.DualMode = true;');main=source/'Server/Main.cs';main.write_text('commandThread.Start(); commandThread.Abort(); clientThread.Join();');common=source/'Common/Common.cs';common.write_text('public const int MAX_MESSAGE_SIZE = 1024 * 1024 * 1024;')
  i.dmp_patch(source);before=[p.read_bytes() for p in [project,client,main,common]];i.dmp_patch(source);self.assertEqual(before,[p.read_bytes() for p in [project,client,main,common]]);self.assertIn('InterNetworkV6',client.read_text());self.assertNotIn('Thread.Abort()',main.read_text());self.assertIn('clientThread.Join()',main.read_text());self.assertIn('1024 * 1024 * 1024',common.read_text())
 def test_actual_wings_uppercase_lmp_variables_and_conflicts(self):
  r.configure(self.root,'lmp',{**self.env,'MAXPLAYERS':'4','GAMEDIFFICULTY':'Normal','GAMEMODE':'Career'});tree=ET.parse(self.root/'LMPServer/Config/GeneralSettings.xml');self.assertEqual(tree.findtext('MaxPlayers'),'4');self.assertEqual(tree.findtext('GameDifficulty'),'Normal');self.assertEqual(tree.findtext('GameMode'),'Career')
  with self.assertRaises(ValueError):r.configure(self.root,'lmp',{**self.env,'MAXPLAYERS':'4','MaxPlayers':'5'})
 def test_lmp_reviewed_dependency_and_http_patches(self):
  source=self.root/'lmp';(source/'Server/Utilities').mkdir(parents=True);(source/'uhttpsharp').mkdir();project=source/'Server/Server.csproj';project.write_text('<Project Sdk="Microsoft.NET.Sdk"><TargetFramework>net6.0</TargetFramework><PackageReference Include="DotNetZip" Version="1.15.0"/><PackageReference Include="Newtonsoft.Json" Version="12.0.3"/><PackageReference Include="log4net" Version="2.0.12"/></Project>');http=source/'uhttpsharp/HttpClient.cs';http.write_text('new StreamWriter(limitedStream) { AutoFlush = false }');i.patch_source(source);self.assertIn('ProDotNetZip" Version="1.19.0',project.read_text());self.assertIn('Newtonsoft.Json" Version="13.0.4',project.read_text());self.assertIn('log4net" Version="3.3.0',project.read_text());self.assertIn('NewLine = "\\r\\n"',http.read_text());before=http.read_bytes();i.patch_source(source);self.assertEqual(before,http.read_bytes())
 def test_lmp_sigint_handler_suppresses_default_process_termination(self):
  source=self.root/'signal';(source/'Server').mkdir(parents=True);(source/'Server/Server.csproj').write_text('<Project Sdk="Microsoft.NET.Sdk"><TargetFramework>net6.0</TargetFramework></Project>');main=source/'Server/MainServer.cs';main.write_text('Console.CancelKeyPress += (sender, args) => Exit();');i.patch_source(source);self.assertIn('args.Cancel = true; Exit();',main.read_text());before=main.read_bytes();i.patch_source(source);self.assertEqual(before,main.read_bytes())
 def test_native_misdeclared_utf8_xml_and_utf16_entities(self):
  path=self.root/'LMPServer/Config/GeneralSettings.xml';path.parent.mkdir();path.write_bytes(b'<?xml version="1.0" encoding="utf-16"?><GeneralSettingsDefinition><MaxPlayers>3</MaxPlayers></GeneralSettingsDefinition>');r.configure(self.root,'lmp',{**self.env,'MAXPLAYERS':'4'});self.assertEqual(ET.parse(path).findtext('MaxPlayers'),'4')
  path.write_text('<!DOCTYPE x [<!ENTITY a "x">]><GeneralSettingsDefinition><ServerName>&a;</ServerName></GeneralSettingsDefinition>',encoding='utf-16')
  with self.assertRaises(ValueError):r.configure(self.root,'lmp',self.env)
if __name__=='__main__':unittest.main()
