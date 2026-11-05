"""Extract actual installer heredocs and test in an isolated Python subprocess."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/voyagers-owner'


class EmittedTests(unittest.TestCase):
    def test_emitted_adapter(self):
        profile = json.loads((OUT / 'profile.pending.json').read_text())['voyagers_of_nera/egg-voyagers-of-nera.json']
        script = profile['egg']['scripts']['installation']['script']
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for name, delimiter, body in re.findall(r"cat > .voltra/(\S+) <<'([^']+)'\n(.*?)\n\2\n", script, re.S):
                (base / name).write_bytes(body.encode())
            self.assertEqual((base / 'native-config.py').read_bytes(), (ROOT / 'internal/panel/game_library/scripts/native-config.py').read_bytes())
            fixture = r'''
import os
from pathlib import Path
import tempfile
from unittest.mock import patch
import voyagers_owner as v
g=v.shared
if not hasattr(os,'chown'): os.chown=lambda *args: None
if not hasattr(os,'fchown'): os.fchown=lambda *args: None
if not hasattr(os,'fchmod'): os.fchmod=lambda *args: None
checks=[]
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory).resolve()
 env={'AUTO_UPDATE':'0'}
 for bad in ({'MAX_PLAYERS':'11'},{'SERVER_PASSWORD':'a\nb'},{'SERVER_NAME':'x;comment'},{'AUTO_UPDATE':'maybe'},{'WINETRICKS_RUN':'bad'},{'STEAM_USER':'private'},{'SERVER_PORT':'1234','VOLTRA_ALLOCATED_PORTS':'4321'}):
  with patch.object(g,'update') as update:
   try: v.main('install',root,dict(env,**bad))
   except ValueError: pass
   else: raise AssertionError('invalid input accepted')
   update.assert_not_called()
   assert not list(root.iterdir())
 checks.append('seven invalid inputs refuse before mutation/acquisition')
 v.configure(root,'voyagers',env)
 path=root/v.CONFIG
 assert b'MaxPlayers = 10' in path.read_bytes()
 checks.append('missing config seeded with original defaults')
 body=b'\xef\xbb\xbf;comment\r\n[/Script/BoatGame.BGCustomHostServerSettings]\r\nHostServerDisplayName=operator\r\nHostServerPassword=private\r\n+Unknown=a\r\n+Unknown=b\r\nNested=(A=1,B=2)\r\n'
 path.write_bytes(body)
 v.configure(root,'voyagers',dict(env,SERVER_NAME='other'))
 assert path.read_bytes()==body
 checks.append('native authority preserves BOM comments arrays secrets order exact bytes')
 for bad in (body+b'HostServerDisplayName=duplicate\r\n',body+b'hostserverdisplayname=ambiguous\r\n',b'\xff'):
  path.write_bytes(bad)
  try: v.configure(root,'voyagers',env)
  except (ValueError,UnicodeError): pass
  else: raise AssertionError('ambiguous encoding/keys accepted')
  assert path.read_bytes()==bad
 checks.append('duplicate/case-variant/encoding refusals preserve bytes')
 path.write_bytes(body)
 names=[v.CONFIG,'BoatGame/Saved/PersistedData/SaveData/world.sav','BoatGame/Content/Paks/~mods/mod.pak','BoatGame/Plugins/mod/config.ini']
 for name in names[1:]:
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator\x00'+name.encode())
 before={name:(root/name).read_bytes() for name in names}
 for failure in (True,False):
  def update(*args,**kwargs):
   for name in names:(root/name).write_bytes(b'publisher overwrite')
   if failure:raise RuntimeError('simulated updater failure')
   return {'fixture_only':True}
  with patch.object(g,'update',side_effect=update):
   try:v.install(root,'voyagers',env)
   except RuntimeError:
    assert failure
  assert all((root/name).read_bytes()==data for name,data in before.items())
 checks.append('simulated failed and successful updates preserve settings saves mods plugins')
 with patch.object(g.console,'run',return_value=29) as run:
  assert v.main('run',root,env)==29
  assert run.call_args.args[1][-3:]==['-Port=7777','-log','-LoggingInShippingEnabled=true']
  assert path.read_bytes()==body
 checks.append('launch uses shared supervisor original flags and preserves actual return status')
import json
print(json.dumps({'checks':checks,'platform':sys.platform if False else os.name,'ownership_note':'Windows chown no-op fixture only; no POSIX ownership acceptance'}))
'''
            child = subprocess.run([sys.executable, '-I', '-B', '-c', 'import sys;sys.path.insert(0,' + repr(str(base)) + ');' + fixture], cwd=base, capture_output=True, text=True, timeout=30)
            (OUT / 'test-output.json').write_text(json.dumps({'returncode':child.returncode,'stdout':child.stdout,'stderr':child.stderr},indent=2))
            self.assertEqual(child.returncode,0,child.stderr)


if __name__ == '__main__':
    unittest.main()
