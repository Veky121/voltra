"""Offline refusal/preservation tests, never native acceptance."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('enhanced', 'internal/panel/game_library/scripts/conan-enhanced.py')
enhanced = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enhanced)
ENV = {'SERVER_PORT': '29100', 'VOLTRA_ALLOCATED_PORTS': '29100,29101,29102,29103'}


class EnhancedTests(unittest.TestCase):
    def test_depot_refusal_before_acquisition_or_write(self):
        for extra in ({'SRCDS_BETAID': 'conan-exiles-legacy'}, {'WINDOWS_INSTALL': '1'},
                      {'SRCDS_APPID': '440900'}, {'INSTALL_FLAGS': 'arbitrary'},
                      {'STEAM_USER': 'private-user'}):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with patch.object(enhanced.shared.steam, 'update', side_effect=AssertionError('acquisition')):
                    with self.assertRaises(ValueError):
                        enhanced.preflight(root, ENV | extra)
                self.assertEqual(list(root.iterdir()), [])

    def test_linux_paths_and_no_legacy_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = enhanced.preflight(Path(directory), ENV)
            self.assertIn('/Binaries/Linux/', str(plan['binary']).replace('\\', '/'))
            self.assertTrue(all('/LinuxServer/' in name for name in plan['configs']))
            self.assertFalse(any('wine' in arg.lower() for arg in plan['args']))

    def test_alias_refusal_preserves_all_documents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'ConanSandbox/Saved/Config/LinuxServer'
            folder.mkdir(parents=True)
            engine = folder / 'Engine.ini'
            game = folder / 'Game.ini'
            engine.write_bytes(b'; operator\r\n[Unknown]\r\nList=a\r\nList=b\r\n')
            game.write_bytes(b'[RconPlugin]\r\nRconPort=1\r\nrconport=2\r\n')
            before = {p: p.read_bytes() for p in folder.iterdir()}
            with self.assertRaises(ValueError):
                enhanced.preflight(root, ENV)
            self.assertEqual(before, {p: p.read_bytes() for p in folder.iterdir()})

    def test_case_insensitive_writer_preserves_unknown_rows(self):
        before = '; operator\r\n[serversettings]\r\nadminpassword=old\r\n[Mod]\r\nList=a\r\nList=b\r\n'
        after = enhanced.enhanced_ini(before, {'ServerSettings': {'AdminPassword': 'new'}})
        self.assertRegex(after, r'adminpassword=\s*new')
        self.assertIn('[Mod]\r\nList=a\r\nList=b\r\n', after)
        self.assertIn('; operator\r\n', after)

    def test_actual_writer_retains_bom_crlf_and_world_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'ConanSandbox/Saved/Config/LinuxServer'
            folder.mkdir(parents=True)
            target = folder / 'ServerSettings.ini'
            unknown = b'; operator\r\n[Mod]\r\nList=a\r\nList=b\r\n'
            target.write_bytes(b'\xef\xbb\xbf' + unknown)
            world = root / 'ConanSandbox/Saved/game_0.db'
            world.write_bytes(b'opaque-world\x00\xff')
            enhanced.configure(root, 'enhanced', ENV)
            self.assertTrue(target.read_bytes().startswith(b'\xef\xbb\xbf' + unknown))
            self.assertEqual(world.read_bytes(), b'opaque-world\x00\xff')
            backups = list((root / '.voltra/conan-empires/config-backups').iterdir())
            self.assertTrue(any(p.read_bytes() == b'\xef\xbb\xbf' + unknown for p in backups))


if __name__ == '__main__':
    unittest.main()
