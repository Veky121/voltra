import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name,file):
 s=importlib.util.spec_from_file_location(name,BASE/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
load('steam_template','steam-template.py');load('additional_survival_install','additional-survival-install.py')
# Test installer-emitted names, rather than relying on source filenames.
with tempfile.TemporaryDirectory() as d:
 import subprocess
 subprocess.run(['node','tools/runtime/stage-onset-wave30.mjs'],check=True)
 profile=json.loads(Path('artifacts/game-parity-20261029/wave30-onset/profile.pending.json').read_text())
 script=profile['egg']['scripts']['installation']['script']
 import re
 for name,body in re.findall(r"cat > .voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE\n",script,re.S):
  Path(d,name).write_text(body,encoding='utf-8')
 sys.path.insert(0,d)
 s=importlib.util.spec_from_file_location('onset_native',Path(d,'onset_native.py'));game=importlib.util.module_from_spec(s);s.loader.exec_module(game)

ENV={'SERVER_PORT':'28012','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012','AUTO_UPDATE':'0'}
class OnsetTests(unittest.TestCase):
 def test_seed_and_honor_bytes(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=root/'server_config.json';game.configure(root,'onset',ENV)
   body=b'{ "port":28012, "ipaddress":"0.0.0.0", "servername":"operator", "password":"secret", "masterlist":false, "custom":9007199254740993 }'
   p.write_bytes(body);game.configure(root,'onset',dict(ENV,SERVER_NAME='ignored'));self.assertEqual(p.read_bytes(),body)
 def test_refusal_before_acquisition(self):
  with tempfile.TemporaryDirectory() as d,patch.object(game.shared,'install') as acquire:
   for extra in ({'VOLTRA_ALLOCATED_PORTS':'28012'},{'STEAM_USER':'x','STEAM_PASS':'secret'},{'WINDOWS_INSTALL':'1'},{'AUTO_UPDATE':'bad'}):
    with self.assertRaises(ValueError):game.install(Path(d),dict(ENV,**extra))
   acquire.assert_not_called();self.assertEqual(list(Path(d).iterdir()),[])
 def test_update_retention(self):
  for fail in (False,True):
   with tempfile.TemporaryDirectory() as d:
    root=Path(d);p=root/'server_config.json';body=b'{"port":28012,"ipaddress":"0.0.0.0","servername":"custom","password":"secret","masterlist":false,"unknown":123}'
    p.write_bytes(body);(root/'packages').mkdir();save=root/'packages/save';save.write_bytes(b'world')
    def update(*args,**kwargs):
     p.write_text('{}');save.write_bytes(b'overwritten')
     if fail:raise RuntimeError('mock update failure')
     return {'mock':True}
    with patch.object(game.shared,'update',side_effect=update),patch.object(game.shared,'onset_compat'):
     if fail:
      with self.assertRaises(RuntimeError):game.install(root,ENV)
     else:game.install(root,ENV)
    self.assertEqual(p.read_bytes(),body);self.assertEqual(save.read_bytes(),b'world')
 def test_duplicate_refusal(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'server_config.json';p.write_bytes(b'{"x":{"a":1,"a":2}}');before=p.read_bytes()
   with self.assertRaises(ValueError):game.configure(Path(d),'onset',ENV)
   self.assertEqual(p.read_bytes(),before)
if __name__=='__main__':unittest.main()
