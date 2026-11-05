import json, pathlib, tempfile, subprocess, sys, unittest, re
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Forest(unittest.TestCase):
 def test_emitted_package(self):
  profile=json.loads((ROOT/'artifacts/game-parity-20261029/forest-credentials-owner/profile-fragment.json').read_text())['the_forest/egg-the-forest.json']
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory); package=root/'.voltra';package.mkdir()
   for name,body in re.findall(r"cat > .voltra/(\S+) <<'VOLTRA_FOREST_NATIVE_SOURCE'\n(.*?)\nVOLTRA_FOREST_NATIVE_SOURCE\n",profile['egg']['scripts']['installation']['script'],re.S): (package/name).write_text(body)
   runner=root/'verify.py';runner.write_text(TEST)
   result=subprocess.run([sys.executable,'-I',str(runner)],cwd=root,text=True,capture_output=True)
   self.assertEqual(result.returncode,0,result.stdout+result.stderr)
   print(result.stdout)
 def test_canonical_controls(self):
  recipe='the_forest/egg-the-forest.json'
  original=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[recipe]
  staged=json.loads((ROOT/'artifacts/game-parity-20261029/forest-credentials-owner/profile-fragment.json').read_text())[recipe]
  self.assertEqual(original['egg']['variables'],staged['egg']['variables'])
  self.assertEqual(original['defaults'],staged['defaults'])
TEST=r'''
import importlib.util,pathlib,signal,os
from unittest.mock import patch
root=pathlib.Path.cwd();spec=importlib.util.spec_from_file_location('forest',root/'.voltra/forest-native.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.f.shared.__file__.startswith(str(root/'.voltra'))
assert m.f.steam.__file__==str(root/'.voltra/steam_template.py')
env={'SERVER_PORT':'27015','STEAM_PORT':'8766','QUERY_PORT':'27016','VOLTRA_ALLOCATED_PORTS':'27015,8766,27016','ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','AUTO_UPDATE':'0'}
for changes in [{'SERVER_NAME':'x\ny'},{'MAX_PLAYERS':'0'},{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'false'},{'WINETRICKS_RUN':'sound=disabled;bad'},{'WINEARCH':'win32'},{'QUERY_PORT':'8766'},{'STEAM_PASS':'private'},{'SRCDS_APPID':'242760'},{'AUTO_UPDATE':'yes'}]:
 before=set(root.iterdir())
 with patch.object(m.f.wine,'prepare') as prepare,patch.object(m.f.steam,'update') as update:
  try:m.execute(root,dict(env,**changes),'install')
  except ValueError:pass
  else:raise AssertionError(changes)
  prepare.assert_not_called();update.assert_not_called();assert set(root.iterdir())==before
# Missing config seeds original controls before first boot.
_,_,_,seeded,values=m.plan(root,dict(env,SERVER_NAME='Initial Name'))
assert m.parse(seeded)['serverName']=='Initial Name' and values['serverName']=='Initial Name'
assert not (root/m.CONFIG).exists()
cfg=root/m.CONFIG;cfg.parent.mkdir(parents=True)
original=(b'// opaque \xff\r\nserverIP 0.0.0.0\r\nserverSteamPort 8766\r\nserverGamePort 27015\r\nserverQueryPort 27016\r\nserverName Operator\r\nserverPlayers 8\r\nserverPassword private\r\nserverPasswordAdmin admin\r\nserverSteamAccount token\r\nenableVAC off\r\ninitType Continue\r\ndifficulty Hard\r\nmodArray [1,2]\r\nmodArray [3]\r\n')
cfg.write_bytes(original);cfg.chmod(0o640)
for invalid in [original+b'serverName duplicate\n',original+b'SERVERNAME case\n',original.replace(b'admin\r\n',b'admin\0secret\r\n')]:
 cfg.write_bytes(invalid)
 with patch.object(m.f.wine,'prepare') as prepare,patch.object(m.f.steam,'update') as update:
  try:m.execute(root,env,'install')
  except ValueError:pass
  else:raise AssertionError('ambiguous config accepted')
  assert cfg.read_bytes()==invalid;prepare.assert_not_called();update.assert_not_called()
cfg.write_bytes(original)
with patch.object(m.f.wine,'prepare',return_value={}),patch.object(m.f.console,'run',return_value=254) as run:
 assert m.execute(root,env,'run')==254
 assert run.call_args.kwargs['stop_signal']==signal.SIGINT
 assert run.call_args.kwargs['credentials']==('private','admin','token')
 assert run.call_args.args[1][run.call_args.args[1].index('-inittype')+1]=='Continue'
assert cfg.read_bytes()==original
# Stale environment credentials are seed inputs only. The active file wins.
import io,contextlib
captured=io.StringIO()
with contextlib.redirect_stdout(captured),contextlib.redirect_stderr(captured),patch.object(m.f.wine,'prepare',return_value={}),patch.object(m.f.console,'run',return_value=0) as run:
 m.execute(root,dict(env,SERVER_PASS='stale-player',ADMIN_PASS='stale-admin',STEAM_ACC='stale-token'),'run')
 argv=run.call_args.args[1]
 assert argv==['xvfb-run','--auto-servernum','--server-args=-screen 0 640x480x24:32','wine',str(root/'TheForestDedicatedServer.exe'),'-batchmode','-nographics','-inittype','Continue','-nosteamclient','-savefolderpath',str(root/'TheForestDedicatedServer_Data'),'-configfilepath',str(cfg)]
 assert run.call_args.kwargs['credentials']==('private','admin','token')
 assert not any(secret in argv for secret in ('private','admin','token','stale-player','stale-admin','stale-token'))
 assert captured.getvalue()=='' and cfg.read_bytes()==original
 redactor=m.f.console.Redactor(run.call_args.kwargs['credentials'])
 output=redactor.feed(b'private admin token\n',final=True)
 assert all(secret not in output for secret in (b'private',b'admin',b'token'))
# Shared updater preservation used with exact emitted helpers, both outcomes.
world=root/'TheForestDedicatedServer_Data/Multiplayer/world';world.parent.mkdir(parents=True);world.write_bytes(b'opaque world')
for fail in (False,True):
 order=[]
 def update(*args,**kwargs):
  order.append('steam');cfg.write_bytes(b'depot overwrite');world.write_bytes(b'depot overwrite')
  if fail: raise RuntimeError('simulated updater failure')
  return {'fixture':True}
 with patch.object(m.f.wine,'prepare',side_effect=lambda *a:order.append('runtime') or {}),patch.object(m.f.steam,'update',side_effect=update):
  try:m.execute(root,env,'install')
  except RuntimeError:
   assert fail
 assert order==['runtime','steam'];assert cfg.read_bytes()==original;assert world.read_bytes()==b'opaque world';assert cfg.stat().st_mode&0o777==0o640
# Allocation-only edit leaves every other original byte intact.
with patch.object(m.f.wine,'prepare',return_value={}),patch.object(m.f.console,'run',return_value=0):
 m.execute(root,dict(env,SERVER_PORT='28000',VOLTRA_ALLOCATED_PORTS='28000,8766,27016'),'run')
assert cfg.read_bytes()==original.replace(b'serverGamePort 27015',b'serverGamePort 28000')
print('emitted helpers: 9 refusal cases, 3 malformed/duplicate cases, native authority/raw exit, success/failure preservation, allocation-only edit passed')
'''
if __name__=='__main__': unittest.main()
