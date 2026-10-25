import os
import io
import json
import sys
import types
import tempfile
import zipfile
import hashlib
import stat
import signal
from pathlib import Path
import unittest
from unittest import mock
for name,source in SOURCES:
    module=types.ModuleType(name);exec(source,module.__dict__);sys.modules[name]=module
runtime=sys.modules['publisher_runtime'];installer=sys.modules['publisher_install']


class PublisherTests(unittest.TestCase):
    def hytale(self,root,**extra):
        (root/'Server').mkdir(exist_ok=True)
        for name in('Server/HytaleServer.jar','Server/HytaleServer.aot','Assets.zip'):(root/name).write_bytes(b'lawful operator fixture')
        return{'VOLTRA_PUBLISHER':'hytale','ACQUISITION_MODE':'operator','SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011','INSTALL_SOURCEQUERY_PLUGIN':'0',**extra}

    def java(self,version=25):return mock.patch.object(runtime.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=('openjdk version "'+str(version)+'.0.1"\n').encode()))

    def titans(self,root,**extra):
        (root/'server').mkdir(exist_ok=True);(root/'server/PathOfTitansServer.sh').write_bytes(b'lawful operator fixture')
        return{'VOLTRA_PUBLISHER':'titans','ACQUISITION_MODE':'operator','SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28013,7778,7779','QUERY_PORT':'7778','RCON_PORT':'7779','SERVER_GUID':'550e8400-e29b-41d4-a716-446655440000','AG_AUTH_TOKEN':'fixture.private.token','SERVER_MAP':'Island','SERVER_NAME':"Literal $value 'dino'",**extra}

    def hogwarp(self,root,**extra):
        (root/'HogWarpServer.exe').write_bytes(b'lawful operator fixture')
        return{'VOLTRA_PUBLISHER':'hogwarp','ACQUISITION_MODE':'operator','SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','API_KEY':'fixture-private-key','SERV_NAME':'Literal "quoted" $server','SERV_DESC':'Description \\literal','MAX_PLAYERS':'4',**extra}

    def test_hytale_current_java25_all_original_controls_operator_payload(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.hytale(root,HYTALE_ALLOW_OP='1',HYTALE_ACCEPT_EARLY_PLUGINS='1',DISABLE_SENTRY='1',USE_AOT_CACHE='1',HYTALE_AUTH_MODE='insecure',HYTALE_PATCHLINE='pre-release',SERVER_MEMORY='4096')
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/java'),self.java():argv,child,secrets,ready,stop,selected_signal=runtime.configure(root,env)
            for flag in('--allow-op','--accept-early-plugins','--disable-sentry','-Xms128M','-Xmx4096M'):self.assertIn(flag,argv)
            self.assertIn('-XX:AOTCache='+str(root/'Server/HytaleServer.aot'),argv);self.assertEqual(argv[argv.index('--auth-mode')+1],'insecure');self.assertIn('0.0.0.0:28010',argv);self.assertEqual(stop,'/stop');self.assertIsNone(selected_signal);self.assertEqual(ready,b'Hytale Server Booted')
            with mock.patch.object(runtime,'configure',return_value=(argv,child,secrets,ready,stop,None)),mock.patch.object(runtime,'run',return_value=8)as native:self.assertEqual(runtime.main(root,env),8)
            self.assertNotIn('stop_signal',native.call_args.kwargs)

    def test_hytale_missing_prerequisites_invalid_java_and_query_fail_before_plugin_writes(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.hytale(root,INSTALL_SOURCEQUERY_PLUGIN='1',QUERY_PORT='28010')
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/java'),self.java(24),mock.patch.object(runtime,'install_query')as plugin,self.assertRaises(ValueError):runtime.configure(root,env)
            plugin.assert_not_called()
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/java'),self.java(),mock.patch.object(runtime,'install_query')as plugin,self.assertRaises(ValueError):runtime.configure(root,env)
            plugin.assert_not_called();self.assertFalse((root/'mods').exists())
            (root/'Assets.zip').unlink()
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/java'),self.java(),self.assertRaises(ValueError):runtime.configure(root,env)

    def test_pinned_sourcequery_operator_toggle_preserves_bytes_and_custom_conflict(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);mods=root/'mods';mods.mkdir();jar=mods/'hytale-sourcequery.jar';content=b'public fixture plugin';jar.write_bytes(content);pin=hashlib.sha256(content).hexdigest()
            with mock.patch.dict(installer.QUERY,{'sha256':pin}):
                installer.install_query(root,'operator',False);self.assertFalse(jar.exists());self.assertEqual((root/'.voltra/publisher/disabled-sourcequery.jar').read_bytes(),content)
                installer.install_query(root,'operator',True);self.assertEqual(jar.read_bytes(),content)
            jar.write_bytes(b'operator custom plugin')
            with self.assertRaises(ValueError):installer.install_query(root,'operator',False)
            self.assertEqual(jar.read_bytes(),b'operator custom plugin')

    def test_titans_original_controls_native_query_compat_properties_and_private_env(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.titans(root,SERVER_DB='Remote',SERVER_MAX_PLAYERS='100',BETA_BRANCH='demo-public-test')
            properties=root/'server.properties';properties.write_text('# operator\ncustom=73\nserver-port=1\n')
            argv,child,secrets,ready,stop,selected_signal=runtime.configure(root,env)
            for flag in('-Port=28010','-QueryPort=7778','-RconPort=7779','-Database=Remote','-BranchKey=demo-public-test',"-ServerName=Literal $value 'dino'"):self.assertIn(flag,argv)
            self.assertIn('Island?listen?MaxPlayers=100',argv);self.assertNotIn(env['AG_AUTH_TOKEN'],' '.join(argv));self.assertEqual(child['AG_AUTH_TOKEN'],env['AG_AUTH_TOKEN']);self.assertIn(env['AG_AUTH_TOKEN'],secrets);self.assertEqual(selected_signal,signal.SIGINT)
            native=(root/'server/PathOfTitans/Saved/Config/LinuxServer/Game.ini').read_text();self.assertIn('[SourceQuery]',native);self.assertIn('Port = 7778',native);self.assertIn('# operator\ncustom=73',properties.read_text());self.assertIn('query.port=7778',properties.read_text())

    def test_titans_missing_entitlement_identity_and_port_collisions_fail_before_files(self):
        for extra in({'AG_AUTH_TOKEN':''},{'AG_AUTH_TOKEN':'bad\nsecret'},{'SERVER_GUID':''},{'QUERY_PORT':'28011'},{'BETA_BRANCH':'unknown'},{'SERVER_MAP':'../escape'}):
            with self.subTest(extra=extra),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.titans(root,**extra)
                with self.assertRaises(ValueError):runtime.configure(root,env)
                self.assertFalse((root/'server.properties').exists());self.assertFalse((root/'server/PathOfTitans/Saved').exists())

    def test_titans_publisher_update_retains_operator_config_saves_on_failure(self):
        for status in(0,2):
            with self.subTest(status=status),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.titans(root,ACQUISITION_MODE='publisher');(root/'AlderonGamesCmd-Linux').write_bytes(b'publisher downloader fixture');path=root/'server/PathOfTitans/Saved/SaveGames/world.sav';path.parent.mkdir(parents=True);path.write_bytes(b'operator save');path.chmod(0o640)
                def update(*args,**kwargs):
                    self.assertIn(env['AG_AUTH_TOKEN'],kwargs['credentials']);path.write_bytes(b'publisher replaced');return status
                with mock.patch.object(runtime,'run',side_effect=update):
                    if status:
                        with self.assertRaises(RuntimeError):runtime.acquire(root,env)
                    else:runtime.acquire(root,env)
                self.assertEqual(path.read_bytes(),b'operator save');self.assertEqual(path.stat().st_mode&0o777,0o640)

    def test_hogwarp_literal_json_operator_admin_and_original_wine_controls(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.hogwarp(root);(root/'config.json').write_text(json.dumps({'OperatorNative':73}))
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/wine'),mock.patch.dict(os.environ,{'DISPLAY':':99'}):argv,child,secrets,_,_,selected_signal=runtime.configure(root,env)
            data=json.loads((root/'config.json').read_text());self.assertEqual(data['ApiKey'],env['API_KEY']);self.assertEqual(data['Name'],env['SERV_NAME']);self.assertEqual(data['Description'],env['SERV_DESC']);self.assertEqual(data['MaxPlayer'],4);self.assertEqual(data['OperatorNative'],73);self.assertNotIn(env['API_KEY'],' '.join(argv));self.assertIn(env['API_KEY'],secrets);self.assertEqual(child['WINEDLLOVERRIDES'],'mscoree=n,b;mshtml=n,b');self.assertEqual(child['WINEARCH'],'win64');self.assertEqual(selected_signal,signal.SIGINT)

    def test_hogwarp_placeholder_missing_runtime_ambiguity_and_duplicate_json_refused(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.hogwarp(root,API_KEY='CHANGEME')
            with self.assertRaises(ValueError):runtime.configure(root,env)
            self.assertFalse((root/'config.json').exists());env['API_KEY']='fixture-private-key'
            with mock.patch.object(runtime.shutil,'which',return_value=None),self.assertRaises(ValueError):runtime.configure(root,env)
            (root/'Server.Loader.exe').write_bytes(b'new layout fixture')
            with self.assertRaises(ValueError):runtime.configure(root,env)
            (root/'HogWarpServer.exe').unlink();(root/'config.json').write_bytes(b'{"ApiKey":"one","ApiKey":"two"}')
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/wine'),mock.patch.dict(os.environ,{'DISPLAY':':99'}),self.assertRaises(ValueError):runtime.configure(root,env)

    def test_archive_traversal_links_and_mirrors_rejected_without_external_write(self):
        for name,mode in[('../outside',stat.S_IFREG),('symlink',stat.S_IFLNK)]:
            with self.subTest(name=name),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);archive=root/'payload.zip';ready=root/'ready';ready.mkdir()
                with zipfile.ZipFile(archive,'w')as output:
                    info=zipfile.ZipInfo(name);info.external_attr=(mode|0o644)<<16;output.writestr(info,b'payload')
                with self.assertRaises(ValueError):installer.extract(archive,ready)
                self.assertEqual(list(ready.iterdir()),[])
        for url in('http://downloader.hytale.com/file','https://evil.test/server.zip','https://user:pass@cdn.discordapp.com/file'):
            with self.assertRaises(ValueError):installer.public_url(url)

    def test_operator_install_never_claims_or_attempts_download(self):
        for kind in('hytale','titans','hogwarp'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as directory:
                root=Path(directory)
                with mock.patch.object(installer,'download')as download:installer.install(root,{'VOLTRA_PUBLISHER':kind,'ACQUISITION_MODE':'operator'})
                download.assert_not_called();self.assertEqual(list(root.iterdir()),[])

    def test_hogwarp_lawful_archive_preserves_existing_json_and_plugins_metadata(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);archive=root/'operator.zip';cfg=root/'config.json';cfg.write_bytes(b'{"OperatorNative":73}');cfg.chmod(0o640);plugins=root/'plugins';plugins.mkdir();state=plugins/'private.state';state.write_bytes(b'operator private state');state.chmod(0o600)
            with zipfile.ZipFile(archive,'w')as payload:
                payload.writestr('HogWarpServer.exe',b'publisher fixture');payload.writestr('config.json',b'{"PublisherDefault":true}');payload.writestr('plugins/private.state',b'publisher replacement')
            with mock.patch.object(installer,'download')as download:installer.install(root,{'VOLTRA_PUBLISHER':'hogwarp','OPERATOR_ARCHIVE':'operator.zip'})
            download.assert_not_called();self.assertEqual(cfg.read_bytes(),b'{"OperatorNative":73}');self.assertEqual(cfg.stat().st_mode&0o777,0o640);self.assertEqual(state.read_bytes(),b'operator private state');self.assertEqual(state.stat().st_mode&0o777,0o600);self.assertTrue((root/'HogWarpServer.exe').is_file())

    def test_private_helper_namespaces_cannot_be_imported_from_archive(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);(root/'.voltra').mkdir()
            with self.assertRaises(ValueError):installer.payload_namespace(root)


unittest.main()
