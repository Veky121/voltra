"""Offline tests of actual emitted modules in isolated Python processes."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/mohist-owner'
RECIPE = 'minecraft/java/mohist/egg-mohist.json'
CHILD = r'''
import hashlib,json,sys,zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,sys.argv[1])
import mohist_owner as owner
import java_fork_install as fork
root=Path(sys.argv[2]);root.mkdir()
protected={'server.properties':b'# unknown\r\nlevel-seed=operator\r\ncustom=yes\r\n','eula.txt':b'eula=false\n','world/level.dat':b'world','mods/owned.jar':b'mod','plugins/owned.jar':b'plugin','config/custom.yml':b'unknown: true\n'}
for name,data in protected.items():
 p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
def snapshot():return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
env={'EULA_ACCEPTED':'true','MC_VERSION':'1.20.1','PROJECT':'mohist'}
case=sys.argv[3]
if case in ('consent','project','version','checksum','arm'):
 if case=='consent':env.pop('EULA_ACCEPTED')
 if case=='project':env['PROJECT']='substitute'
 if case=='version':env['MC_VERSION']='../../escape'
 if case=='checksum':env['DOWNLOAD_SHA256']='invalid'
 before=snapshot()
 with patch.object(fork,'resolve',side_effect=AssertionError('resolution before validation')),patch.object(owner.platform,'machine',return_value='aarch64' if case=='arm' else 'AMD64'):
  try:owner.install(root,env)
  except ValueError:pass
  else:raise AssertionError('expected refusal')
 assert snapshot()==before
else:
 cache=root/'.voltra/public-cache';cache.mkdir(parents=True)
 jar=root/'fixture.jar'
 with zipfile.ZipFile(jar,'w') as z:
  z.writestr('META-INF/MANIFEST.MF','Manifest-Version: 1.0\nMain-Class: fixture.Server\n')
  z.writestr('fixture/Server.class',b'\xca\xfe\xba\xbe\x00\x00'+(65 if case=='java' else 61).to_bytes(2,'big')+b'fixture')
 sha=hashlib.sha256(jar.read_bytes()).hexdigest();jar.rename(cache/sha)
 release={'version':'fixture','sha256':sha,'java':17,'url':'https://example.invalid/not-contacted'}
 with patch.object(fork,'resolve',return_value=release),patch.object(owner.platform,'machine',return_value='AMD64'):
  if case=='java':
   try:owner.install(root,env)
   except ValueError as e:assert 'Java 21' in str(e)
   else:raise AssertionError('incompatible runtime accepted')
   assert not (root/'server.jar').exists()
  else:
   owner.install(root,env)
   first=(root/'server.jar').read_bytes()
   owner.install(root,env)
   assert (root/'server.jar').read_bytes()==first
   (cache/sha).write_bytes(b'corrupt')
   try:owner.install(root,env)
   except ValueError:pass
   else:raise AssertionError('corrupt update accepted')
   assert (root/'server.jar').read_bytes()==first
 for name,data in protected.items():assert (root/name).read_bytes()==data,name
print(json.dumps({'case':case,'result':'pass','boundary':'synthetic offline emitted modules; no native Java execution'}))
'''


class EmittedTests(unittest.TestCase):
    def test_emitted_modules(self):
        profile = json.loads((OUT / 'profile.pending.json').read_text())[RECIPE]
        script = profile['egg']['scripts']['installation']['script']
        with tempfile.TemporaryDirectory(prefix='mohist-emitted-') as directory:
            base = Path(directory)
            modules = base / 'modules'
            modules.mkdir()
            for name, delimiter, body in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2", script, re.S):
                self.assertEqual(Path(name).name, name)
                (modules / name).write_text(body + '\n', encoding='utf-8')
            self.assertTrue((modules / 'mohist_owner.py').is_file())
            receipts = []
            for case in ('consent', 'project', 'version', 'checksum', 'arm', 'java', 'preservation'):
                with self.subTest(case=case):
                    result = subprocess.run([sys.executable, '-I', '-B', '-c', CHILD, str(modules), str(base / case), case], capture_output=True, text=True, timeout=30)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    receipts.append(json.loads(result.stdout))
            (OUT / 'offline-tests.json').write_text(json.dumps(receipts, indent=2) + '\n')


if __name__ == '__main__':
    unittest.main()
