"""Isolated emitted-helper source fixtures; no publisher or native execution."""
import pathlib,json,hashlib,re,sys,importlib.util,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/wave58-ksp_lmp'
RECIPE='ksp/LMP/egg-k-s-p--l-m-p.json'
SCRIPTS=ROOT/'internal/panel/game_library/scripts'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def load(name):
 p=OUT/'emitted'/(name+'.py');spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
# Stage only into this owner's output; preserve canonical metadata and controls.
OUT.mkdir(parents=True,exist_ok=True)
profile=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[RECIPE]
original=json.loads(json.dumps(profile));script=profile['egg']['scripts']['installation']['script']
for name in ['ksp-runtime','ksp-install']:
 emitted=name.replace('-','_')+'.py';pattern=r"(cat > \.voltra/"+re.escape(emitted)+r" <<'VOLTRA_SOURCE'\n).*?(\nVOLTRA_SOURCE)"
 script,count=re.subn(pattern,lambda m:m[1]+(SCRIPTS/(name+'.py')).read_text()+m[2],script,flags=re.S)
 assert count==1,(name,count)
profile['egg']['scripts']['installation']['script']=script
(OUT/'emitted').mkdir(exist_ok=True)
for filename,body in re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE",script,re.S):
 assert '/' not in filename
 (OUT/'emitted'/filename).write_text(body)
sys.path.insert(0,str(OUT/'emitted'))
load('steam_template');load('native_config');load('native_console');r=load('ksp_runtime');i=load('ksp_install')
class LMP(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.env={'SERVER_PORT':'28000'}
  self.stack=[]
  for target in [i.subprocess.__name__+'.run',i.subprocess.__name__+'.check_output','urllib.request.urlopen']:
   p=patch(target,side_effect=AssertionError('Unmocked external boundary'));p.start();self.stack.append(p)
 def tearDown(self):
  for p in self.stack:p.stop()
  self.tmp.cleanup()
 def binary(self):
  (self.root/'LMPServer').mkdir(exist_ok=True);(self.root/'LMPServer/Server.dll').touch()
 def snapshot(self):return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
 def test_missing_binary_no_write(self):
  with self.assertRaises(ValueError):r.configure(self.root,'lmp',self.env)
  self.assertEqual([],list(self.root.iterdir()))
 def test_late_invalid_values_no_write(self):
  self.binary()
  for env in [{'PUBLIC_LISTING':'bad'},{'PASSWORD':'line\nbreak'},{'MAXPLAYERS':'0'}]:
   before=self.snapshot()
   with self.assertRaises(ValueError):r.configure(self.root,'lmp',{**self.env,**env})
   self.assertEqual(before,self.snapshot())
 def test_seed_and_operator_preservation_and_redaction(self):
  self.binary();r.configure(self.root,'lmp',{**self.env,'PASSWORD':'native-secret'})
  general=self.root/'LMPServer/Config/GeneralSettings.xml';raw=general.read_bytes().replace(b'Luna Server',b'Operator')
  general.write_bytes(raw);gameplay=general.parent/'GameplaySettings.xml';gameplay.write_bytes(b'operator world settings')
  cwd,argv,env,stop,secrets,ready=r.configure(self.root,'lmp',{**self.env,'SERVER_NAME':'Overwrite','GAMEDIFFICULTY':'Hard','PASSWORD':'env-secret'})
  self.assertEqual(raw,general.read_bytes());self.assertEqual(b'operator world settings',gameplay.read_bytes());self.assertIn('native-secret',secrets);self.assertEqual('\x03',stop)
  self.assertEqual('All systems up and running',ready);self.assertEqual('dotnet',argv[0])
 def test_malformed_last_file_no_partial_write(self):
  self.binary();p=self.root/'LMPServer/Config/WebsiteSettings.xml';p.parent.mkdir();p.write_bytes(b'<bad>')
  before=self.snapshot()
  with self.assertRaises(Exception):r.configure(self.root,'lmp',self.env)
  self.assertEqual(before,self.snapshot())
 def test_alias_refusal(self):
  self.binary();p=self.root/'LMPServer/Config/GeneralSettings.xml';p.parent.mkdir();p.write_text('<GeneralSettingsDefinition><Password>a</Password><password>b</password></GeneralSettingsDefinition>');before=self.snapshot()
  with self.assertRaises(ValueError):r.configure(self.root,'lmp',self.env)
  self.assertEqual(before,self.snapshot())
 def test_mocked_install_and_acquisition_failure_preserve_native(self):
  self.binary();p=self.root/'LMPServer/Config/GeneralSettings.xml';p.parent.mkdir();p.write_bytes(b'operator settings')
  def run(argv,**kwargs):
   if 'clone' in argv:
    source=pathlib.Path(argv[-1]);(source/'Server').mkdir(parents=True);(source/'Server/Server.csproj').write_text('<Project Sdk="Microsoft.NET.Sdk"><TargetFramework>net6.0</TargetFramework></Project>')
   if argv[:2]==['dotnet','publish']:
    out=pathlib.Path(argv[argv.index('-o')+1]);(out/'Config').mkdir(parents=True);(out/'Server.dll').write_bytes(b'mocked publish');(out/'Config/GeneralSettings.xml').write_bytes(b'overwrite')
  def output(argv,**kwargs):
   if 'rev-parse' in argv:return i.LMP_COMMIT
   return '' if kwargs.get('text') else b''
  with patch.object(i.subprocess,'run',side_effect=run),patch.object(i.subprocess,'check_output',side_effect=output):receipt=i.install(self.root,'lmp',{})
  self.assertEqual(i.LMP_COMMIT,receipt['source_commit']);self.assertEqual(b'operator settings',p.read_bytes())
  before=self.snapshot()
  with self.assertRaises(AssertionError):i.install(self.root,'lmp',{})
  self.assertEqual(before,self.snapshot())
 def test_install_invalid_preflight_no_write_or_acquisition(self):
  with self.assertRaises(ValueError):i.install(self.root,'lmp',{'LMP_VERSION':'../../bad'})
  self.assertEqual([],list(self.root.iterdir()))
 def test_install_symlink_refuses_before_acquisition(self):
  with tempfile.TemporaryDirectory() as external:
   (self.root/'LMPServer').symlink_to(external,target_is_directory=True)
   with self.assertRaises(ValueError):i.install(self.root,'lmp',{})
   self.assertEqual([],list(pathlib.Path(external).iterdir()))
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LMP))
 (OUT/'tests.json').write_text(json.dumps({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'scope':'WSL Python source fixtures against exact emitted filenames; external boundaries denied'},indent=2))
 if result.wasSuccessful():
  (OUT/'recipe-fragments.json').write_text(json.dumps({RECIPE:profile},indent=2)+'\n')
 sys.exit(not result.wasSuccessful())
