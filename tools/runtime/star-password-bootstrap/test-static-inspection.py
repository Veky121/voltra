"""MIT. Archive confinement regression fixtures, no binary execution."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('star_inspector', Path(__file__).with_name('inspect-experimental-loader.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveBoundary(unittest.TestCase):
    def test_windows_traversal(self):
        for name in ('../secret', '/root', 'C:/secret', 'C:\\secret', '\\\\host\\share', 'Mods/a:stream', 'Mods/evil. ', 'Mods/evil.'):
            with self.assertRaises(ValueError): module.safe_name(name, set())

    def test_case_alias_duplicate(self):
        seen = set()
        module.safe_name('ue4ss/Mods/main.lua', seen)
        with self.assertRaises(ValueError): module.safe_name('UE4SS\\mods\\MAIN.lua', seen)

    def test_normal_files(self):
        self.assertEqual(module.safe_name('ue4ss/UE4SS.dll', set()), 'ue4ss/UE4SS.dll')

    def test_invalid_pe(self):
        with self.assertRaises(ValueError): module.legacy.pe(b'invalid')


if __name__ == '__main__': unittest.main()
