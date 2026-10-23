import sys,types,tempfile,unittest,os,zipfile,tarfile,io,json
from pathlib import Path
for name,source in [('native_config',INI_SOURCE),('steam_template',STEAM_SOURCE),('native_console',CONSOLE_SOURCE),('java_games_install',INSTALL_SOURCE),('java_games_runtime',RUNTIME_SOURCE)]:
    module=types.ModuleType(name);sys.modules[name]=module;exec(source,module.__dict__)
runtime=sys.modules['java_games_runtime'];installer=sys.modules['java_games_install']

def env(**extra):return {'SERVER_PORT':'28001','SERVER_MEMORY':'2048','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003,28004,28005,28006',**extra}
def files(root,kind):
    for name in (['jre/bin/java','Server.jar'] if kind=='necesse' else ['.voltra/java21/bin/java','StarMade.jar'] if kind=='starmade' else ['.voltra/java8/bin/java','server.jar']):
        target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('fixture')
    (root/'linux64').mkdir(exist_ok=True)
    if kind=='starmade':
        with zipfile.ZipFile(root/'StarMade.jar','w') as z:z.writestr('META-INF/MANIFEST.MF','Main-Class: ExampleLegacyServer\r\n')

class RuntimeTests(unittest.TestCase):
    def test_necesse_literals_heap_and_persistent_world(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);files(root,'necesse')
            argv,child,stop,ready,secrets=runtime.launch(root,'necesse',env(SAVE_NAME='My $world "x"',SERVER_PASSWORD='literal $pass "x"',JAVA_TOOL_OPTIONS='-agentlib:bad',PYTHONHOME='wrong'))
            self.assertEqual(argv[argv.index('-world')+1],'My $world "x"');self.assertIn('-Xmx1664M',argv)
            self.assertEqual(argv[argv.index('-password')+1],'literal $pass "x"');self.assertIn('literal $pass "x"',secrets)
            self.assertEqual(stop,'stop');self.assertIn(b'Type help',ready);self.assertNotIn('JAVA_TOOL_OPTIONS',child);self.assertNotIn('PYTHONHOME',child)

    def test_invalid_worlds_and_slots_rejected(self):
        for key,value in [('SAVE_NAME','../world'),('SAVE_NAME','-port'),('SAVE_NAME','bad\nworld'),('SERVER_SLOTS','251'),('PAUSE_EMPTY','true'),('SERVER_PORT','65536')]:
            with self.subTest(key=key),tempfile.TemporaryDirectory() as d:
                root=Path(d);files(root,'necesse')
                with self.assertRaises(ValueError):runtime.launch(root,'necesse',env(**{key:value}))

    def test_starmade_jar_confined_and_literal(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);files(root,'starmade')
            argv,_,stop,_,_=runtime.launch(root,'starmade',env())
            self.assertEqual(stop,'/shutdown 0');self.assertIn('-port:28001',argv)
            self.assertTrue(argv[0].endswith('/.voltra/java21/bin/java'))
            with self.assertRaises(ValueError):runtime.launch(root,'starmade',env(SERVER_JARFILE='../outside.jar'))

    def test_rising_shifted_block_and_separate_rcon(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);files(root,'rising-world-java')
            (root/'.steam/sdk64').mkdir(parents=True)
            argv,child,stop,_,_=runtime.launch(root,'rising-world-java',env(RCON_PASSWORD='literal $x "p"',SERVER_NAME='Name $x "n"',LD_LIBRARY_PATH=str(root/'.voltra/python/lib')))
            self.assertEqual(child['LD_LIBRARY_PATH'],str(root/'linux64')+':'+str(root/'.steam/sdk64'))
            with self.assertRaises(ValueError):runtime.launch(root,'rising-world-java',env(RCON_PASSWORD='abcdef',VOLTRA_GAME_LD_LIBRARY_PATH='../outside'))
            self.assertIn('+rconport=28006',argv);self.assertIn('+servername=Name $x "n"',argv);self.assertEqual(stop,'shutdown')
            content=(root/'server.properties').read_text();self.assertIn('rcon_enabled=true',content);self.assertNotIn('literal $x "p"',content)
            self.assertEqual((root/'server.properties').stat().st_mode&511,0o600)

    def test_current_starmade_starloader_gets_required_publisher_agent_flags(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);files(root,'starmade')
            with zipfile.ZipFile(root/'StarMade.jar','w') as z:z.writestr('META-INF/MANIFEST.MF','Main-Class: api.starloader.StarMadeEntry\r\nPremain-Class: api.starloader.StarAgent\r\n')
            argv,_,_,_,_=runtime.launch(root,'starmade',env())
            self.assertIn('-javaagent:'+str(root/'StarMade.jar'),argv)
            self.assertIn('--add-opens=java.base/jdk.internal.ref=ALL-UNNAMED',argv)
            self.assertIn('--add-opens=java.base/java.nio=ALL-UNNAMED',argv)

    def test_rising_invalid_ports_and_missing_jar_do_not_write(self):
        for extra in [{'VOLTRA_ALLOCATED_PORTS':'28001,28002,28003,28004,28005,28006'},{'VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003,28004,28005'},{'RCON_PASSWORD':'short'}]:
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as d:
                root=Path(d);files(root,'rising-world-java')
                with self.assertRaises(ValueError):runtime.launch(root,'rising-world-java',env(**extra))
                self.assertFalse((root/'server.properties').exists())

    def test_properties_comments_crlf_unicode_and_backups(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);target=root/'server.properties';target.write_bytes(b'# operator\r\nunknown=yes\r\nrcon_password=old\r\n')
            values={'rcon_password':' 😀 back\\slash'}
            runtime.configure_properties(root,'server.properties',values)
            self.assertIn(b'# operator\r\nunknown=yes\r\n',target.read_bytes());self.assertIn('\\ud83d\\ude00',target.read_text())
            self.assertEqual(len(list((root/'.voltra/java-game/backups').iterdir())),1)
            runtime.configure_properties(root,'server.properties',values)
            self.assertEqual(len(list((root/'.voltra/java-game/backups').iterdir())),1)

    def test_duplicate_or_continued_property_rejected(self):
        for value in ['rcon_password=a\nrcon_password=b\n','rcon_password=a\\\nb\n']:
            with self.assertRaises(ValueError):runtime.properties(value,{'rcon_password':'new'})

    def test_symlink_config_does_not_write_outside(self):
        with tempfile.TemporaryDirectory() as d,tempfile.TemporaryDirectory() as outside:
            root=Path(d);target=Path(outside)/'operator';target.write_text('unchanged');(root/'server.properties').symlink_to(target)
            with self.assertRaises(ValueError):runtime.configure_properties(root,'server.properties',{'rcon_password':'value'})
            self.assertEqual(target.read_text(),'unchanged')

