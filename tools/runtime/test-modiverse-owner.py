"""Tests actual emitted import names in a fresh isolated child. No acquisition."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import importlib.util

spec = importlib.util.spec_from_file_location('stage', Path(__file__).with_name('stage-modiverse-owner.py'))
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)

CHILD = r'''
import json, os
from pathlib import Path
from unittest.mock import patch
import modiverse_owner as app
root = Path('volume').resolve(); root.mkdir()
env = dict(SERVER_PORT='7777', QUERY_PORT='27015', VOLTRA_ALLOCATED_PORTS='7777,27015', AUTO_UPDATE='0')
def snapshot():
    return {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
def refusal(env):
    before = snapshot()
    try: app.install(root, env)
    except ValueError: pass
    else: raise AssertionError('expected refusal')
    assert before == snapshot()
with patch.object(app.steam_template, 'update', side_effect=AssertionError('network forbidden')):
    refusal(dict(env, MAX_PLAYERS='129'))
    refusal(dict(env, VOLTRA_ALLOCATED_PORTS='7777'))
app.configure(root, env)
path=root/app.CONFIG
raw=b'\xef\xbb\xbf{ "pin":"private", "rconPassword":"secret", "unknown":[1,{"x":2}], "mapCycle":[] }\r\n'
path.write_bytes(raw)
argv, secrets=app.configure(root, env)
assert path.read_bytes()==raw and 'private' in secrets and 'secret' in secrets
assert '-KJModBaseUGCFolder=ServerData' in argv
save=root/'KJMod/Saved/world'; save.parent.mkdir(parents=True); save.write_bytes(b'world')
mod=root/'Mods/plugin'; mod.parent.mkdir(); mod.write_bytes(b'mod')
before=snapshot()
def update(*args, **kwargs):
    path.write_bytes(b'overwritten'); save.write_bytes(b'lost'); mod.unlink()
    if failed: raise RuntimeError('simulated publisher failure')
    return {'fixture':True}
for failed in (False,True):
    with patch.object(app.platform,'system',return_value='Linux'), patch.object(app.platform,'machine',return_value='x86_64'), patch.object(app.steam_template,'arguments'), patch.object(app.steam_template,'update',side_effect=update):
        try: app.install(root,env)
        except RuntimeError:
            assert failed
    assert snapshot()==before
with patch.object(app.platform,'system',return_value='Linux'), patch.object(app.platform,'machine',return_value='aarch64'):
    refusal(env)
path.write_bytes(b'{ // native comment\n invalid }')
refusal(env)
assert path.read_bytes()==b'{ // native comment\n invalid }'
print('PASS emitted imports, seed-once, BOM/unknown arrays/secrets, invalid preflight, ARM refusal, success/failure retention')
'''

class Emitted(unittest.TestCase):
    def test_isolated(self):
        payloads=stage.stage()
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for name, data in payloads.items():
                (root/name).write_text(data,encoding='utf-8')
            (root/'check.py').write_text(CHILD,encoding='utf-8')
            result=subprocess.run([sys.executable,'-I', '-c', 'import sys; sys.path.insert(0, '+repr(folder)+'); exec(open('+repr(str(root/'check.py'))+').read())'],cwd=root,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            stage.OUT.joinpath('offline-tests.txt').write_text(result.stdout+result.stderr)

if __name__=='__main__': unittest.main()
