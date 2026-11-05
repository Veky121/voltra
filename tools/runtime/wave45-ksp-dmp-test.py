import importlib.util, pathlib, sys, tempfile, unittest
from unittest.mock import patch
BASE=pathlib.Path(__file__).resolve().parents[2]
HELPERS=BASE/'internal/panel/game_library/scripts'
sys.path.insert(0,str(HELPERS))
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HELPERS/file)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
load('steam_template','steam-template.py');load('native_config','native-config.py');load('native_console','native-console.py')
r=load('ksp_runtime','ksp-runtime.py');i=load('ksp_install','ksp-install.py')
class DMP(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
        self.env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001'}
    def tearDown(self):self.tmp.cleanup()
    def test_native_authority(self):
        (self.root/'DMPServer.dll').touch();p=self.root/'Config/Settings.txt';p.parent.mkdir()
        opaque=b'\xef\xbb\xbf# operator\r\nserverName=Private\r\nmaxPlayers=7\r\npassword=secret=abc\r\nmods=a,b\r\nmods=c\r\n'
        p.write_bytes(opaque);r.configure(self.root,'dmp',{**self.env,'SERVERNAME':'Replacement','MAX_PLAYERS':'20'})
        self.assertTrue(p.read_bytes().startswith(opaque));self.assertIn(b'port=28000\r\n',p.read_bytes())
        before=p.read_bytes();r.configure(self.root,'dmp',self.env);self.assertEqual(before,p.read_bytes())
    def test_refusals_preserve_bytes(self):
        (self.root/'DMPServer.dll').touch();p=self.root/'Config/Settings.txt';p.parent.mkdir()
        for content,change in [(b'port=1\nPort=2\n',{}),(b'password=secret\n',{'STATUS_PORT':'28000'}),(b'port=1\nport=2\n',{})]:
            p.write_bytes(content)
            with self.assertRaises(ValueError):r.configure(self.root,'dmp',{**self.env,**change})
            self.assertEqual(content,p.read_bytes())
    def test_missing_binary_no_config_writes(self):
        with self.assertRaises(ValueError):r.configure(self.root,'dmp',self.env)
        self.assertEqual([],list(self.root.iterdir()))
    def test_mocked_install_preserves_operator_payload(self):
        protected=['Config/Settings.txt','Universe/save','Plugins/mod.dll','DMPModControl.txt']
        for name in protected:
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator-secret')
        def run(argv,**kwargs):
            if argv[:2]==['dotnet','publish']:
                out=pathlib.Path(argv[argv.index('-o')+1]);out.mkdir(parents=True)
                (out/'DMPServer.dll').write_bytes(b'mocked-binary')
                for name in protected:
                    p=out/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'overwrite')
            if 'clone' in argv:
                source=pathlib.Path(argv[-1]);source.mkdir(parents=True);(source/'LICENCE.txt').write_text('fixture')
        pins=iter(['8253dc8e4f40e4519c085c3ee223abecd1a52954','b422f43df58b366300c142b1c4d3a3375565781f','0a1c1e1666bf94a9069acf1967e64d2679dc27a2','d2d4b3062e8a42752d801d770a54e97cdd9e5bfc'])
        def output(argv,**kwargs):return next(pins) if 'rev-parse' in argv else ''
        with patch.object(i.subprocess,'run',side_effect=run),patch.object(i.subprocess,'check_output',side_effect=output),patch.object(i,'dmp_patch'),patch.object(i.urllib.request,'urlopen',side_effect=AssertionError('network')):
            receipt=i.install(self.root,'dmp',{})
        self.assertEqual(receipt['version'],'0.3.8.5')
        for name in protected:self.assertEqual((self.root/name).read_bytes(),b'operator-secret')
    def test_preflight_refuses_before_process(self):
        (self.root/'DMPServer.dll').mkdir()
        # Directory output conflict must be refused even before git acquisition.
        with patch.object(i.subprocess,'run',side_effect=RuntimeError('acquisition')) as process:
            with self.assertRaises(ValueError):i.install(self.root,'dmp',{})
        process.assert_not_called()
    def test_acquisition_failure_preserves_files(self):
        p=self.root/'Config/Settings.txt';p.parent.mkdir();p.write_bytes(b'password=secret\n')
        with patch.object(i.subprocess,'run',side_effect=RuntimeError('mock clone failure')),patch.object(i.urllib.request,'urlopen',side_effect=AssertionError('network')):
            with self.assertRaises(RuntimeError):i.install(self.root,'dmp',{})
        self.assertEqual(p.read_bytes(),b'password=secret\n')
if __name__=='__main__':unittest.main()
