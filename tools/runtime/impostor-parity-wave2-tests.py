"""Offline source evidence only. Does not install or execute the server."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
spec = importlib.util.spec_from_file_location('impostor_wave2_runtime', BASE / 'among-us-runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class ImpostorNativeSettings(unittest.TestCase):
    def test_operator_controls_and_unknown_nested_values_survive_repeated_start_config(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / 'impostor/config.json'
            config.parent.mkdir()
            native = {'AntiCheat': {'Enabled': False, 'BanIpFromGame': False},
                      'Compatibility': {'AllowVersionMixing': True},
                      'HttpServer': {'Enabled': False},
                      'UnknownPlugin': {'Token': 'private-fixture', 'LargeNumber': 9007199254740993}}
            config.write_text(json.dumps(native))
            env = {'SERVER_PORT': '29142', 'PUBLIC_IP': 'node.example', 'PUBLIC_PORT': '29143'}
            runtime.configure_impostor(root, env)
            first = config.read_bytes()
            runtime.configure_impostor(root, env)
            self.assertEqual(config.read_bytes(), first)
            actual = json.loads(first)
            for key in ['AntiCheat', 'Compatibility', 'UnknownPlugin']:
                self.assertEqual(actual[key], native[key])
            self.assertFalse(actual['HttpServer']['Enabled'])

    def test_listener_values_are_runtime_owned_even_when_operator_edits_them(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / 'impostor/config.json'
            config.parent.mkdir()
            config.write_text(json.dumps({'Server': {'ListenIp': '127.0.0.2', 'ListenPort': 1234},
                                         'HttpServer': {'ListenIp': '127.0.0.3', 'ListenPort': 1235}}))
            actual = runtime.configure_impostor(root, {'SERVER_PORT': '29142', 'PUBLIC_IP': 'node.example'})
            for section in ['Server', 'HttpServer']:
                self.assertEqual(actual[section]['ListenIp'], '0.0.0.0')
                self.assertEqual(actual[section]['ListenPort'], 29142)

    def test_invalid_external_port_refuses_without_disk_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / 'impostor/config.json'
            config.parent.mkdir()
            config.write_text('{"Operator":true}\n')
            before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            with self.assertRaises(ValueError):
                runtime.configure_impostor(root, {'SERVER_PORT': '29142', 'PUBLIC_PORT': '70000'})
            self.assertEqual(before, {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
