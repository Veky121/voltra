import json, pathlib, re, subprocess, sys, tempfile, unittest, os
ROOT=pathlib.Path(__file__).resolve().parents[2]
PROFILE=json.loads((ROOT/'artifacts/game-parity-20261029/squad-owner/profile-fragment.json').read_text())['squad/egg-squad.json']
SCRIPT=PROFILE['egg']['scripts']['installation']['script']
class Squad(unittest.TestCase):
 def test_emitted_package(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp); package=root/'.voltra'; package.mkdir()
   for name,delimiter,body in re.findall(r"cat > \.voltra/(\S+) <<'([^']+)'\n(.*?)\n\2\n",SCRIPT,re.S):
    (package/name).write_text(body)
   probe=r'''
import os
from pathlib import Path
from unittest.mock import patch
import squad_owner as s
r=Path.cwd()
e={'VOLTRA_TACTICAL':'squad','SRCDS_APPID':'403240','SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013,28014,28015','LD_LIBRARY_PATH':str(r/'linux64')}
for bad in ({'maxplayers':'0'},{'reservedslots':'81'},{'allowteamchange':'yes'},{'WORKSHOP_ITEMS':'1,1'},{'STEAM_USER':'private'},{'AUTO_UPDATE':'yes'},{'SERVERNAME':'bad\nname'},{'QUERY_PORT':'28010'}):
 with patch.object(s,'install',side_effect=AssertionError('acquisition reached')):
  try:s.acquire(r,{**e,**bad})
  except ValueError:pass
  else:raise AssertionError(bad)
 assert not (r/'SquadGame').exists()
p=s.plan(r,e);s.seed(r,p)
f=r/s.CONFIG; first=f.read_bytes();s.seed(r,s.plan(r,e));assert f.read_bytes()==first
operator=b'\xef\xbb\xbf// operator\r\nservername="Custom"\r\nMaxPlayers=21\r\nMaxPlayers=22\r\nUnknown=keep'
f.write_bytes(operator);s.seed(r,s.plan(r,e));assert f.read_bytes().startswith(operator+b'\r\n');assert b'MaxPlayers=80' not in f.read_bytes()
before=f.read_bytes();e['maxplayers']='0'
try:s.main(r,{**e,'AUTO_UPDATE':'1'})
except ValueError:pass
else:raise AssertionError('invalid accepted')
assert f.read_bytes()==before
print('8 invalid cases refuse before acquisition/writes; seed-once/BOM/CRLF/duplicate/case/unknown retention; invalid auto-update refusal passed')
'''
   result=subprocess.run([sys.executable,'-c',probe],cwd=root,env={**os.environ,'PYTHONPATH':str(package),'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)
   print(result.stdout)
 def test_canonical_preserved(self):
  canonical=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['squad/egg-squad.json']
  self.assertEqual(PROFILE['egg']['variables'],canonical['egg']['variables'])
  self.assertEqual(PROFILE['defaults'],canonical['defaults'])
 def test_installer_bootstrap(self):
  bootstrap=SCRIPT.split("<<'VOLTRA_SQUAD_PREFLIGHT'\n")[1].split('\nVOLTRA_SQUAD_PREFLIGHT')[0]
  with tempfile.TemporaryDirectory() as tmp:
   result=subprocess.run([sys.executable,'-c',bootstrap],cwd=tmp,env={**os.environ,'VOLTRA_TACTICAL':'squad','maxplayers':'0'},capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0)
   self.assertIn('ValueError',result.stderr)
   self.assertEqual(list(pathlib.Path(tmp).iterdir()),[])
if __name__=='__main__':unittest.main()
