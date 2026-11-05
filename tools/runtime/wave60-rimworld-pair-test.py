"""Wave60 owned offline checks and unapplied fragment. Run only in isolated WSL Python."""
import contextlib, hashlib, importlib.util, io, json, os, runpy, shutil, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'internal/panel/game_library/scripts'
OUT=ROOT/'artifacts/game-parity-20261029/wave60-rimworld_pair'
GAMES={'openworld':'rimworld/open_world/egg-rimworld-open-world.json','together':'rimworld/together/egg-rimworld-together.json'}
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
class Checks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='wave60-rimworld-');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.pkg=self.root/'helpers';self.pkg.mkdir()
        for source,target in [('steam-template.py','steam_template.py'),('additional-survival-install.py','additional_survival_install.py'),('native-console.py','native_console.py'),('sonic-rimworld.py','sonic_rimworld.py'),('small-native-install.py','small-native-install.py'),('native-release.py','native-release.py'),('sonic-rimworld-releases.json','sonic-rimworld-releases.json'),('sonic-rimworld-licenses.json','sonic-rimworld-licenses.json')]:shutil.copy2(BASE/source,self.pkg/target)
        load('steam_template',self.pkg/'steam_template.py');load('additional_survival_install',self.pkg/'additional_survival_install.py');self.console=load('native_console',self.pkg/'native_console.py');self.m=load('wave60',self.pkg/'sonic_rimworld.py');self.env=dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010');self.vol=self.root/'volume';self.vol.mkdir()
    def path(self,g):return self.vol/('Data/Config.json' if g=='openworld' else 'Configs/ServerConfig.json')
    def test_entrypoint_refusal(self):
        for g in GAMES:
            for mode in ('install','run'):
                with self.subTest(g=g,mode=mode),patch.dict(os.environ,{'SERVER_PORT':'28011','VOLTRA_ALLOCATED_PORTS':'28010'},clear=True),patch.object(sys,'argv',['sonic_rimworld.py',mode,g]),patch('urllib.request.urlopen',side_effect=AssertionError('network')),patch('subprocess.Popen',side_effect=AssertionError('process')):
                    old=Path.cwd();os.chdir(self.vol)
                    try:
                        with self.assertRaises(ValueError):runpy.run_path(str(self.pkg/'sonic_rimworld.py'),run_name='__main__')
                    finally:os.chdir(old)
                    self.assertEqual(list(self.vol.iterdir()),[])
    def test_preflight_preservation_and_seed_authority(self):
        for g in GAMES:
            p=self.path(g);p.parent.mkdir(exist_ok=True);p.write_text(json.dumps({'MaxPlayers':7,'Password':'fixture-native-secret','Name':'native','Port':1,'ServerPort':1}));p.chmod(0o640);before=p.read_bytes();stat=p.stat()
            self.m.configure(self.vol,g,self.env,preflight=True);self.assertEqual(p.read_bytes(),before)
            self.m.configure(self.vol,g,self.env);data=json.loads(p.read_text());self.assertEqual(data['MaxPlayers'],7);self.assertEqual(data['Password'],'fixture-native-secret');self.assertEqual(data['Port' if g=='together' else 'ServerPort'],28010);self.assertEqual(p.stat().st_mode,stat.st_mode);self.assertEqual(p.stat().st_uid,stat.st_uid);self.assertIn('fixture-native-secret',self.m.native_credentials(self.vol,g))
    def test_install_invalid_and_acquisition_failure_preserve(self):
        for g in GAMES:
            p=self.path(g);p.parent.mkdir(exist_ok=True);p.write_text('{"MaxPlayers":7}');before=p.read_bytes()
            with patch.object(self.m,'selected',side_effect=AssertionError('acquisition')):
                with self.assertRaises(ValueError):self.m.install(self.vol,g,{**self.env,'MAX_PLAYERS':'-1'})
            self.assertFalse((self.vol/'.voltra').exists())
            with patch.object(self.m,'selected',return_value=self.m.PINNED[g]),patch.object(self.m.release,'download',side_effect=RuntimeError('mock acquisition failure')):
                with self.assertRaises(RuntimeError):self.m.install(self.vol,g,self.env)
            self.assertEqual(p.read_bytes(),before)
            shutil.rmtree(self.vol/'.voltra')
    def test_mock_install_publication(self):
        for g in GAMES:
            p=self.path(g);p.parent.mkdir(exist_ok=True);p.write_text('{"Password":"keep"}');before=p.read_bytes()
            def extract(archive,dest):
                target=dest/'linux-x64' if g=='openworld' else dest;target.mkdir(exist_ok=True);(target/('OpenWorldServer' if g=='openworld' else 'RTServer')).write_bytes(b'mock engine')
            runtime=type('Runtime',(),{'DOTNET':{},'runtime':staticmethod(lambda *a:None)})
            real_load=self.m.load
            with patch.object(self.m.release,'download'),patch.object(self.m.publisher,'extract_zip',side_effect=extract),patch.object(self.m.publisher,'publish') as publish,patch.object(self.m,'bundle_libraries'),patch.object(self.m,'load',side_effect=lambda name,file:runtime if file=='among-us-install.py' else real_load(name,file)):
                self.m.install(self.vol,g,self.env);self.assertEqual(publish.call_count,1)
            self.assertEqual(p.read_bytes(),before)
    def test_emitted_start_success_and_native_redaction(self):
        for g in GAMES:
            p=self.path(g);p.parent.mkdir(exist_ok=True);p.write_text('{"Password":"native-private-fixture","MaxPlayers":7}')
            old=Path.cwd();os.chdir(self.vol)
            try:
                with patch.dict(os.environ,self.env,clear=True),patch.object(sys,'argv',['sonic_rimworld.py','run',g]),patch.object(self.console,'run',return_value=0) as run:
                    with self.assertRaises(SystemExit) as caught:runpy.run_path(str(self.pkg/'sonic_rimworld.py'),run_name='__main__')
                    self.assertEqual(caught.exception.code,0);self.assertIn('native-private-fixture',run.call_args.kwargs['credentials'])
            finally:os.chdir(old)
    def test_malformed_secret_error_and_symlink_refusal(self):
        for g in GAMES:
            p=self.path(g);p.parent.mkdir(exist_ok=True);p.write_text('{"secret":"DO-NOT-LOG" broken')
            with self.assertRaises(ValueError) as caught:self.m.configure(self.vol,g,self.env)
            self.assertNotIn('DO-NOT-LOG',str(caught.exception));p.unlink();p.symlink_to(self.root/'outside')
            with self.assertRaises(ValueError):self.m.install(self.vol,g,self.env)
            p.unlink()
def stage():
    OUT.mkdir(parents=True,exist_ok=True);prior=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text());fragment={}
    for g,path in GAMES.items():
        profile=prior[path];script=profile['egg']['scripts']['installation']['script'];start=script.index("cat > .voltra/sonic_rimworld.py <<'VOLTRA_SOURCE'\n")+len("cat > .voltra/sonic_rimworld.py <<'VOLTRA_SOURCE'\n");end=script.index('\nVOLTRA_SOURCE',start);profile['egg']['scripts']['installation']['script']=script[:start]+(BASE/'sonic-rimworld.py').read_text()+script[end:];fragment[path]=profile
    (OUT/'recipe-fragment.json').write_text(json.dumps(fragment,indent=2)+'\n')
if __name__=='__main__':
    stage();suite=unittest.defaultTestLoader.loadTestsFromTestCase(Checks);result=unittest.TextTestRunner(verbosity=2).run(suite);sys.exit(not result.wasSuccessful())
