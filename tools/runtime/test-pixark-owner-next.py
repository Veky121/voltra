import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('pixark',Path('internal/panel/game_library/scripts/pixark-owner-next.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ENV={'SERVER_PORT':'7777','VOLTRA_ALLOCATED_PORTS':'7777,7778,7779,7780,7781','ARK_ADMIN_PASSWORD':'Private_Test_123','SRV_NAME':'Original','WINETRICKS_RUN':'vcrun2019 dotnet6'}
class Tests(unittest.TestCase):
 def test_prerequisite_refusal_has_no_writes_or_update(self):
  with tempfile.TemporaryDirectory() as d, patch.object(m.family.steam,'update',side_effect=AssertionError('network')):
   root=Path(d)
   with self.assertRaises(ValueError):m.preflight(root,ENV)
   self.assertEqual(list(root.iterdir()),[])
 def test_native_authority_preserves_exact_bytes(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=root/m.CONFIG;p.parent.mkdir(parents=True)
   raw=b'\xef\xbb\xbf; operator\r\n[ServerSettings]\r\nServerAdminPassword=Native_Secret_123\r\nServerPassword=Join_Secret\r\nUnknown=x\r\nUnknown=y\r\n[SessionSettings]\r\nSessionName=NativeWorld\r\n[/Script/Engine.GameSession]\r\nMaxPlayers=23\r\n'
   p.write_bytes(raw);plan=m.configure(root,ENV)
   self.assertEqual(p.read_bytes(),raw);self.assertEqual(plan['password'],'Native_Secret_123')
   self.assertIn('?MaxPlayers=23',plan['args'][0]);self.assertIn('?SessionName=NativeWorld',plan['args'][0])
 def test_ambiguous_managed_refuses_unchanged(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=root/m.CONFIG;p.parent.mkdir(parents=True)
   raw=b'[ServerSettings]\nServerAdminPassword=One\nserveradminpassword=Two\n';p.write_bytes(raw)
   with self.assertRaises(ValueError):m.configure(root,ENV)
   self.assertEqual(p.read_bytes(),raw)
 def test_seed_once(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);m.configure(root,ENV);p=root/m.CONFIG;before=p.read_bytes()
   m.configure(root,{**ENV,'ARK_ADMIN_PASSWORD':'Changed_Env_123'})
   self.assertEqual(p.read_bytes(),before)
if __name__=='__main__':unittest.main()
