import importlib.util,sys,pathlib,tempfile,unittest,json
from unittest.mock import patch
BASE=pathlib.Path(__file__).resolve().parents[2]
S=BASE/'internal/panel/game_library/scripts'
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,S/file);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
load('native_config','native-config.py');load('steam_template','steam-template.py');load('additional_survival_install','additional-survival-install.py');proton=load('enshrouded_proton','enshrouded-proton.py');runtime=load('enshrouded_runtime','enshrouded-runtime.py')
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);self.env={'SERVER_PORT':'15637','VOLTRA_ALLOCATED_PORTS':'15637'}
  self.network=patch('urllib.request.urlopen',side_effect=AssertionError('network forbidden')).start();self.addCleanup(patch.stopall)
  patch('subprocess.Popen',side_effect=AssertionError('process forbidden')).start()
 def snapshot(self):return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
 def configure(self):
  with patch.object(runtime,'location',return_value=self.root/'mock-proton'):
   (self.root/'enshrouded_server.exe').touch();return runtime.configure(self.root,self.env)
 def test_seed_once_preserves_exact_native_bytes_and_password(self):
  self.configure();target=self.root/'enshrouded_server.json';d=json.loads(target.read_text());d['name']='Operator';d['userGroups'][0]['password']='operator-secret';d['unknown']={'large':123456789012345678901234567890};raw=('\ufeff'+json.dumps(d,indent=3)+'\r\n').encode();target.write_bytes(raw)
  self.env.update(SRV_NAME='stale',SRV_PW='stale-secret');args,env,secrets,log=self.configure()
  self.assertEqual(target.read_bytes(),raw);self.assertIn('operator-secret',secrets);self.assertNotIn('stale-secret',secrets)
 def test_invalid_seed_has_no_mutations(self):
  for changes in [{'GAME_PRESET':'invalid'},{'SRV_PW':'123'},{'MAX_PLAYERS':'17'}]:
   before=self.snapshot()
   with self.assertRaises(ValueError):runtime.configure(self.root,{**self.env,**changes},preflight=True)
   self.assertEqual(self.snapshot(),before);self.assertEqual(list(self.root.iterdir()),[])
 def test_missing_runtime_does_not_seed(self):
  (self.root/'enshrouded_server.exe').touch();before=self.snapshot()
  with self.assertRaises(ValueError):runtime.configure(self.root,self.env)
  self.assertEqual(self.snapshot(),before);self.assertFalse((self.root/'savegame').exists())
 def test_invalid_existing_path_refuses_before_update(self):
  target=self.root/'enshrouded_server.json';target.write_text('{"queryPort":15637,"saveDirectory":"../escape","logDirectory":"logs"}');before=self.snapshot()
  with patch.object(runtime.Path,'cwd',return_value=self.root),patch.dict(runtime.os.environ,{**self.env,'VOLTRA_STEAM_AUTO_UPDATE':'1'},clear=True),patch.object(runtime,'install') as install:
   with self.assertRaises(ValueError):runtime.main()
   install.assert_not_called()
  self.assertEqual(self.snapshot(),before)
 def test_update_success_and_failure_restore_config(self):
  installer=sys.modules['additional_survival_install'];target=self.root/'enshrouded_server.json';raw=b'\xef\xbb\xbf{"operator":true}\r\n';target.write_bytes(raw)
  # Windows has no fchown; replace the POSIX publication primitive only.
  def publish(path,content,metadata=None):path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content)
  for fail in (False,True):
   def update(*a,**kw):
    target.write_bytes(b'publisher')
    if fail:raise RuntimeError('mock failure')
    return {'mock':True}
   with patch.object(installer,'private_bytes',side_effect=publish),patch.object(installer,'update',side_effect=update),patch.object(proton,'provision',return_value={}):
    if fail:
     with self.assertRaises(RuntimeError):installer.install(self.root,'enshrouded',self.env)
    else:self.assertEqual(installer.install(self.root,'enshrouded',self.env),{'mock':True})
   self.assertEqual(target.read_bytes(),raw)
 def test_unreceipted_proton_refuses_without_download(self):
  target=self.root/'.voltra/proton'/proton.VERSION;target.mkdir(parents=True);(target/'operator').write_bytes(b'keep');before=self.snapshot()
  with self.assertRaises(ValueError):proton.provision(self.root)
  self.assertEqual(self.snapshot(),before)
if __name__=='__main__':unittest.main(verbosity=2)