class InstallerTests(unittest.TestCase):
    def test_rising_old_legacy_branch_alias_maps_to_current_java_without_mutating_input(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);original={'SRCDS_BETAID':'legacy'};seen=[]
            previous_update,previous_java=installer.update,installer.java8
            installer.update=lambda root,app,env,**kwargs:seen.append((app,env['SRCDS_BETAID']))
            installer.java8=lambda root:None
            try:installer.install(root,'rising-world-java',original)
            finally:installer.update,installer.java8=previous_update,previous_java
            self.assertEqual(seen,[(339010,'java')]);self.assertEqual(original['SRCDS_BETAID'],'legacy')

    def test_config_restored_even_after_failed_steam_validation(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);target=root/'cfg/server.cfg';target.parent.mkdir();original=b'operator\x00raw';target.write_bytes(original);target.chmod(0o640);metadata=target.stat()
            previous=installer.update
            def failure(*args,**kwargs):target.write_bytes(b'publisher');raise RuntimeError('fixture failed')
            installer.update=failure
            try:
                with self.assertRaises(RuntimeError):installer.install(root,'necesse',{})
            finally:installer.update=previous
            self.assertEqual(target.read_bytes(),original)
            self.assertEqual(target.stat().st_mode&511,0o640);self.assertEqual(target.stat().st_uid,metadata.st_uid);self.assertEqual(target.stat().st_gid,metadata.st_gid)

    def test_starmade_preserves_existing_world_config_mod_and_jar_choice(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'.voltra').mkdir();archive=root/'.voltra/publisher.zip'
            with zipfile.ZipFile(archive,'w') as z:
                for name,value in {'StarMade.jar':'publisher','version.txt':installer.STARMADE['version'],'server.cfg':'publisher','server-database/world':'publisher','mods/operator':'publisher'}.items():z.writestr(name,value)
            for name in ['server.cfg','server-database/world','mods/operator']:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('operator')
            previous=installer.download;installer.download=lambda *a:archive
            try:installer.starmade(root)
            finally:installer.download=previous
            self.assertEqual((root/'StarMade.jar').read_text(),'publisher')
            for name in ['server.cfg','server-database/world','mods/operator']:self.assertEqual((root/name).read_text(),'operator')

    def test_archive_traversal_rejected_before_any_file_replacement(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);archive=root/'bad.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('StarMade.jar','bad');z.writestr('../outside','bad')
            previous=installer.download;installer.download=lambda *a:archive
            try:
                with self.assertRaises(ValueError):installer.starmade(root)
            finally:installer.download=previous
            self.assertFalse((root/'StarMade.jar').exists())

    def test_cached_download_must_match_sha(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);release={'sha256':installer.hashlib.sha256(b'fixture').hexdigest(),'url':'https://example.invalid/file'}
            target=root/'.voltra/java-game/downloads'/release['sha256'];target.parent.mkdir(parents=True);target.write_bytes(b'fixture')
            self.assertEqual(installer.download(root,release),target)

    def test_receipt_updates_preserve_operator_metadata_and_same_release_is_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            target=Path(d)/'release.json';target.write_text('old');target.chmod(0o640);os.chown(target,1000,1000)
            installer.write_receipt(target,{'version':'new'})
            self.assertEqual((target.stat().st_uid,target.stat().st_gid,target.stat().st_mode&511),(1000,1000,0o640))
            previous=target.stat();installer.write_receipt(target,{'version':'new'})
            self.assertEqual(target.stat().st_ino,previous.st_ino);self.assertEqual(target.stat().st_mtime_ns,previous.st_mtime_ns)

    def test_java_archive_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'.voltra').mkdir();archive=root/'bad.tar.gz'
            with tarfile.open(archive,'w:gz') as z:
                item=tarfile.TarInfo('jre/escape');item.type=tarfile.SYMTYPE;item.linkname='../../outside';z.addfile(item)
            previous=installer.download;installer.download=lambda *a:archive
            try:
                with self.assertRaises(ValueError):installer.java8(root)
            finally:installer.download=previous
            self.assertFalse((root/'.voltra/java8').exists())

unittest.main(argv=['java-game-fixtures'])
