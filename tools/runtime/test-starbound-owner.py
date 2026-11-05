"""Offline emitted-package tests; never starts a native game or acquisition."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
REPORT=ROOT/'artifacts/game-parity-20261029/starbound-owner'
PROFILE=json.loads((REPORT/'profiles.pending.json').read_text())['starbound/egg-starbound.json']
SCRIPT=PROFILE['egg']['scripts']['installation']['script']

class Package(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
        self.package=self.root/'package';self.package.mkdir()
        for name,source in re.findall(r"cat > .voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE\n",SCRIPT,re.S):
            (self.package/name).write_text(source,encoding='utf-8')
        self.volume=self.root/'volume';self.volume.mkdir()
    def run_python(self,code):
        result=subprocess.run([sys.executable,'-B','-c',code],cwd=self.volume,env={**__import__('os').environ,'PYTHONPATH':str(self.package)},capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
    def test_emitted_install_refuses_without_writes(self):
        self.run_python('''from pathlib import Path
from starbound_install import install
root=Path.cwd()
base={'SERVER_PORT':'21025','VOLTRA_ALLOCATED_PORTS':'21025'}
for extra in ({},{'STEAM_USER':'anonymous'},{'STEAM_USER':'entitled'},{'STEAM_USER':'entitled','WORKSHOP':'2'},{'SERVER_PORT':'0'},{'SRCDS_APPID':'1'},{'AUTO_UPDATE':'yes'}):
 try: install(root,{**base,**extra})
 except ValueError: pass
 else: raise AssertionError('must refuse')
 assert not list(root.iterdir()),list(root.iterdir())
''')
    def test_native_json_patch_preserves_operator_bytes(self):
        self.run_python('''from starbound_runtime import port_patch,document
text='{ "serverName":"operator", "gameServerPort" : 21025, "unknown":{"n":123456789012345678901234567890,"x":[true,null]}, "serverUsers":{"a":{"password":"private"}} }\\r\\n'
out=port_patch(text,22025)
assert out==text.replace('21025','22025')
assert port_patch(out,22025)==out
for bad in ('{"gameServerPort":1,"GameServerPort":2}','{"x":{"a":1,"a":2}}','{"x":NaN}','[]'):
 try: document(bad)
 except ValueError: pass
 else: raise AssertionError(bad)
assert document(port_patch('{}',21025))=={'gameServerPort':21025}
''')
    def test_runtime_seed_once_and_no_write_on_missing_binary(self):
        self.run_python('''import json
from pathlib import Path
from starbound_runtime import configure
root=Path.cwd();env={'SERVER_PORT':'21025','VOLTRA_ALLOCATED_PORTS':'21025'}
(root/'sbinit.config').write_text('{"storageDirectory":"storage"}')
try: configure(root,env)
except ValueError: pass
else: raise AssertionError('missing binary')
assert not (root/'storage').exists()
(root/'starbound_server').write_text('offline fixture only');(root/'starbound_server').chmod(0o755)
configure(root,env)
target=root/'storage/starbound_server.config'
text=target.read_text().replace('21025','21025, "serverName":"Operator", "custom":[1,2]')
target.write_text(text)
configure(root,env);assert target.read_text()==text
(root/'sbinit.config').write_text('{"storageDirectory":"custom"}')
try: configure(root,env)
except ValueError: pass
else: raise AssertionError('inactive file')
assert target.read_text()==text
''')
    def test_canonical_controls_unchanged(self):
        current=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['starbound/egg-starbound.json']
        self.assertEqual(PROFILE['egg']['variables'],current['egg']['variables'])
        self.assertEqual(PROFILE['defaults'],current['defaults'])
        self.assertEqual(PROFILE['egg']['config'],current['egg']['config'])

if __name__=='__main__':unittest.main(verbosity=2)
