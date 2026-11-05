import json,re,sys,tempfile,runpy,os,zipfile,unittest,hashlib,types
from pathlib import Path
from unittest.mock import patch
repo=Path(__file__).resolve().parents[2]
out=repo/'artifacts/game-parity-20261029/wave60-starmade'
profile=json.loads((out/'final/recipe-fragment.json').read_text())['starmade/egg-starmade.json']
script=profile['egg']['scripts']['installation']['script']
with tempfile.TemporaryDirectory(prefix='wave60-starmade-') as temporary:
    stage=Path(temporary)
    for name,source in re.findall(r"cat > .voltra/([\w.]+) <<'VOLTRA_JAVA_SOURCE'\n(.*?)\nVOLTRA_JAVA_SOURCE",script,re.S):
        (stage/name).write_text(source)
    sys.path.insert(0,str(stage))
    import java_games_install as install,java_games_runtime as runtime
    env={'SERVER_PORT':'28012','SERVER_MEMORY':'4096','VOLTRA_ALLOCATED_PORTS':'28012'}
    class Tests(unittest.TestCase):
        def test_install_and_start_entrypoint_preflight(self):
            for changes in ({'SERVER_PORT':'28013'},{'SERVER_MEMORY':'bad'},{'SERVER_JARFILE':'../private.jar'},{'VOLTRA_ALLOCATED_PORTS':'bad'}):
                for entry in ('java_games_install.py','java_games_runtime.py'):
                    with self.subTest(entry=entry,changes=changes),tempfile.TemporaryDirectory() as d:
                        old=Path.cwd();os.chdir(d)
                        try:
                            with patch.dict(os.environ,{**env,**changes},clear=True),patch.object(sys,'argv',[entry,'starmade']),patch.object(install,'download',side_effect=AssertionError('acquisition')),patch.object(sys.modules['native_console'],'run',side_effect=AssertionError('process')):
                                with self.assertRaises(ValueError):runpy.run_path(str(stage/entry),run_name='__main__')
                            self.assertEqual(list(Path(d).iterdir()),[])
                        finally:os.chdir(old)
        def test_archive_refusal_and_preservation(self):
            for bad in ('version','managed','duplicate'):
                with self.subTest(bad=bad),tempfile.TemporaryDirectory() as d:
                    root=Path(d);jar=root/'StarMade.jar';jar.write_bytes(b'old');jar.chmod(0o640);before=jar.stat()
                    archive=root/'fixture.zip'
                    with zipfile.ZipFile(archive,'w') as z:
                        z.writestr('StarMade.jar','new');z.writestr('version.txt','wrong' if bad=='version' else install.STARMADE['version'])
                        if bad=='managed':z.writestr('.voltra/evil','bad')
                        if bad=='duplicate':z.writestr('StarMade.jar','duplicate')
                    with patch.object(install,'download',return_value=archive):
                        with self.assertRaises(ValueError):install.starmade(root)
                    self.assertEqual(jar.read_bytes(),b'old');self.assertEqual(jar.stat(),before)
        def test_success_and_publisher_failure_preserve_native_authority(self):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d);archive=root/'fixture.zip';(root/'.voltra').mkdir()
                protected=['server.cfg','mods/operator','server-database/world','admins.txt','blueprints/operator']
                snapshots={}
                for name in protected:
                    p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('operator secret');p.chmod(0o640);s=p.stat();snapshots[name]=(p.read_bytes(),s.st_mode,s.st_uid,s.st_gid,s.st_mtime_ns)
                with zipfile.ZipFile(archive,'w') as z:
                    z.writestr('StarMade.jar','fixture');z.writestr('version.txt',install.STARMADE['version'])
                    for name in protected:z.writestr(name,'publisher')
                    z.writestr('mods/new','must not seed existing tree')
                with patch.object(install,'download',return_value=archive),patch.object(install,'java_runtime') as java:
                    install.install(root,'starmade',env);java.assert_called_once_with(root,install.JAVA21,'java21')
                self.assertFalse((root/'mods/new').exists())
                with patch.object(install,'download',side_effect=ValueError('publisher failure')):
                    with self.assertRaises(ValueError):install.install(root,'starmade',env)
                for name,snapshot in snapshots.items():
                    p=root/name;s=p.stat();self.assertEqual((p.read_bytes(),s.st_mode,s.st_uid,s.st_gid,s.st_mtime_ns),snapshot)
        def test_start_entrypoint_mocked_console(self):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d);java=root/'.voltra/java21/bin/java';java.parent.mkdir(parents=True);java.write_text('fixture')
                with zipfile.ZipFile(root/'StarMade.jar','w') as z:z.writestr('META-INF/MANIFEST.MF','Main-Class: api.starloader.StarMadeEntry\r\nPremain-Class: api.starloader.StarAgent\r\n')
                (root/'server.cfg').write_text('NATIVE = authority\n');before=(root/'server.cfg').read_bytes()
                old=Path.cwd();os.chdir(root)
                try:
                    with patch.dict(os.environ,{**env,'AUTO_UPDATE':'1','SERVER_PASSWORD':'redact-me','JAVA_TOOL_OPTIONS':'bad'},clear=True),patch.object(sys,'argv',['java_games_runtime.py','starmade']),patch.object(sys.modules['native_console'],'run',return_value=0) as console,patch.object(install,'download',side_effect=AssertionError('acquisition')):
                        with self.assertRaises(SystemExit) as result:runpy.run_path(str(stage/'java_games_runtime.py'),run_name='__main__')
                        self.assertEqual(result.exception.code,0)
                        args=console.call_args.args;self.assertIn('-Xmx3712M',args[1]);self.assertIn('-port:28012',args[1]);self.assertEqual(args[3],'/shutdown 0');self.assertIn('redact-me',args[4]);self.assertNotIn('JAVA_TOOL_OPTIONS',args[2]);self.assertEqual(console.call_args.kwargs['ready_marker'],b'SenableGameState(1)')
                    self.assertEqual((root/'server.cfg').read_bytes(),before)
                finally:os.chdir(old)
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    (out/'scoped-result.json').write_text(json.dumps({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skips':len(result.skipped)},indent=2)+'\n')
    if not result.wasSuccessful():sys.exit(1)
    # Existing caller/sibling suite, using the exact staged installer emissions.
    mapping={'INI_SOURCE':'native_config.py','STEAM_SOURCE':'steam_template.py','CONSOLE_SOURCE':'native_console.py','INSTALL_SOURCE':'java_games_install.py','RUNTIME_SOURCE':'java_games_runtime.py'}
    harness='\n'.join(k+'='+repr((stage/v).read_text()) for k,v in mapping.items())+'\n'+(repo/'tools/runtime/test-java-games.py').read_text()
    module=types.ModuleType('wave60_siblings');sys.modules[module.__name__]=module
    harness=harness.replace("installer.install(root,'necesse',{})","installer.install(root,'necesse',env())").replace('os.chown(target,1000,1000)','os.chown(target,os.getuid(),os.getgid())').replace('(1000,1000,0o640)','(os.getuid(),os.getgid(),0o640)')
    harness=harness.replace("unittest.main(argv=['java-game-fixtures'])","unittest.main(module=__name__,argv=['java-game-fixtures'])")
    exec(compile(harness,'existing-java-games-fixtures','exec'),module.__dict__)



