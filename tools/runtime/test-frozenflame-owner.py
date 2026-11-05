import importlib.util, json, pathlib, sys, tempfile, unittest
from unittest.mock import patch
base=pathlib.Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
# Load the exact emitted filenames and content, without running apt or acquisition.
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.root=pathlib.Path(self.tmp.name)
  self.addCleanup(self.tmp.cleanup)
  recipe=json.loads((base.parents[3]/'artifacts/game-parity-20261029/wave30-frozenflame/recipe-fragment.json').read_text())['frozen_flame/egg-frozen-flame.json']
  import re,base64
  script=recipe['egg']['scripts']['installation']['script']
  for name,content in re.findall(r"cat > .voltra/(\S+) <<'VOLTRA_BUILDING_SOURCE'\n(.*?)\nVOLTRA_BUILDING_SOURCE",script,re.S): (self.root/name).write_text(content)
  encoded=re.search(r"printf '%s' '([^']+)'",script)[1]
  (self.root/'frozenflame_owner.py').write_bytes(base64.b64decode(encoded))
  sys.path.insert(0,str(self.root));self.addCleanup(lambda:sys.path.remove(str(self.root)))
  for name in ['steam_template','native_config','native_console','unreal_building','frozenflame_owner']:sys.modules.pop(name,None)
  import frozenflame_owner
  self.game=frozenflame_owner
  self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','RCON_PORT':'28002','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002'}
  self.target=self.root/self.game.shared.metadata()['frozen']['config'];self.target.parent.mkdir(parents=True)
  binary=self.root/self.game.shared.metadata()['frozen']['binary'];binary.parent.mkdir(parents=True);binary.write_bytes(b'fixture')
 def test_seed_then_native_edit_retained(self):
  self.game.configure(self.root,self.env)
  old=b'\xef\xbb\xbf;private unknown\r\n[/Script/Engine.GameSession]\r\nMaxPlayers=23\r\n[/Script/FrozenFlame.FGameSession]\r\nServerPassword="native secret"\r\n'
  self.target.write_bytes(old);argv,*_=self.game.configure(self.root,{**self.env,'MAX_PLAYERS':'7'})
  self.assertEqual(self.target.read_bytes(),old);self.assertIn('-RconPort=28002',argv)
 def test_invalid_refuses_before_update(self):
  for extra in ({'QUERY_PORT':'28000'},{'AUTO_UPDATE':'yes'},{'SERVER_NAME':'bad\nname'}):
   with patch.object(self.game.shared,'install') as install,self.assertRaises(ValueError):self.game.install(self.root,{**self.env,**extra})
   install.assert_not_called();self.assertFalse(self.target.exists())
 def test_aliases_refused_without_writes(self):
  for body in ['MaxPlayers=1\nmaxplayers=2','+MaxPlayers=2']:
   old=('[/Script/Engine.GameSession]\n'+body+'\n').encode();self.target.write_bytes(old)
   with self.assertRaises(ValueError):self.game.configure(self.root,self.env)
   self.assertEqual(old,self.target.read_bytes())
 def test_update_success_failure_restore(self):
  for failure in [False,True]:
   old=b';private operator bytes\n';self.target.write_bytes(old)
   def update(*a,**kw):
    self.target.write_bytes(b'publisher replacement')
    if failure:raise RuntimeError('mock update failure')
   with patch.object(self.game.shared,'update',side_effect=update):
    if failure:
     with self.assertRaises(RuntimeError):self.game.install(self.root,self.env)
    else:self.game.install(self.root,self.env)
   self.assertEqual(self.target.read_bytes(),old)
if __name__=='__main__':unittest.main()
