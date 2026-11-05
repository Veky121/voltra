"""Offline refusal/preservation tests, never native acceptance."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('legacy', 'internal/panel/game_library/scripts/conan-legacy.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
ENV = {'SERVER_PORT': '29100', 'VOLTRA_ALLOCATED_PORTS': '29100,29101,29102,29103', 'SRCDS_BETAID': 'conan-exiles-legacy'}


class LegacyTests(unittest.TestCase):
    def test_depot_refusal_before_acquisition_or_write(self):
        for extra in ({'SRCDS_BETAID': ''}, {'SRCDS_BETAID': 'public'}, {'WINDOWS_INSTALL': '0'},
                      {'SRCDS_APPID': '440900'}, {'INSTALL_FLAGS': 'arbitrary'},
                      {'STEAM_USER': 'private-user'}):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with patch.object(legacy.shared.steam, 'update', side_effect=AssertionError('acquisition')):
                    with self.assertRaises(ValueError):
                        legacy.preflight(root, ENV | extra)
                self.assertEqual(list(root.iterdir()), [])

    def test_windows_paths_and_no_wine_flags_in_native_argv(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = legacy.preflight(Path(directory), ENV)
            self.assertIn('/Binaries/Win64/', str(plan['binary']).replace('\\', '/'))
            self.assertTrue(all('/WindowsServer/' in name for name in plan['configs']))
            self.assertFalse(any('wine' in arg.lower() for arg in plan['args']))

    def test_alias_refusal_preserves_all_documents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'ConanSandbox/Saved/Config/WindowsServer'
            folder.mkdir(parents=True)
            engine = folder / 'Engine.ini'
            game = folder / 'Game.ini'
            engine.write_bytes(b'; operator\r\n[Unknown]\r\nList=a\r\nList=b\r\n')
            game.write_bytes(b'[RconPlugin]\r\nRconPort=1\r\nrconport=2\r\n')
            before = {p: p.read_bytes() for p in folder.iterdir()}
            with self.assertRaises(ValueError):
                legacy.preflight(root, ENV)
            self.assertEqual(before, {p: p.read_bytes() for p in folder.iterdir()})

    def test_case_insensitive_writer_preserves_unknown_rows(self):
        before = '; operator\r\n[serversettings]\r\nadminpassword=old\r\n[Mod]\r\nList=a\r\nList=b\r\n'
        after = legacy.legacy_ini(before, {'ServerSettings': {'AdminPassword': 'new'}})
        self.assertRegex(after, r'adminpassword=\s*new')
        self.assertIn('[Mod]\r\nList=a\r\nList=b\r\n', after)
        self.assertIn('; operator\r\n', after)

    def test_actual_writer_retains_bom_crlf_and_world_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'ConanSandbox/Saved/Config/WindowsServer'
            folder.mkdir(parents=True)
            target = folder / 'ServerSettings.ini'
            unknown = b'; operator\r\n[Mod]\r\nList=a\r\nList=b\r\n'
            target.write_bytes(b'\xef\xbb\xbf' + unknown)
            world = root / 'ConanSandbox/Saved/game.db'
            world.write_bytes(b'opaque-world\x00\xff')
            legacy.configure(root, 'conan', ENV)
            self.assertTrue(target.read_bytes().startswith(b'\xef\xbb\xbf' + unknown))
            self.assertEqual(world.read_bytes(), b'opaque-world\x00\xff')
            backups = list((root / '.voltra/conan-empires/config-backups').iterdir())
            self.assertTrue(any(p.read_bytes() == b'\xef\xbb\xbf' + unknown for p in backups))

    def test_configure_refusal_does_not_publish_earlier_valid_documents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'ConanSandbox/Saved/Config/WindowsServer'
            folder.mkdir(parents=True)
            (folder / 'Game.ini').write_bytes(b'[RconPlugin]\nRconPort=1\nrconport=2\n')
            before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            with self.assertRaises(ValueError):
                legacy.configure(root, 'conan', ENV)
            self.assertEqual(before, {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()})
            self.assertFalse((root / '.voltra').exists())

    def test_update_success_and_failure_restore_ini_and_leave_world_mods(self):
        for fails in (False, True):
            with self.subTest(fails=fails), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                ini = root / 'ConanSandbox/Saved/Config/WindowsServer/Engine.ini'
                ini.parent.mkdir(parents=True)
                ini.write_bytes(b'; operator\r\n[Unknown]\r\n+Array=a\r\n+Array=b\r\n')
                world = root / 'ConanSandbox/Saved/game.db'
                world.write_bytes(b'opaque-world\x00')
                mod = root / 'ConanSandbox/Mods/operator.pak'
                mod.parent.mkdir(); mod.write_bytes(b'opaque-mod')
                before = ini.read_bytes(), ini.stat().st_mtime_ns, world.read_bytes(), mod.read_bytes()
                def update(*args, **kwargs):
                    self.assertEqual(args[1], 443030)
                    self.assertEqual(args[2]['SRCDS_BETAID'], 'conan-exiles-legacy')
                    self.assertEqual(kwargs['platform'], 'windows')
                    ini.write_bytes(b'depot default')
                    if fails:
                        raise ValueError('observed Steam failure fixture')
                with patch.object(legacy.shared.steam, 'update', side_effect=update):
                    if fails:
                        with self.assertRaises(ValueError):
                            legacy.shared.install(root, 'conan', ENV)
                    else:
                        legacy.shared.install(root, 'conan', ENV)
                self.assertEqual(before, (ini.read_bytes(), ini.stat().st_mtime_ns, world.read_bytes(), mod.read_bytes()))
                self.assertFalse(list(root.glob('voltra-conan-retention-*')))

    def test_unknown_arrays_in_managed_section_survive(self):
        before = '[serversettings]\r\nadminpassword=old\r\n+ModArray=a\r\n+ModArray=b\r\n-ModArray=c\r\n'
        after = legacy.legacy_ini(before, {'ServerSettings': {'AdminPassword': 'new'}})
        self.assertIn('+ModArray=a\r\n+ModArray=b\r\n-ModArray=c\r\n', after)


if __name__ == '__main__':
    unittest.main()
