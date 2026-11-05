import json, pathlib, tempfile, subprocess, sys, unittest, importlib.util, os
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Sons(unittest.TestCase):
 def test_emitted_package(self):
  profile=json.loads((ROOT/'artifacts/game-parity-20261029/sons-of-forest-owner/profile-fragment.json').read_text())['sonsoftheforest/egg-sons-of-the-forest.json']
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory); package=root/'.voltra';package.mkdir()
   script=profile['egg']['scripts']['installation']['script']
   import re
   for name,body in re.findall(r"cat > .voltra/(\S+) <<'VOLTRA_SONS_SOURCE'\n(.*?)\nVOLTRA_SONS_SOURCE\n",script,re.S): (package/name).write_text(body)
   runner=root/'verify.py'
   runner.write_text(TEST)
   result=subprocess.run([sys.executable,'-I',str(runner)],cwd=root,text=True,capture_output=True)
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)
 def test_canonical_controls(self):
  recipe='sonsoftheforest/egg-sons-of-the-forest.json'
  original=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[recipe]
  staged=json.loads((ROOT/'artifacts/game-parity-20261029/sons-of-forest-owner/profile-fragment.json').read_text())[recipe]
  self.assertEqual(original['egg']['variables'],staged['egg']['variables'])
  self.assertEqual(original['defaults'],staged['defaults'])
TEST=r'''
import importlib.util, pathlib, json
from unittest.mock import patch
root=pathlib.Path.cwd();spec=importlib.util.spec_from_file_location('sons',root/'.voltra/sons-of-forest.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
env={'SERVER_PORT':'8766','QUERY_PORT':'27016','BLOBSYNC_PORT':'9700','VOLTRA_ALLOCATED_PORTS':'8766,27016,9700','ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','AUTO_UPDATE':'0'}
for changes in [{'SAVE_SLOT':'0'},{'MAX_PLAYERS':'9'},{'GAME_MODE':'invalid'},{'SRV_NAME':'x\ny'},{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'false'},{'WINETRICKS_RUN':'mono;bad'},{'WINEARCH':'win32'},{'QUERY_PORT':'8766'},{'STEAM_PASS':'private'}]:
 before=set(root.iterdir())
 with patch.object(m.f.wine,'prepare') as prepare,patch.object(m.f.steam,'update') as update:
  try:m.execute(root,dict(env,**changes),'install')
  except ValueError:pass
  else:raise AssertionError(changes)
  prepare.assert_not_called();update.assert_not_called();assert set(root.iterdir())==before
order=[]
with patch.object(m.f.wine,'prepare',side_effect=lambda *a:order.append('runtime') or {}),patch.object(m.f,'install',side_effect=lambda *a:order.append('steam')):
 m.execute(root,env,'install')
assert order==['runtime','steam']
cfg=root/m.CONFIG;cfg.write_bytes(b'{"ServerName":"Operator","Password":"secret","SaveMode":"Continue","GameSettings":{"Extension":true},"Unknown":7}')
before=cfg.read_bytes();owners=root/'serverconfig/ownerswhitelist.txt';owners.write_bytes(b'operator\n')
with patch.object(m.f.wine,'prepare',return_value={}),patch.object(m.f.console,'run',return_value=254) as run:
 assert m.execute(root,env,'run')==254
 assert 'secret' in run.call_args.kwargs['credentials']
 assert run.call_args.kwargs['stop_signal']==m.signal.SIGINT
 assert run.call_args.kwargs['ready_marker']==b'#DSL Dedicated server loaded.'
 assert '-dedicatedserver.Password' not in run.call_args.args[1]
assert cfg.read_bytes()==before and owners.read_bytes()==b'operator\n'
for invalid in [b'{"SaveSlot":true}',b'{"SaveSlot":1,"saveslot":2}',b'{"MaxPlayers":NaN}',b'{"GameSettings":[]}']:
 cfg.write_bytes(invalid)
 with patch.object(m.f.wine,'prepare') as prepare:
  try:m.execute(root,env,'install')
  except ValueError:pass
  else:raise AssertionError(invalid)
  prepare.assert_not_called();assert cfg.read_bytes()==invalid
print('Emitted filenames: imports, 13 refusal cases, ordering, seed, native bytes, owners, signal and raw exit passed')
'''
if __name__=='__main__':unittest.main()
