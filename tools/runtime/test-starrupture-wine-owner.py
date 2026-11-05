import json,re,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/game-parity-20261029/starrupture-wine-owner'
p=json.loads((OUT/'profile.pending.json').read_text())['starrupture/egg-star-rupture-wine.json']
fixture=r'''
import os,json,tempfile
from pathlib import Path
from unittest.mock import patch
import starrupture_wine_owner as v
g=v.shared
# Windows fixtures do not establish POSIX ownership semantics.
for name in ('chown','fchown','fchmod'):
 if not hasattr(os,name):setattr(os,name,lambda *args:None)
checks=[]
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory).resolve();env={'AUTO_UPDATE':'0','ACCEPT_WINDOWS_RUNTIME_LICENSES':'true'}
 for bad in ({'ACCEPT_WINDOWS_RUNTIME_LICENSES':'false'},{'SAVE_INTERVAL':'-1'},{'START_NEW':'maybe'},{'SESSION_NAME':'../x'},{'ADMIN_PASSWORD':'secret'},{'WINETRICKS_RUN':'bad'},{'WINEARCH':'win32'},{'STEAM_USER':'private'},{'SERVER_PORT':'1234','VOLTRA_ALLOCATED_PORTS':'4321'}):
  with patch.object(g,'update') as update:
   try:v.main('install',root,dict(env,**bad))
   except ValueError:pass
   else:raise AssertionError('invalid input accepted')
   update.assert_not_called();assert not list(root.iterdir())
 checks.append('nine refusals before game acquisition or file mutation')
 v.configure(root,'starrupture',env)
 path=root/v.CONFIG
 assert json.loads(path.read_bytes())==dict(SessionName='StarRuptureServer',SaveGameInterval='300',StartNewGame='false',LoadSavedGame='true',SaveGameName='AutoSave0.sav')
 body=b'\xef\xbb\xbf{\r\n "SessionName":"operator", "Unknown":[1,{"a":2}], "LoadSavedGame":"true"\r\n}\r\n'
 path.write_bytes(body);v.configure(root,'starrupture',dict(env,SESSION_NAME='changed'));assert path.read_bytes()==body
 checks.append('original default seeding then byte-exact native authority with BOM unknown nested keys')
 for bad in (b'{"x":1,"x":2}',b'{"x":NaN}',b'[]',b'\xff'):
  path.write_bytes(bad)
  try:v.main('install',root,env)
  except (ValueError,UnicodeError):pass
  else:raise AssertionError('malformed config accepted')
  assert path.read_bytes()==bad
 checks.append('malformed duplicate nonfinite and encoding refusal retains bytes')
 path.write_bytes(body)
 names=['DSSettings.txt','.pteroignore','Password.json','PlayerPassword.json','StarRupture/Saved/SaveGames/custom/world.sav','StarRupture/Plugins/mod/config','StarRupture/Content/Paks/~mods/mod.pak']
 for name in names[2:]:
  item=root/name;item.parent.mkdir(parents=True,exist_ok=True);item.write_bytes(b'{"Password":"opaque-native-fixture"}' if name.endswith('.json') else b'operator\x00'+name.encode())
 before={name:(root/name).read_bytes() for name in names}
 for failure in (True,False):
  def update(*args,**kwargs):
   assert args[1]==3809400 and kwargs['platform']=='windows'
   for name in names:(root/name).write_bytes(b'publisher overwrite')
   if failure:raise RuntimeError('simulated failure')
   return {'fixture_only':True}
  with patch.object(g,'update',side_effect=update):
   try:v.main('install',root,env)
   except RuntimeError:assert failure
  assert all((root/name).read_bytes()==data for name,data in before.items())
 checks.append('simulated success and failure restore config passwords backup rules saves mods plugins')
 with patch.object(g,'wine_environment',return_value=env),patch.object(g.console,'run',return_value=29) as run,patch.object(g,'follow_log') as tail:
  assert v.main('run',root,env)==29
  assert run.call_args.args[1][-4:]==['-Log','-Port=7777','-RCWebControlDisable','-RCWebInterfaceDisable']
  tail.assert_not_called();assert path.read_bytes()==body
 checks.append('one stdout console owner original argv real supervisor return preserved')
print(json.dumps({'checks':checks,'scope':'emitted Python layout and mocked updates only; no native or POSIX ownership proof'}))
'''
with tempfile.TemporaryDirectory() as directory:
 base=Path(directory)
 emitted=[]
 for name,delimiter,body in re.findall(r"cat > .voltra/(\S+) <<'([^']+)'\n(.*?)\n\2\n",p['egg']['scripts']['installation']['script'],re.S):
  (base/name).write_bytes(body.encode());emitted.append(name)
 child=subprocess.run([sys.executable,'-I','-B','-c','import sys;sys.path.insert(0,'+repr(str(base))+');'+fixture],capture_output=True,text=True,timeout=30)
 result=dict(returncode=child.returncode,stdout=child.stdout,stderr=child.stderr,emitted_modules=emitted)
 (OUT/'test-output.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result));sys.exit(child.returncode)
