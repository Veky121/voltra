import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('vanilla',ROOT/'internal/panel/game_library/scripts/space-engineers-vanilla.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
ENV={'SERVER_PORT':'28020','STEAM_PORT':'28021','REMOTEAPI_PORT':'28022','VOLTRA_ALLOCATED_PORTS':'28020,28021,28022'}
class Tests(unittest.TestCase):
 def fixture(self,root,encoding='utf-16'):
  world=root/'config/Saves/Operator/Sandbox.sbc';world.parent.mkdir(parents=True)
  world.write_bytes(('<MyObjectBuilder_Checkpoint><!--operator--><Settings><MaxPlayers>17</MaxPlayers></Settings><Mods><ModItem><PublishedFileId>123</PublishedFileId></ModItem></Mods><Identities><item>9007199254740993</item></Identities></MyObjectBuilder_Checkpoint>').encode(encoding))
  cfg=root/'config/SpaceEngineers-Dedicated.cfg'
  cfg.write_bytes(('<MyConfigDedicated><LoadWorld>'+v.base.windows(world)+'</LoadWorld><ServerPort>28020</ServerPort><SteamPort>28021</SteamPort><RemoteApiPort>28022</RemoteApiPort><RemoteSecurityKey>private-key</RemoteSecurityKey><ServerName>operator</ServerName></MyConfigDedicated>').encode(encoding))
  return cfg,world
 def test_native_authority_utf16_and_utf8(self):
  for encoding in ['utf-16','utf-8-sig']:
   with tempfile.TemporaryDirectory() as d:
    root=Path(d);files=self.fixture(root,encoding);before=[p.read_bytes() for p in files]
    argv,secrets=v.configure(root,'space',{**ENV,'MAX_PLAYERS':'4','WORLD_NAME':'World'})
    self.assertEqual(before,[p.read_bytes() for p in files]);self.assertIn('private-key',secrets);self.assertIn('-ignorelastsession',argv)
 def test_refusal_precedes_acquisition(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);files=self.fixture(root);before=[p.read_bytes() for p in files]
   with patch.object(v.base,'install') as install:
    with self.assertRaises(ValueError):v.main('install',root,{**ENV,'SERVER_PORT':'28023','VOLTRA_ALLOCATED_PORTS':'28023,28021,28022'})
    install.assert_not_called()
   self.assertEqual(before,[p.read_bytes() for p in files])
 def test_missing_world_no_fallback(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);cfg,world=self.fixture(root);world.unlink();before=cfg.read_bytes()
   with self.assertRaises(ValueError):v.preflight(root,ENV)
   self.assertEqual(before,cfg.read_bytes())
 def test_unsafe_xml_refuses_without_writes(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);cfg,world=self.fixture(root);world.write_bytes(b'<!DOCTYPE x><MyObjectBuilder_Checkpoint/>');before=cfg.read_bytes()
   with self.assertRaises(ValueError):v.preflight(root,ENV)
   self.assertEqual(before,cfg.read_bytes())
 def test_fresh_original_seed_and_torch_refusal(self):
  with tempfile.TemporaryDirectory() as d:
   with patch.object(v,'original_configure',return_value=('seed',[])) as seed:
    self.assertEqual(v.configure(Path(d),'space',ENV),('seed',[]));seed.assert_called_once()
   with self.assertRaises(ValueError):v.configure(Path(d),'torch',ENV)
if __name__=='__main__':unittest.main()
