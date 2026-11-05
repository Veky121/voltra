"""Offline INI preservation regressions, no payload or native process."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('native_config_bom', ROOT / 'internal/panel/game_library/scripts/native-config.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class BOM(unittest.TestCase):
    def test_first_section_is_updated_without_duplicate(self):
        before = '\ufeff[ServerSettings]\r\nName=old\r\n; operator\r\nArray=a\r\nArray=b\r\n'
        after = native.patch_ini(before, {'ServerSettings': {'Name': 'new'}})
        self.assertEqual(after, before.replace('Name=old', 'Name= new'))

    def test_casefold_resolution_sees_first_section(self):
        before = '\ufeff[serversettings]\n  name=old\nOther=retain\n'
        after = native.patch_ini(before, {'ServerSettings': {'Name': 'new'}}, case_insensitive=True)
        self.assertEqual(after, before.replace('name=old', 'name= new'))

    def test_duplicate_after_bom_refuses_without_writes(self):
        before = b'\xef\xbb\xbf[ServerSettings]\r\nName=first\r\n[serversettings]\r\nName=last\r\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'server.ini'
            file.write_bytes(before)
            with self.assertRaises(ValueError):
                native.configure_ini(root, file, {'ServerSettings': {'Name': 'new'}}, root / 'backups', case_insensitive=True)
            self.assertEqual(file.read_bytes(), before)
            self.assertFalse((root / 'backups').exists())

    def test_changed_file_and_backup_keep_original_bom_bytes(self):
        before = b'\xef\xbb\xbf[ServerSettings]\r\nName=old\r\n; retained\r\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'server.ini'
            file.write_bytes(before)
            native.configure_ini(root, file, {'ServerSettings': {'Name': 'new'}}, root / 'backups')
            self.assertEqual(file.read_bytes(), before.replace(b'Name=old', b'Name= new'))
            backups = list((root / 'backups').iterdir())
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
