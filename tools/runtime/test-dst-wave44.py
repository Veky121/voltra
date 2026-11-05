"""Source-only execution of canonical emitted shell with acquisition mocked."""
import json, os, re, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
KEY='dont_starve/egg-don-t-starve-together.json'
PROFILE=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[KEY]
SCRIPT=PROFILE['egg']['scripts']['installation']['script']
ENV=dict(SERVER_PORT='10998',VOLTRA_ALLOCATED_PORTS='10998,10999,23563,23565,23567,23569',ONLINE_MODE='0')
WRAPPER=r'''
import os,sys,runpy
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path.cwd()/'.voltra'))
def event(name):
 with open('events','a') as f:f.write(name+'\n')
if sys.argv[1].endswith('bundle_debian_python.py'):
 event('bundle'); sys.exit(0)
import steam_template,urllib.request
with patch.object(steam_template,'update',side_effect=lambda *a,**k:event('steam')),patch.object(urllib.request,'urlopen',side_effect=AssertionError('network forbidden')):
 if sys.argv[1]=='-c':exec(sys.argv[2])
 else:runpy.run_path(sys.argv[1],run_name='__main__')
'''
class EmittedInstaller(unittest.TestCase):
 def execute(self,changes=None,invalid_ini=False):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d); (root/'wrapper.py').write_text(WRAPPER)
   if invalid_ini:
    p=root/'DoNotStarveTogether/config/server/Caves/server.ini';p.parent.mkdir(parents=True);p.write_text('[NETWORK]\nserver_port=1\nserver_port=2\n')
   before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file() and p.name!='wrapper.py'}
   # Only relocate volume, replace external bootstrap commands with shell mocks.
   script=SCRIPT.replace('cd /mnt/server','cd "$DST_FIXTURE"')
   prefix='apt-get() { echo apt >> events; }; python3() { "$DST_PYTHON" wrapper.py "$@"; }; export -f apt-get python3\n'
   (root/'install.sh').write_text(prefix+script)
   env={**os.environ,**ENV,**(changes or {}),'DST_FIXTURE':d.replace('\\','/'),'DST_PYTHON':sys.executable.replace('\\','/'),'PYTHONDONTWRITEBYTECODE':'1'}
   proc=subprocess.run(['C:/Program Files/Git/bin/bash.exe','install.sh'],cwd=root,env=env,capture_output=True,text=True)
   after={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file() and not str(p.relative_to(root)).startswith('.voltra') and p.name not in ('wrapper.py','events','install.sh')}
   events=(root/'events').read_text().splitlines()
   return proc,events,before,after
 def test_positive_fresh_install_without_binary(self):
  result,events,_,_=self.execute();self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(events,['apt','apt','bundle','steam'])
 def test_invalid_inputs_refuse_before_bundle_and_acquisition(self):
  for env in ({'ONLINE_MODE':'1','SERVER_TOKEN':''},{'MASTER_WORLDGEN':'http://bad.test/world.lua'},{'VOLTRA_ALLOCATED_PORTS':'10998,10999'},{'MAX_PLAYERS':'32'}):
   with self.subTest(env=env):
    result,events,before,after=self.execute(env);self.assertNotEqual(result.returncode,0);self.assertEqual(events,['apt','apt']);self.assertEqual(before,after)
 def test_invalid_native_ini_preserved(self):
  result,events,before,after=self.execute(invalid_ini=True);self.assertNotEqual(result.returncode,0);self.assertEqual(events,['apt','apt']);self.assertEqual(before,after)
 def test_emitted_filenames_and_current_helpers(self):
  for source,target in [('dst-config.py','dst_config.py'),('dst-install.py','dst_install.py'),('dst-runtime.py','dst_runtime.py')]:
   emitted=SCRIPT.split("cat > .voltra/"+target+" <<'VOLTRA_SOURCE'\n",1)[1].split('\nVOLTRA_SOURCE',1)[0]
   self.assertEqual(emitted.strip(),(ROOT/'internal/panel/game_library/scripts'/source).read_text().strip())
if __name__=='__main__':unittest.main(verbosity=2)
