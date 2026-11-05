import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
spec=importlib.util.spec_from_file_location('notd', BASE/'notd-server.py')
notd=importlib.util.module_from_spec(spec);spec.loader.exec_module(notd)

class Tests(unittest.TestCase):
 def test_active_copy_wins_and_template_only_seeds_missing_copy(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);template=root/'ServerSettings.ini'
   original=b'\xef\xbb\xbf[ServerSettings]\r\nServerName=template\r\n+Mods=a\r\n+Mods=b\r\nUnknown=keep\r\n'
   template.write_bytes(original)
   name,data=notd.ini_plan(root,notd.ACTIVE_INI,{'ServerSettings':{'ServerName':'managed'}},'fallback')
   self.assertEqual(data,original.replace(b'=template',b'=managed'))
   self.assertEqual(template.read_bytes(),original)
   active=root/name;active.parent.mkdir(parents=True)
   active.write_bytes(original.replace(b'=template',b'=operator'))
   self.assertIn(b'=operator',notd.ini_plan(root,name,{})[1])
   self.assertEqual(template.read_bytes(),original)
 def test_installer_seed_preserves_publisher_template(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=b'[ServerSettings]\nUnknown=operator\n'
   (root/'ServerSettings.ini').write_bytes(source)
   def installer(root,game,env):
    notd.adapter.write(root,notd.ACTIVE_INI,b'pinned')
   with patch.object(notd,'original_install',installer),patch.object(notd.adapter,'write') as publish:
    notd.install(root,'night',{})
   publish.assert_called_once_with(root,notd.ACTIVE_INI,source)
   self.assertEqual((root/'ServerSettings.ini').read_bytes(),source)
 def test_invalid_seed_refuses_without_writes(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=root/'ServerSettings.ini';source.mkdir()
   with self.assertRaises(ValueError):notd.ini_plan(root,notd.ACTIVE_INI,{})
   self.assertFalse((root/'LF').exists())
   source.rmdir();source.write_bytes(b'\xff')
   with self.assertRaises(UnicodeError):notd.ini_plan(root,notd.ACTIVE_INI,{})
   self.assertEqual(source.read_bytes(),b'\xff')
   self.assertFalse((root/'LF').exists())
 def test_preserves_unknown_arrays_comments_and_bom(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);target=root/'test.ini'
   before=b'\xef\xbb\xbf[ServerSettings] ; keep header\r\nServerName=old // operator note\r\n+Mods=one\r\n+Mods=two\r\nUnknown=(X=1,Y=2)\r\n'
   target.write_bytes(before)
   _,after=notd.ini_plan(root,'test.ini',{'ServerSettings':{'ServerName':'new'}})
   self.assertEqual(after,before.replace(b'=old',b'=new'))
   self.assertEqual(target.read_bytes(),before)
 def test_ambiguous_keys_and_sections_refused(self):
  for source in ['[ServerSettings]\nServerName=a\nservername=b\n','[ServerSettings]\n[serversettings]\n']:
   with self.assertRaises(ValueError):notd.ini.patch(source,{'ServerSettings':{'ServerName':'new'}})
 def test_invalid_settings_and_consent_never_acquire_or_write(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   valid={'VOLTRA_ALLOCATED_PORTS':'7777,27016','ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINEPATH':str(root)}
   for changes in [{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'false'},{'SERVER_SAVEGAME':'../escape'},{'OTHER_ARGS':'-Port=1234'},{'SERVER_MOTD':'x\nPassword=oops'},{'QUERY_PORT':'7777'},{'WINETRICKS_RUN':'corefonts;evil'},{'AUTO_UPDATE':'bad'}]:
    with self.subTest(changes=changes),patch.object(notd.adapter,'install') as install,patch.object(notd.adapter,'write') as write:
     with self.assertRaises(ValueError):notd.execute('run',root,valid|changes)
     install.assert_not_called();write.assert_not_called()
   self.assertEqual(list(root.iterdir()),[])
 def test_valid_preflight_is_read_only(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   notd.preflight(root,{'VOLTRA_ALLOCATED_PORTS':'7777,27016','ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINEPATH':str(root)})
   self.assertEqual(list(root.iterdir()),[])

if __name__=='__main__':unittest.main()
