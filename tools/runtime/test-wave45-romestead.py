"""Offline Romestead emitted-source tests. No game/process/network execution."""
import contextlib, io, json, os, re, socket, sys, tempfile, types, unittest
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parents[2]
RECIPE='romestead/egg-romestead.json'
STAGE=ROOT/'artifacts/game-parity-20261029/wave45-romestead'
profile=json.loads((STAGE/'profiles.json').read_text())[RECIPE]
script=profile['egg']['scripts']['installation']['script']
emitted=dict(re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE",script,re.S))
for name in ['steam_template','native_config','native_console','source_install','source_next_install','tactical_install','tactical_runtime','crafting_install','crafting_runtime']:
    module=types.ModuleType(name);module.__file__=str(ROOT/'internal/panel/game_library/scripts'/ (name.replace('_','-')+'.py'))
    sys.modules[name]=module;exec(compile(emitted[name+'.py'],name+'.py','exec'),module.__dict__)
i=sys.modules['crafting_install'];r=sys.modules['crafting_runtime']
def publish(root,name,writer,mode=0o600):
    target=root/name;target.parent.mkdir(parents=True,exist_ok=True)
    with target.open('wb') as stream:writer(stream)
    target.chmod(mode)
class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name).resolve()
        self.env={'VOLTRA_CRAFTING':'romestead','SRCDS_APPID':'4763510','SERVER_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28003','AUTO_UPDATE':'0'}
        for patch in [mock.patch.object(i,'_publish',side_effect=publish),mock.patch.object(r,'_publish',side_effect=publish),mock.patch.object(os,'geteuid',return_value=1000,create=True),mock.patch.object(socket,'socket',side_effect=AssertionError('network forbidden')),mock.patch.object(i.subprocess,'Popen',side_effect=AssertionError('process forbidden')),mock.patch.object(i.subprocess,'run',side_effect=AssertionError('process forbidden'))]:
            patch.start();self.addCleanup(patch.stop)
    def test_emission_and_metadata(self):
        canonical=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[RECIPE]
        candidate=json.loads(json.dumps(profile));candidate['egg']['scripts']['installation']['script']=canonical['egg']['scripts']['installation']['script'];self.assertEqual(candidate,canonical)
        for file in ['crafting-install.py','crafting-runtime.py']:
            self.assertEqual(emitted[file.replace('-','_')].rstrip(),(ROOT/'internal/panel/game_library/scripts'/file).read_text().rstrip())
        self.assertIn('.voltra/crafting_runtime.py',profile['egg']['startup'])
    def test_preflight_refuses_before_acquisition_or_retention(self):
        cases=[(b'{"Password":1,"Password":2}',{}),(b'[]',{}),(b'{"x":NaN}',{}),(b'{',{}),(b'{}',{'MAX_PLAYERS':'9'}),(b'{}',{'SERVER_PORT':'28004'}),(b'{}',{'VOLTRA_ALLOCATED_PORTS':''})]
        for original,extra in cases:
            with self.subTest(original=original,extra=extra):
                target=self.root/'config.json';target.write_bytes(original)
                with mock.patch.object(i,'update')as update,mock.patch.object(i.tempfile,'TemporaryDirectory')as snapshot,self.assertRaises(ValueError):i.install(self.root,{**self.env,**extra})
                update.assert_not_called();snapshot.assert_not_called();self.assertEqual(target.read_bytes(),original)
    def test_parent_file_refused_before_acquisition(self):
        (self.root/'.local').write_bytes(b'operator file')
        with mock.patch.object(i,'update')as update,mock.patch.object(i.tempfile,'TemporaryDirectory')as snapshot,self.assertRaises(ValueError):i.install(self.root,self.env)
        update.assert_not_called();snapshot.assert_not_called()
    def test_first_install_positive_publisher_unknown_array(self):
        def acquire(*a,**kw):
            self.assertEqual(kw['required'],('Server.dll',));self.assertTrue(kw['force_platform']);self.assertEqual(kw['platform'],'linux')
            (self.root/'Server.dll').write_bytes(b'fixture')
            (self.root/'config.json').write_text('{"AutoCreateAndLoadWorld":false,"unknown":[1,{"x":"secret"}]}');return {'buildid':'fixture'}
        with mock.patch.object(i,'update',side_effect=acquire):self.assertEqual(i.install(self.root,self.env),{'buildid':'fixture'})
        value=json.loads((self.root/'config.json').read_text());self.assertEqual(value['Port'],28003);self.assertIs(value['AutoCreateAndLoadWorld'],True);self.assertEqual(value['unknown'],[1,{'x':'secret'}])
    def test_reinstall_success_failure_exact_operator_bytes_saves_mods(self):
        for failed in [False,True]:
            with self.subTest(failed=failed):
                files={'config.json':b'{"Password":"secret \\\"value","EnableCheats":false,"AutoCreateWorldSeed":"operator","unknown":[1,{"a":true}]}\r\n','saved_worlds/world.bin':b'world\x00\xff','Mods/operator.bin':b'mod\x01'}
                for name,data in files.items():p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
                def acquire(*a,**kw):
                    for name in files:(self.root/name).write_bytes(b'overwritten')
                    if failed:raise RuntimeError('mocked acquisition failure')
                    return {'buildid':'fixture'}
                with mock.patch.object(i,'update',side_effect=acquire):
                    if failed:
                        with self.assertRaisesRegex(RuntimeError,'mocked acquisition failure'):i.install(self.root,self.env)
                    else:i.install(self.root,self.env)
                for name,data in files.items():self.assertEqual((self.root/name).read_bytes(),data)
                self.assertEqual(list(self.root.glob('.crafting-retention-*')),[])
    def test_document_managed_fields_and_installer_only_authority(self):
        value=json.loads(r.romestead_document({**self.env,'PASSWORD':'quote"\\secret','CHEATS':'true'},b'{"EnableCheats":false,"AutoCreateWorldSeed":"operator","unknown":[1,2]}'))
        self.assertFalse(value['EnableCheats']);self.assertEqual(value['AutoCreateWorldSeed'],'operator');self.assertEqual(value['unknown'],[1,2]);self.assertEqual(value['Password'],'quote"\\secret');self.assertEqual(value['Port'],28003)
    def test_other_family_selection_and_retention_regression(self):
        for kind,name in [('craftopia','DedicatedServerSave/a'),('cubic','save_server/a')]:
            with self.subTest(kind=kind):
                env={'VOLTRA_CRAFTING':kind};target=self.root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'operator')
                # Avoid a Craftopia publisher-default fixture: existing INI is operator-owned.
                (self.root/'ServerSetting.ini').write_bytes(b'[Host]\nport=20000\n');(self.root/'Craftopia.x86_64').write_bytes(b'fixture')
                def acquire(*a,**kw):target.write_bytes(b'publisher');return {'buildid':'fixture'}
                with mock.patch.object(i,'update',side_effect=acquire),mock.patch.object(i,'request_cubic_license'):i.install(self.root,env)
                self.assertEqual(target.read_bytes(),b'operator')
    def test_mock_console_pipe_stop_raw_exit_and_public_tee(self):
        capture=types.SimpleNamespace(buffer=io.BytesIO(),flush=lambda:None)
        @contextlib.contextmanager
        def parent(*a,**kw):yield (None,'latest.log',None)
        output=io.BytesIO()
        class Log(io.BytesIO):
            def close(self):pass
        log=Log()
        def run(*a,**kw):
            self.assertEqual(a[3],'stop');self.assertFalse(kw['terminal_input']);self.assertEqual(kw['credentials'],['secret']);r.sys.stdout.write(b'already [redacted]\rServer ready\r');return 7
        with mock.patch.object(r,'configure',return_value=(['dotnet','Server.dll'],{},['secret'],b'Server ready','stop')),mock.patch.object(r,'run',side_effect=run),mock.patch.object(r,'_publication_parent',side_effect=parent),mock.patch.object(r,'_publication_leaf'),mock.patch.object(r.os,'O_NOFOLLOW',0,create=True),mock.patch.object(r.os,'open',return_value=99),mock.patch.object(r.os,'fdopen',return_value=log),mock.patch.object(r.sys,'stdout',capture):self.assertEqual(r.main(self.root,self.env),7)
        self.assertEqual(log.getvalue(),capture.buffer.getvalue());self.assertNotIn(b'\r',log.getvalue())
if __name__=='__main__':unittest.main(verbosity=2)
