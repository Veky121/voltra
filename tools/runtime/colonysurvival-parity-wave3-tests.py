"""Offline Colony settings evidence; no Steam, game or network execution."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
spec = importlib.util.spec_from_file_location('colony_wave3_runtime', BASE / 'steam-native-next.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
ENV = {'SERVER_PORT': '29162', 'SERVER_STEAMPORT': '29163', 'VOLTRA_ALLOCATED_PORTS': '29162,29163',
       'WORLD_NAME': 'operator-world', 'SERVER_NAME': 'operator-name', 'MAX_PLAYERS': '12'}


class ColonyNativeSettings(unittest.TestCase):
    def test_both_world_modes_retain_native_settings_and_large_unknown_values(self):
        for mode in ['NewOptions', 'LoadOptions']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / 'server.config.json'
                config = {mode: {'WorldName': 'previous', 'Seed': 'operator-seed', 'EnabledMods': ['mod-a'], 'Unknown': 9007199254740993},
                          'ServerSettings': {'ServerListPublicly': False, 'RCONPassword': 'private-fixture', 'ServerPassword': 'other-fixture'},
                          'Unknown': {'Enabled': True}}
                target.write_text(json.dumps(config))
                argv, secrets = runtime.configure(root, 'colony', ENV)
                actual = json.loads(target.read_text())
                self.assertEqual(set(actual) & {'NewOptions', 'LoadOptions'}, {mode})
                for key in ['Seed', 'EnabledMods', 'Unknown']:
                    self.assertEqual(actual[mode][key], config[mode][key])
                self.assertEqual(actual['Unknown'], config['Unknown'])
                self.assertFalse(actual['ServerSettings']['ServerListPublicly'])
                self.assertEqual(actual['ServerSettings']['RCONPassword'], 'private-fixture')
                self.assertIn('private-fixture', secrets)
                self.assertNotIn('private-fixture', argv)
                first = target.read_bytes()
                runtime.configure(root, 'colony', ENV)
                self.assertEqual(target.read_bytes(), first)

    def test_runtime_owned_world_identity_server_identity_capacity_and_network_are_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / 'server.config.json'
            target.write_text(json.dumps({'LoadOptions': {'WorldName': 'edited'}, 'ServerSettings': {
                'ServerName': 'edited', 'MaxPlayerCount': 4, 'ServerGamePort': 1234, 'ServerIP': '127.0.0.2'}}))
            runtime.configure(root, 'colony', ENV)
            actual = json.loads(target.read_text())
            self.assertEqual(actual['LoadOptions']['WorldName'], ENV['WORLD_NAME'])
            self.assertEqual(actual['ServerSettings'], {'ServerName': 'operator-name', 'MaxPlayerCount': 12,
                                                       'ServerGamePort': 29162, 'ServerIP': '0.0.0.0'})

    def test_invalid_world_mode_or_missing_distinct_port_refuses_without_disk_changes(self):
        for content, env in [('{"NewOptions":{},"LoadOptions":{},"ServerSettings":{}}', ENV),
                             ('{"NewOptions":{},"ServerSettings":{}}', {**ENV, 'SERVER_STEAMPORT': '29162'}),
                             ('{"NewOptions":{},"ServerSettings":{},"ServerSettings":{}}', ENV)]:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                target = root / 'server.config.json'
                target.write_text(content)
                before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                with self.assertRaises(ValueError):
                    runtime.configure(root, 'colony', env)
                self.assertEqual(before, {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
