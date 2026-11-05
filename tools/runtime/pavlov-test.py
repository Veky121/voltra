import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('pavlov',Path('internal/panel/game_library/scripts/pavlov-native.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
E={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28400,8188','API_KEY':'fixture-api','RCON_PASSWORD':'fixture-password'}
class Tests(unittest.TestCase):
 def test_native_authority_and_retention(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);g=root/p.GAME;r=root/p.RCON;g.parent.mkdir(parents=True)
   before='\ufeff[/Script/Pavlov.DedicatedServer]\r\nApiKey="native-api"\r\nMapRotation=one\r\nMapRotation=two\r\nAdditionalMods=UGC123\r\n; keep\r\n'
   g.write_bytes(before.encode());r.write_bytes(b'Password=native-password\r\nPort=8188\r\nUnknown=keep\r\n')
   selected=p.configure(root,E)
   self.assertEqual(g.read_bytes(),before.encode());self.assertIn('native-password',selected['credentials']);self.assertIn('-KEY="native-api"',selected['args'])
   self.assertIn(b'Unknown=keep\r\n',r.read_bytes())
 def test_ambiguous_refusal_unchanged(self):
  for text in ['Password=a\npassword=b\n','+Password=a\n','Password="a" ; comment\n','Password=a\x00\n']:
   with self.subTest(text=text),self.assertRaises(ValueError):p.scalar(text,'Password')
 def test_preflight_before_acquisition_and_writes(self):
  with tempfile.TemporaryDirectory() as d,patch.object(p.base,'install') as installer:
   root=Path(d)
   with self.assertRaises(ValueError):p.install(root,{**E,'VOLTRA_ALLOCATED_PORTS':'28000,8188'})
   installer.assert_not_called();self.assertEqual(list(root.iterdir()),[])
 def test_second_file_refusal_before_first_write(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);r=root/p.RCON;r.parent.mkdir(parents=True);r.write_text('Password=a\npassword=b\n')
   with self.assertRaises(ValueError):p.configure(root,E)
   self.assertFalse((root/p.GAME).exists())
 def test_seed_and_managed_port(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p.configure(root,E)
   self.assertIn('ApiKey="fixture-api"',(root/p.GAME).read_text())
   r=root/p.RCON;r.write_text('Password=native-secret\nPort=9000\n')
   p.configure(root,E);self.assertEqual(r.read_text(),'Password=native-secret\nPort=8188\n')
 def test_native_password_boundaries(self):
  for length in (1, 20):
   with self.subTest(length=length), tempfile.TemporaryDirectory() as d:
    root=Path(d);r=root/p.RCON;r.parent.mkdir(parents=True)
    password='x'*length;r.write_text('Password='+password+'\nPort=8188\n')
    selected=p.configure(root,E)
    self.assertIn(password,selected['credentials'])
    self.assertEqual(r.read_text(),'Password='+password+'\nPort=8188\n')
 def test_invalid_native_credentials_never_fall_back(self):
  for name,key,header,values in ((p.RCON,'Password','',('', 'x'*21,'CHANGE_ME','0','REPLACE_ME')),
                                (p.GAME,'ApiKey','[/Script/Pavlov.DedicatedServer]\n',('', 'x'*65,'CHANGE_ME','0'))):
   for value in values:
    with self.subTest(name=name,value=value),tempfile.TemporaryDirectory() as d,patch.object(p.base,'install') as installer:
     root=Path(d);path=root/name;path.parent.mkdir(parents=True)
     before=(header+key+'='+value+'\n').encode();path.write_bytes(before)
     with self.assertRaises(ValueError):p.configure(root,E)
     self.assertEqual(path.read_bytes(),before)
     other=root/(p.GAME if name==p.RCON else p.RCON)
     self.assertFalse(other.exists())
     with self.assertRaises(ValueError):p.install(root,E)
     installer.assert_not_called()
 def test_duplicate_sections(self):
  with self.assertRaises(ValueError):p.scalar('[/Script/Pavlov.DedicatedServer]\nApiKey=a\n[/script/pavlov.dedicatedserver]\nApiKey=b\n','ApiKey',p.SECTION)
if __name__=='__main__':unittest.main()
