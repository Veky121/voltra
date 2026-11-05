import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('kissmp_wave2', Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/kissmp-controls.py')
kiss = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kiss)


class KissMPAuthority(unittest.TestCase):
    def test_complete_native_config_boot_preserves_operator_bytes_precision_and_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'config.json'
            data = {'server_name':'operator', 'description':'description', 'map':'map',
                    'max_players':8, 'tickrate':60, 'max_vehicles_per_client':3,
                    'show_in_server_list':False, 'upnp_enabled':False,
                    'require_scripts':False, 'port':29101, 'server_identifier':'keep', 'mods':None}
            racing = kiss.load_racing()
            for ending in ('', '\n', '\r\n'):
                text = json.dumps(data, indent=4)[:-1] + ', "unknown": {"precise": 0.123456789012345678901234567890}}' + ending
                file.write_bytes(text.encode())
                file.chmod(0o640)
                before, info = file.read_bytes(), file.stat()
                with patch.object(racing, 'configure', side_effect=AssertionError('No native write needed')):
                    self.assertEqual(kiss.configure(root, {'SERVER_PORT':'29101', 'SERVER_NAME':'ignored'}, racing), file)
                self.assertEqual(file.read_bytes(), before)
                self.assertEqual(file.stat().st_mtime_ns, info.st_mtime_ns)
                self.assertEqual(file.stat().st_mode, info.st_mode)
                self.assertEqual(sorted(p.name for p in root.iterdir()), ['config.json'])

    def test_bom_config_refuses_without_normalizing_or_creating_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'config.json'
            before = b'\xef\xbb\xbf{"server_name":"operator"}'
            file.write_bytes(before)
            with patch.object(kiss, 'load_racing') as load:
                with self.assertRaises(ValueError):
                    kiss.configure(root, {'SERVER_PORT':'29101'})
                load.assert_not_called()
            self.assertEqual(file.read_bytes(), before)
            self.assertEqual([p.name for p in root.iterdir()], ['config.json'])

    def test_nonempty_startup_cannot_replace_native_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'config.json'
            file.write_text(json.dumps({'server_name': 'operator', 'max_players': 23,
                'show_in_server_list': False, 'server_identifier': 'keep',
                'mods': ['operator.zip'], 'unknown': {'kept': True}}))
            racing = kiss.load_racing()
            # Windows lacks chown. Exercise the real shared configure algorithm,
            # replacing only the POSIX metadata publication helper.
            with patch.object(racing, 'write', side_effect=lambda p, data: p.write_text(data)):
                kiss.configure(root, {'SERVER_PORT': '29101', 'SERVER_NAME': 'startup',
                    'MAX_PLAYERS': '8', 'PUBLIC_SERVER': 'true'}, racing)
                data = json.loads(file.read_text())
                self.assertEqual(data['server_name'], 'operator')
                self.assertEqual(data['max_players'], 23)
                self.assertFalse(data['show_in_server_list'])
                self.assertEqual(data['server_identifier'], 'keep')
                self.assertEqual(data['port'], 29101)
                self.assertEqual(data['unknown'], {'kept': True})
                self.assertEqual(data['mods'], ['operator.zip'])
                data['server_name'] = 'second native edit'
                file.write_text(json.dumps(data))
                kiss.configure(root, {'SERVER_PORT': '29102', 'SERVER_NAME': 'startup'}, racing)
                self.assertEqual(json.loads(file.read_text())['server_name'], 'second native edit')

    def test_missing_fields_keep_creation_values(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {'SERVER_NAME': 'seed', 'MAX_PLAYERS': '17'}
            self.assertEqual(kiss.native_environment(Path(directory), env), env)

    def test_bad_native_document_refuses_before_shared_call(self):
        bad = ['[]', '{"max_players":true}', '{"max_players":256}',
               '{"server_name":"bad\\nname"}', '{"server_identifier":null}',
               '{"server_name":"one","server_name":"two"}',
               '{"unknown":{"x":1,"x":2}}', '{"unknown":NaN}']
        for text in bad:
            with self.subTest(text=text), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                file = root / 'config.json'
                file.write_text(text)
                before = file.read_bytes()
                with patch.object(kiss, 'load_racing') as load:
                    with self.assertRaises(ValueError):
                        kiss.configure(root, {})
                    load.assert_not_called()
                self.assertEqual(file.read_bytes(), before)
                self.assertEqual([p.name for p in root.iterdir()], ['config.json'])

    def test_directory_refuses_before_shared_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'config.json').mkdir()
            with self.assertRaises(ValueError):
                kiss.native_environment(root, {})


if __name__ == '__main__':
    unittest.main()
