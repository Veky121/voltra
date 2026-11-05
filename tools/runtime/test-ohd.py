import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess
import sys

source=Path('internal/panel/game_library/scripts/ohd-runtime.py').resolve()
spec=importlib.util.spec_from_file_location('ohd',source)
ohd=importlib.util.module_from_spec(spec); spec.loader.exec_module(ohd)
ENV={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,27005,7779','RCON_PASSWORD':'operator-secret'}

class OHDTests(unittest.TestCase):
 def test_seed_then_native_authority(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d); plan,before,after=ohd.prepare(root,ENV)
   target=root/ohd.FILE; target.parent.mkdir(parents=True);target.write_bytes(after.encode())
   custom=after.replace('MaxPlayers = 32','MaxPlayers = 48')+'\r\n[Unknown]\r\n+Mod=one\r\n+Mod=two\r\n'
   target.write_bytes(custom.encode())
   plan,before,after=ohd.prepare(root,ENV)
   self.assertEqual(before,custom);self.assertEqual(after,custom)
   self.assertIn('AAS-TestMap?MaxPlayers=48',plan['args'])
   self.assertEqual(plan['args'][0],'HarshDoorstop')
 def test_refusal_before_update_or_write(self):
  for content in ['[/Script/RCON.RCONServerSystem]\nListenPort=1\n','[/Script/Engine.GameSession]\nMaxPlayers=1\nmaxplayers=2\n','[/Script/Engine.GameSession]\nMaxPlayers=bad\n']:
   with tempfile.TemporaryDirectory() as d:
    root=Path(d);target=root/ohd.FILE;target.parent.mkdir(parents=True);target.write_text(content)
    with patch.object(ohd.shared.steam,'update',side_effect=AssertionError('acquisition')):
     with self.assertRaises(ValueError):ohd.install(root,ENV)
    self.assertEqual(target.read_text(),content)
 def test_update_success_and_failure_retention(self):
  for fail in (False,True):
   with tempfile.TemporaryDirectory() as d:
    root=Path(d);target=root/ohd.FILE;target.parent.mkdir(parents=True)
    original=b'[/Script/Engine.GameSession]\r\nMaxPlayers=48\r\n; private bytes\r\n';target.write_bytes(original)
    world=target.parent/'save.bin';world.write_bytes(b'save')
    def update(*args,**kwargs):
     target.write_bytes(b'publisher overwrite')
     if fail:raise ValueError('mock update failed')
    with patch.object(ohd.shared.steam,'update',side_effect=update):
     if fail:
      with self.assertRaisesRegex(ValueError,'mock update failed'):ohd.install(root,ENV)
     else:ohd.install(root,ENV)
    self.assertEqual(target.read_bytes(),original);self.assertEqual(world.read_bytes(),b'save')
 def test_installer_emitted_imports(self):
  import json
  egg=next(iter(json.loads(Path('artifacts/game-parity-20261029/wave30-ohd/recipe-fragment.json').read_text()).values()))['egg']
  import re
  with tempfile.TemporaryDirectory() as d:
   for name,marker,body in re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2",egg['scripts']['installation']['script'],re.S):
    Path(d,name).write_text(body)
   result=subprocess.run([sys.executable, '-c', 'import ohd_runtime; print(ohd_runtime.FILE)'],cwd=d,capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr)
   self.assertIn('HarshDoorstop',result.stdout)

if __name__=='__main__':unittest.main()
