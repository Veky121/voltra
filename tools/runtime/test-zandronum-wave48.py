import importlib.util,sys,types,unittest,tempfile,json,re,os
from pathlib import Path
from unittest.mock import patch,Mock
ROOT=Path(__file__).resolve().parents[2];S=ROOT/'internal/panel/game_library/scripts'
def load(name,p):
 spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
# No process, network, or acquisition boundary is available in positive fixtures.
for name,attrs in [('native_console',{'run':Mock(side_effect=AssertionError('process forbidden'))}),('id_family_query',{'query':Mock(side_effect=AssertionError('network forbidden'))})]:
 m=types.ModuleType(name);m.__dict__.update(attrs);sys.modules[name]=m
native=load('native_release',S/'native-release.py');load('native_zip_release',S/'native-zip-release.py')
r=load('id_family_runtime',S/'id-family-runtime.py');i=load('id_family_install',S/'id-family-install.py');st=load('stage48',ROOT/'tools/runtime/stage-zandronum-wave48.py')
class Tests(unittest.TestCase):
 def test_secret_masking_across_chunks(self):
  steam=load('steam_redactor48',S/'steam-template.py');redactor=steam.Redactor(['fixture-secret'])
  result=redactor.feed(b'name fixture-')+redactor.feed(b'secret tail')+redactor.feed(b'',final=True)
  self.assertNotIn(b'fixture-secret',result);self.assertIn(b'[redacted]',result)

 def test_invalid_before_writes_or_acquisition(self):
  for env in [dict(SERVER_PORT='0'),dict(GEOIP='2'),dict(IWAD='../other.wad'),dict(PWADS='missing.wad'),dict(SERVER_PASSWORD='bad\nsecret'),dict(MAX_PLAYERS='129'),dict(MAP='../bad')]:
   with self.subTest(env=list(env)),tempfile.TemporaryDirectory() as t,patch.dict(os.environ,env,clear=True),patch.object(i,'download',side_effect=AssertionError('acquisition')):
    with self.assertRaises(ValueError):i.install(Path(t),'zandronum')
    self.assertEqual(list(Path(t).iterdir()),[])
 def test_runtime_no_mutation_and_bounds(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);g=p/'zandronum';(g/'IWAD').mkdir(parents=True);(g/'IWAD/freedoom1.wad').write_bytes(b'synthetic');(g/'PWAD').mkdir();(g/'PWAD/a b.wad').write_bytes(b'mod')
   cfg=g/'zandronum.ini';raw=b';unknown\xff\r\n[GlobalSettings]\r\nPath=a\r\nPath=b\r\nsv_password=secret\r\n';cfg.write_bytes(raw)
   _,args,port=r.configure(dict(PWADS='"a b.wad"',SERVER_PORT='65535',SERVER_PASSWORD='secret'),p,'zandronum')
   self.assertEqual(port,65535);self.assertIn(str(g/'PWAD/a b.wad'),args);self.assertEqual(cfg.read_bytes(),raw)
   (g/'outside.wad').write_bytes(b'outside')
   for env in [dict(IWAD='../outside.wad'),dict(PWADS='../outside.wad')]:
    with self.assertRaises(ValueError):r.configure(env,p,'zandronum')
 def test_mock_update_success_and_failure(self):
  for failure in [False,True]:
   with self.subTest(failure=failure),tempfile.TemporaryDirectory() as t,patch.dict(os.environ,{'GEOIP':'0'},clear=True):
    p=Path(t);g=p/'zandronum';g.mkdir();(g/'zandronum-server').write_bytes(b'old');(g/'zandronum.ini').write_bytes(b'unknown\xff\nPath=a\nPath=b');(g/'save').write_bytes(b'save');(g/'PWAD').mkdir();(g/'PWAD/mod.wad').write_bytes(b'mod')
    before={x.relative_to(g):x.read_bytes() for x in g.rglob('*') if x.is_file()}
    def extract(a,d,prefix):
     (d/'zandronum-server').write_bytes(b'new')
     if failure:raise ValueError('mock extraction failed')
    with patch.object(i,'download',return_value=None),patch.object(i,'tar_extract',side_effect=extract),patch.object(i,'zip_extract',return_value=None):
     if failure:
      with self.assertRaises(ValueError):i.install(p,'zandronum')
     else:i.install(p,'zandronum')
    for name,data in before.items():self.assertEqual((g/name).read_bytes(),b'new' if name==Path('zandronum-server') and not failure else data)
 def test_stage_geometry_and_controls(self):
  profile,emitted=st.stage();canonical=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[st.RECIPE]
  a=json.loads(json.dumps(profile));a['egg']['scripts']=canonical['egg']['scripts'];self.assertEqual(a,canonical)
  script=profile['egg']['scripts']['installation']['script'];self.assertLess(script.index('VOLTRA_PREFLIGHT'),script.index('VOLTRA_GEOIP'))
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)
   for name,body in re.findall(r"cat > \.voltra/([^\s]+\.py) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE",script,re.S):(p/name).write_text(body)
   for name in ['id_family_runtime.py','id_family_install.py','id_family_query.py','native_console.py','steam_template.py']:
    self.assertTrue((p/name).is_file());compile((p/name).read_text(),name,'exec')
if __name__=='__main__':unittest.main(verbosity=2)
