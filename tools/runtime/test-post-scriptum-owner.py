import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
for name in ('steam_template','source_install','source_next_install','native_console','tactical_install','post_scriptum_owner_runtime'):
    path = SCRIPTS / (name.replace('_','-') + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
r = sys.modules['post_scriptum_owner_runtime']

class Preservation(unittest.TestCase):
    def test_existing_duplicate_unknown_bom_and_crlf(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve(); file = root / 'Server.cfg'
            original = b'\xef\xbb\xbf// operator\r\nServerName=one\r\nservername=two\r\nUnknown=x\r\nUnknown=y'
            file.write_bytes(original)
            before, planned = r.seed_plan(root, 'Server.cfg', {'ServerName':'default','MaxPlayers':'80'})
            self.assertEqual(planned, original+b'\r\nMaxPlayers=80\r\n')
            self.assertEqual(file.read_bytes(), original)
            file.write_bytes(planned)
            self.assertEqual(r.seed_plan(root,'Server.cfg',{'ServerName':'other','MaxPlayers':'10'}), (planned,planned))
    def test_invalid_utf8_refuses_without_write(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve(); file=root/'Server.cfg'; file.write_bytes(b'\xff')
            with self.assertRaises(UnicodeDecodeError): r.flat_config(root,'Server.cfg',{'MaxPlayers':'80'})
            self.assertEqual(file.read_bytes(),b'\xff')
    def test_preflight_does_not_create(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve()
            r.flat_config(root,'Server.cfg',{'MaxPlayers':'80'},publish=False)
            self.assertEqual(list(root.iterdir()),[])
    def test_bad_runtime_refuses_before_update(self):
        env={'VOLTRA_TACTICAL':'postscriptum','AUTO_UPDATE':'1'}
        with patch.object(sys.modules['steam_template'],'arguments'), patch.object(r,'configure',side_effect=ValueError('bad runtime')), patch.object(r,'install') as install:
            with self.assertRaises(ValueError): r.main(Path('.'),env)
            install.assert_not_called()
    def test_private_credentials_refuse_before_preflight(self):
        env={'VOLTRA_TACTICAL':'postscriptum','STEAM_USER':'private','STEAM_PASS':'not-a-real-secret','AUTO_UPDATE':'1'}
        with patch.object(r,'configure') as config, patch.object(r,'install') as install:
            with self.assertRaises(ValueError): r.main(Path('.'),env)
            config.assert_not_called(); install.assert_not_called()
    def test_other_recipe_refused(self):
        with self.assertRaises(ValueError): r.main(Path('.'),{'VOLTRA_TACTICAL':'squad'})

if __name__ == '__main__': unittest.main()
