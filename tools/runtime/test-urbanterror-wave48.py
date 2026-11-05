import importlib.util,sys,tempfile,unittest,subprocess,socket,json,re
from pathlib import Path
from unittest.mock import patch
BASE=Path('internal/panel/game_library/scripts').resolve();sys.path.insert(0,str(BASE))
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
for name,file in [('steam_template','steam-template.py'),('native_console','native-console.py'),('native_release','native-release.py'),('native_zip_release','native-zip-release.py')]:load(name,BASE/file)
r=load('quake_runtime',BASE/'quake-family-runtime.py');i=load('urban_installer',BASE/'urbanterror-install.py')
st=load('urban_stage',Path('tools/runtime/urbanterror-wave48-stage.py'))
class Tests(unittest.TestCase):
 def setUp(self):
    self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
    for obj,name in [(subprocess,'Popen'),(socket,'socket'),(sys.modules['native_release'].urllib.request,'urlopen')]:
        p=patch.object(obj,name,side_effect=AssertionError('Unmocked boundary'));p.start();self.addCleanup(p.stop)
 def test_preflight_before_any_writes(self):
    for env in [{'EXE':'bad'},{'SERVER_PORT':'65536'},{'SERVER_MAP':'../bad'},{'SERVER_NAME':'bad\n'},{'SERVER_PASSWORD':'bad;'},{'BOT_MINPLAYERS':'9','SERVER_MAXCLIENTS':'8'}]:
        with self.assertRaises(ValueError):r.configure(env,self.root,'urbanterror')
        self.assertEqual(list(self.root.iterdir()),[])
 def test_unknown_bytes_and_argv_and_masking_contract(self):
    folder=self.root/'urbanterror/q3ut4';folder.mkdir(parents=True)
    raw=b'// unknown\xff\r\nset custom "x"\r\n';(folder/'server.cfg').write_bytes(raw)
    with patch.object(r,'map_exists',return_value=True),patch.object(r.threading,'Thread') as thread,patch.object(r,'run',return_value=7) as run:
        env={'SERVER_PORT':'28030','RCON_PASSWORD':'secret','SERVER_PASSWORD':'private'}
        self.assertEqual(r.main(self.root,env,'urbanterror'),7)
        self.assertEqual(run.call_args.kwargs['credentials'],['private','secret'])
        argv=run.call_args.args[1];self.assertEqual(argv[argv.index('net_port')+1],'28030')
        self.assertLess(argv.index('server.cfg'),argv.index('voltra-managed.cfg'))
    self.assertEqual((folder/'server.cfg').read_bytes(),raw)
 def test_installer_geometry_refuses_before_acquisition(self):
    p=self.root/'urbanterror/q3ut4/server.cfg';p.mkdir(parents=True)
    with patch.object(i,'install_release',side_effect=AssertionError('Acquired')):
        with self.assertRaises(ValueError):i.install(self.root)
 def test_mock_update_success_failure_preserves_operator_files(self):
    game=self.root/'urbanterror';folder=game/'q3ut4';folder.mkdir(parents=True)
    protected={'server.cfg':b'operator\xff','mapcycle.txt':b'custom','custom.pk3':b'mod','save.cfg':b'save'}
    for name,data in protected.items():(folder/name).write_bytes(data)
    def acquire(*args):
        (game/'Quake3-UrT-Ded.i386').write_bytes(b'fixture');(folder/'server_example.cfg').write_bytes(b'example');(folder/'mapcycle_example.txt').write_bytes(b'cycle')
    with patch.object(i,'install_release',side_effect=acquire):i.install(self.root)
    with patch.object(i,'install_release',side_effect=RuntimeError('mock acquisition failed')):
        with self.assertRaises(RuntimeError):i.install(self.root)
    for name,data in protected.items():self.assertEqual((folder/name).read_bytes(),data)
 def test_exact_emitted_filenames_and_arrays(self):
    profile=st.stage();script=profile['egg']['scripts']['installation']['script']
    files=dict(re.findall(r"cat > \.voltra/(\S+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE\n",script,re.S))
    for filename in ['urbanterror_install.py','quake_family_runtime.py','native_zip_release.py']:compile(files[filename],filename,'exec')
    for command in re.findall(r'python3 \.voltra/(\S+)',script):self.assertIn(command,files)
    canonical=json.loads(Path('internal/panel/game_library/overrides.json').read_text(encoding='utf-8-sig'))[st.RECIPE]
    for key in ['variables','docker_images','startup','config']:self.assertEqual(profile['egg'][key],canonical['egg'][key])
    self.assertEqual(profile['defaults'],canonical['defaults'])
if __name__=='__main__':unittest.main()
