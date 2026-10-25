import os
import io
import json
import sys
import types
import signal
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest import mock
for name,source in SOURCES:
    module=types.ModuleType(name);exec(source,module.__dict__);sys.modules[name]=module
runtime=sys.modules['crafting_runtime'];installer=sys.modules['crafting_install']


class Capture:
    def __init__(self):self.buffer=io.BytesIO()
    def write(self,value):return self.buffer.write(value.encode())
    def flush(self):pass


class CraftingTests(unittest.TestCase):
    def fixture(self,root,kind,**extra):
        app,platform,binary,preserve=installer.GAMES[kind];target=root/binary;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'publisher fixture')
        return{'VOLTRA_CRAFTING':kind,'SRCDS_APPID':str(app),'SERVER_PORT':'20000','VOLTRA_ALLOCATED_PORTS':'20000',**({'WINDOWS_INSTALL':'1','GAME_PORT':'20000'}if kind=='cubic'else{}),**extra}

    def dotnet(self):return mock.patch.object(runtime.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=b'Microsoft.NETCore.App 8.0.22 [/usr/share/dotnet]\n'))

    def test_craftopia_managed_fields_unknown_comments_and_mode_preserved(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'craftopia',WORLD_NAME="Literal $value 'world'");target=root/'ServerSetting.ini';target.write_bytes(CRAFTOPIA_DEFAULT.encode());target.chmod(0o640)
            argv,_,_,ready,stop=runtime.configure(root,env);content=target.read_text();self.assertIn("name= Literal $value 'world'",content);self.assertIn('port= 20000',content);self.assertIn('autoSaveSec=300',content);self.assertEqual(target.stat().st_mode&0o777,0o640);self.assertEqual(ready,b'World is loaded!');self.assertEqual(stop,'\x03')

    def test_cubic_all_original_controls_and_literal_private_argv(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'cubic',SERVER_NAME="Literal $name 'cubic'",SERVER_PASSWORD="private $value 'join'",GAMEMODE='creative',PRIVATE_SERVER='TRUE',GALAXY_SEED='21945875634',MAX_PLAYERS='20');target=root/'config/server_config.txt';target.parent.mkdir();target.write_bytes(b'// custom\r\n{\r\n\t\tserverName "Old"\r\n\t\tprivateServer FALSE\r\n\t\tgalaxySeed 123\r\n\t\tunknownNative 73\r\n}\r\n')
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/wine'),mock.patch.dict(os.environ,{'DISPLAY':':99'}):argv,child,secrets,_,_=runtime.configure(root,env)
            self.assertIn("-Password=private $value 'join'",argv);self.assertIn('-Gamemode=creative',argv);self.assertIn('-MaxNumPlayers=20',argv);self.assertIn("private $value 'join'",secrets);self.assertEqual(child['WINEARCH'],'win64');self.assertIn(b'unknownNative 73',target.read_bytes());self.assertIn(b'privateServer TRUE',target.read_bytes());self.assertIn(b'galaxySeed 21945875634',target.read_bytes())

    def test_romestead_literal_json_types_xdg_and_operator_installer_only_fields(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'romestead',WORLD_NAME='World "quoted" $value',PASSWORD='pass"\\literal',WORLD_SIZE='3',MAX_PLAYERS='8',CHEATS='true');target=root/'config.json';target.write_text(json.dumps({'UnknownNative':73,'EnableCheats':False,'AutoCreateWorldSeed':'operator seed'}));target.chmod(0o640)
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/dotnet'),self.dotnet():argv,child,secrets,ready,stop=runtime.configure(root,env)
            data=json.loads(target.read_text());self.assertEqual(data['AutoStartWorldName'],'World "quoted" $value');self.assertEqual(data['Password'],'pass"\\literal');self.assertEqual(data['Port'],20000);self.assertEqual(data['AutoCreateWorldSize'],3);self.assertIs(data['EnableCheats'],False);self.assertEqual(data['AutoCreateWorldSeed'],'operator seed');self.assertEqual(data['UnknownNative'],73);self.assertEqual(target.stat().st_mode&0o777,0o640);self.assertEqual(child['XDG_DATA_HOME'],str(root/'.local/share'));self.assertEqual(stop,'stop');self.assertEqual(ready,b'Server ready')

    def test_missing_runtime_binary_config_and_bad_ports_fail_before_writes(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'romestead')
            with mock.patch.object(runtime.shutil,'which',return_value=None),self.assertRaises(ValueError):runtime.configure(root,env)
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/dotnet'),mock.patch.object(runtime.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=b'Microsoft.NETCore.App 9.0.1\n')),self.assertRaises(ValueError):runtime.configure(root,env)
            self.assertFalse((root/'config.json').exists())
        for kind in('craftopia','cubic'):
            with tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.fixture(root,kind)
                with self.assertRaises(ValueError):runtime.configure(root,env)
                self.assertFalse((root/'ServerSetting.ini').exists());self.assertFalse((root/'config/server_config.txt').exists())

    def test_romestead_invalid_duplicate_json_and_unsafe_path_no_mutation(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'romestead');target=root/'config.json';original=b'{"Password":"one","Password":"two"}';target.write_bytes(original)
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/dotnet'),self.dotnet(),self.assertRaises(ValueError):runtime.configure(root,env)
            self.assertEqual(target.read_bytes(),original)
            env['MAX_PLAYERS']='9'
            with self.assertRaises(ValueError):runtime.romestead_document(env)

    def test_retention_all_games_success_and_failure(self):
        for kind in installer.GAMES:
            for failure in(False,True):
                with self.subTest(kind=kind,failure=failure),tempfile.TemporaryDirectory()as directory:
                    root=Path(directory);env=self.fixture(root,kind);relative={'craftopia':'DedicatedServerSave/world.ocs','cubic':'save_server/world.bin','romestead':'.local/share/world.sav'}[kind];target=root/relative;target.parent.mkdir(parents=True);target.write_bytes(b'private persistent state');target.chmod(0o640)
                    def publisher(*args,**kwargs):
                        self.assertEqual(kwargs['platform'],installer.GAMES[kind][1]);target.write_bytes(b'publisher overwrite')
                        if failure:raise RuntimeError('publisher failure')
                        return{'buildid':'123'}
                    with mock.patch.object(installer,'update',side_effect=publisher),mock.patch.object(installer,'request_cubic_license'):
                        if failure:
                            with self.assertRaises(RuntimeError):installer.install(root,env,craftopia_default=CRAFTOPIA_DEFAULT.encode())
                        else:installer.install(root,env,craftopia_default=CRAFTOPIA_DEFAULT.encode())
                    self.assertEqual(target.read_bytes(),b'private persistent state');self.assertEqual(target.stat().st_mode&0o777,0o640)

    def test_romestead_first_publisher_config_initialized_but_unknown_fields_retained(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'romestead',WORLD_NAME='First original world',CHEATS='true',AUTO_CREATE_WORLD_SEED='literal seed')
            def publisher(*args,**kwargs):
                (root/'config.json').write_text(json.dumps({'AutoCreateAndLoadWorld':False,'SleepThresholdMs':-1,'AutoStartWorldName':'','PublisherUnknown':{'nested':73}}));return{'buildid':'123'}
            with mock.patch.object(installer,'update',side_effect=publisher):installer.install(root,env)
            value=json.loads((root/'config.json').read_text());self.assertIs(value['AutoCreateAndLoadWorld'],True);self.assertEqual(value['SleepThresholdMs'],10);self.assertEqual(value['AutoStartWorldName'],'First original world');self.assertIs(value['EnableCheats'],True);self.assertEqual(value['AutoCreateWorldSeed'],'literal seed');self.assertEqual(value['PublisherUnknown'],{'nested':73})

    def test_romestead_existing_operator_false_config_restored_after_success_and_failure(self):
        for failed in(False,True):
            with self.subTest(failed=failed),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.fixture(root,'romestead',CHEATS='true');target=root/'config.json';original=b'{"AutoCreateAndLoadWorld": false, "SleepThresholdMs": -7, "EnableCheats": false, "AutoCreateWorldSeed": "operator", "unknown": 73}\n';target.write_bytes(original);target.chmod(0o640);before=target.stat()
                def publisher(*args,**kwargs):
                    target.write_bytes(b'{"AutoCreateAndLoadWorld":true}')
                    if failed:raise RuntimeError('publisher failure')
                    return{'buildid':'123'}
                with mock.patch.object(installer,'update',side_effect=publisher):
                    if failed:
                        with self.assertRaisesRegex(RuntimeError,'publisher failure'):installer.install(root,env)
                    else:installer.install(root,env)
                self.assertEqual(target.read_bytes(),original);self.assertEqual(target.stat().st_mode&0o777,0o640);self.assertEqual((target.stat().st_uid,target.stat().st_gid),(before.st_uid,before.st_gid))

    def test_romestead_derived_automatic_update_flag_controls_installer_before_native_run(self):
        for desired in('0','1'):
            with self.subTest(desired=desired),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);(root/'logs').mkdir();env=self.fixture(root,'romestead',AUTO_UPDATE='0',VOLTRA_STEAM_AUTO_UPDATE=desired);capture=Capture()
                with mock.patch.object(runtime,'install')as install,mock.patch.object(runtime,'configure',return_value=(['dotnet','Server.dll'],{},[],b'Server ready','stop')),mock.patch.object(runtime,'run',return_value=7)as native,mock.patch.object(runtime.sys,'stdout',capture):self.assertEqual(runtime.main(root,env),7)
                self.assertEqual(install.call_count,int(desired));native.assert_called_once();self.assertEqual(env['AUTO_UPDATE'],'0');self.assertEqual(env['VOLTRA_STEAM_AUTO_UPDATE'],desired)

    def test_romestead_saved_worlds_success_and_failed_publisher_restores_exact_state(self):
        for failed in(False,True):
            with self.subTest(failed=failed),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.fixture(root,'romestead');target=root/'saved_worlds/operator/world.bin';target.parent.mkdir(parents=True);target.write_bytes(b'actual saved-world fixture\x00\xff');target.chmod(0o640);os.chown(target,988,989);before=target.stat()
                def publisher(*args,**kwargs):
                    target.write_bytes(b'publisher overwrite');target.chmod(0o600);os.chown(target,0,0)
                    if failed:raise RuntimeError('original publisher failure')
                    return{'buildid':'123'}
                with mock.patch.object(installer,'update',side_effect=publisher):
                    if failed:
                        with self.assertRaisesRegex(RuntimeError,'original publisher failure'):installer.install(root,env)
                    else:installer.install(root,env)
                after=target.stat();self.assertEqual(target.read_bytes(),b'actual saved-world fixture\x00\xff');self.assertEqual(after.st_mode&0o777,0o640);self.assertEqual((after.st_uid,after.st_gid),(before.st_uid,before.st_gid))
        self.assertNotIn('saved_worlds',installer.GAMES['craftopia'][3]);self.assertNotIn('saved_worlds',installer.GAMES['cubic'][3])

    def test_original_cubic_license_phase_structured_and_private_steam_gated(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'cubic');child=mock.Mock(stdout=io.BytesIO(b'License request output\n'));child.wait.return_value=0;child.poll.return_value=0
            with mock.patch.object(installer,'bootstrap'),mock.patch.object(installer.subprocess,'Popen',return_value=child)as spawn,mock.patch.object(installer.sys,'stdout',Capture()):installer.request_cubic_license(root,env)
            argv=spawn.call_args.args[0];self.assertIn('+app_license_request',argv);self.assertNotIn('+app_update',argv);self.assertEqual(argv[-3:],['+app_license_request','3858450','+quit'])
            env.update(STEAM_USER='privateaccount',STEAM_PASS='privatesecret')
            with mock.patch.object(installer,'bootstrap')as bootstrap,mock.patch.object(installer,'update')as publisher,self.assertRaises(ValueError)as error:installer.install(root,env)
            bootstrap.assert_not_called();publisher.assert_not_called();self.assertNotIn('privatesecret',str(error.exception))

    def test_romestead_actual_python_fixture_public_tee_normalizes_cr_and_redacts_split_secret(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'romestead');capture=Capture();script="import os,time;os.write(1,b'Server ready\\r');os.write(1,b'private');time.sleep(.1);os.write(1,b'secret\\r');time.sleep(.1)"
            with mock.patch.object(runtime,'configure',return_value=([sys.executable,'-c',script],dict(os.environ),['privatesecret'],b'Server ready','stop')),mock.patch.object(runtime.sys,'stdout',capture):self.assertEqual(runtime.main(root,env),0)
            log=(root/'logs/latest.log').read_bytes();self.assertNotIn(b'privatesecret',log);self.assertIn(b'[redacted]',log);self.assertNotIn(b'\r',log);self.assertEqual(log,capture.buffer.getvalue());self.assertIsNot(runtime.sys.stdout,capture)

    def test_new_romestead_install_creates_original_typed_config(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);env=self.fixture(root,'romestead',WORLD_NAME='World "literal"',CHEATS='true',AUTO_CREATE_WORLD_SEED='seed "literal"')
            with mock.patch.object(installer,'update',return_value={'buildid':'123'}):installer.install(root,env)
            data=json.loads((root/'config.json').read_text());self.assertIs(data['EnableCheats'],True);self.assertEqual(data['AutoCreateWorldSeed'],'seed "literal"');self.assertEqual(data['AutoStartWorldName'],'World "literal"');self.assertTrue((root/'.local/share').is_dir())

    def test_external_log_symlink_fails_before_romestead_config_write(self):
        with tempfile.TemporaryDirectory()as directory,tempfile.TemporaryDirectory()as outside:
            root=Path(directory);env=self.fixture(root,'romestead');logs=root/'logs';logs.mkdir();external=Path(outside)/'private';external.write_bytes(b'outside bytes');(logs/'latest.log').symlink_to(external)
            with mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/dotnet'),self.dotnet(),self.assertRaises(ValueError):runtime.configure(root,env)
            self.assertFalse((root/'config.json').exists());self.assertEqual(external.read_bytes(),b'outside bytes')

    def test_only_original_ctrl_c_recipes_select_actual_sigint(self):
        for kind in installer.GAMES:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.fixture(root,kind);stop='stop'if kind=='romestead'else'\x03'
                with mock.patch.object(runtime,'configure',return_value=([],{},[],b'ready',stop)),mock.patch.object(runtime,'run',return_value=250)as native:
                    self.assertEqual(runtime.main(root,env),250)
                self.assertEqual(native.call_args.args[3],stop)
                if kind=='romestead':self.assertNotIn('stop_signal',native.call_args.kwargs)
                else:self.assertEqual(native.call_args.kwargs['stop_signal'],signal.SIGINT)

    def test_romestead_redirected_pipe_other_games_terminal_and_raw_exit(self):
        for kind in installer.GAMES:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);env=self.fixture(root,kind)
                with mock.patch.object(runtime,'configure',return_value=([],{},[],b'ready','stop'if kind=='romestead'else'\x03')),mock.patch.object(runtime,'run',return_value=7)as child:
                    self.assertEqual(runtime.main(root,env),7)
                self.assertEqual(child.call_args.kwargs['terminal_input'],kind!='romestead')

    def test_actual_tiny_process_receives_sigint_and_writes_save(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);helpers=root/'helpers';helpers.mkdir()
            for name,source in SOURCES:(helpers/(name+'.py')).write_text(source)
            game=root/'game.py';game.write_text("import signal,pathlib,sys,time\ndef stop(*a):\n pathlib.Path('fixture.save').write_text('actual SIGINT saved')\n print('ACTUAL_SIGINT',flush=True)\n sys.exit(0)\nsignal.signal(signal.SIGINT,stop)\nprint('READY',flush=True)\nwhile True:time.sleep(10)\n")
            wrapper=root/'wrapper.py';wrapper.write_text("import sys,os,pathlib\nsys.path.insert(0,sys.argv[1])\nimport crafting_runtime as r\nr.configure=lambda root,env:([sys.executable,'-u','game.py'],dict(os.environ),[],b'READY','\\x03')\nsys.exit(r.main(pathlib.Path.cwd(),{'VOLTRA_CRAFTING':'craftopia','AUTO_UPDATE':'0'}))\n")
            process=subprocess.Popen([sys.executable,'-B','-u',str(wrapper),str(helpers)],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            try:
                self.assertEqual(process.stdout.readline(),b'READY\n');process.send_signal(signal.SIGTERM);output=process.communicate(timeout=5)[0]
                self.assertEqual(process.returncode,0);self.assertIn(b'ACTUAL_SIGINT',output);self.assertEqual((root/'fixture.save').read_text(),'actual SIGINT saved')
            finally:
                if process.poll()is None:process.kill();process.wait(timeout=5)
                process.stdin.close();process.stdout.close()


unittest.main()
