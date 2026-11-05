"""Offline source-path reconciliation and shared INI preservation, not game acceptance."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('conan_wave3_shared', Path('internal/panel/game_library/scripts/conan-empires.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


class ConanNativeDocuments(unittest.TestCase):
    def test_declared_documents_match_both_actual_configure_plans(self):
        profiles = json.loads(Path('artifacts/game-parity-20261029/conan-wave3-profile.json').read_text())
        for recipe, game in [('conan_exiles/egg-conan-exiles.json', 'conan'),
                             ('conan_exiles/egg-conan-exiles-enhanced.json', 'enhanced')]:
            with self.subTest(game=game), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                plan = shared.configure_plan(root, game, {'SERVER_PORT': '29100',
                    'VOLTRA_ALLOCATED_PORTS': '29100,29101,29102,29103'})
                self.assertEqual(set(profiles[recipe]['settings_documents']), {'/' + name for name in plan['configs']})
                self.assertFalse(any(root.iterdir()), 'Planning unexpectedly mutated root')

    def test_unrelated_ini_edit_retains_unknown_gameplay_mod_rows(self):
        before = ('; operator comment\r\n[ServerSettings]\r\nNPCRespawnMultiplier=2.5\r\n'
                  'CustomModFlag=KeepThis\r\n[UnknownSection]\r\nList=one\r\nList=two\r\n')
        after = shared.native.patch_ini(before, {'ServerSettings': {'NPCRespawnMultiplier': '3.5'}}, case_insensitive=True)
        self.assertIn('; operator comment\r\n', after)
        self.assertIn('CustomModFlag=KeepThis\r\n', after)
        self.assertIn('[UnknownSection]\r\nList=one\r\nList=two\r\n', after)
        self.assertRegex(after, r'NPCRespawnMultiplier\s*=\s*3\.5\r\n')

    def test_native_case_aliases_fail_closed_with_opt_in_writer(self):
        with self.assertRaises(ValueError):
            shared.native.patch_ini('[ServerSettings]\nAdminPassword=one\nadminpassword=two\n',
                {'ServerSettings': {'AdminPassword': 'replacement'}}, case_insensitive=True)


if __name__ == '__main__':
    unittest.main()
