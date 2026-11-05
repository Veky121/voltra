"""Offline real config-file round trips, never native acceptance."""
import importlib.util
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('controls', 'internal/panel/game_library/scripts/reforger-controls.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class ReforgerTests(unittest.TestCase):
    def env(self):
        return {'SERVER_PORT':'28000', 'VOLTRA_ALLOCATED_PORTS':'28000,28001,28002', 'SERVER_NAME':'Seed'}

    def test_actual_config_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(c.arma, 'agreement'), patch.object(c.arma, 'reforger_config', c.configuration):
            root = Path(directory)
            c.configure(root, 'reforger', self.env())
            path = root / 'config.json'
            saved = json.loads(path.read_text())
            self.assertEqual(saved['game']['name'], 'Seed')
            saved['game'].update(name='Operator true $', visible=False, password='literal')
            saved['game']['gameProperties']['fastValidation'] = False
            saved['game']['mods'] = [{'modId':'fixture'}]
            saved['operating'] = {'playerSaveTime':51}
            path.write_text(json.dumps(saved))
            args, clients = c.configure(root, 'reforger', self.env())
            self.assertEqual(json.loads(path.read_text()), saved)
            self.assertIn('./profile', args)
            self.assertEqual(clients, [])

    def test_listener_and_type_rejection(self):
        for previous in [{'a2s':{'port':29000}}, {'rcon':{'port':28000}}, {'game':{'visible':'false'}}, {'game':{'maxPlayers':True}}]:
            with self.subTest(previous=previous), self.assertRaises(ValueError):
                c.configuration(previous,self.env())

    def test_allocation_owned_and_no_input_mutation(self):
        original = {'bindPort':5,'publicPort':5,'unknown':{'keep':True}}
        result = c.configuration(original,self.env())
        self.assertEqual(result['bindPort'],28000)
        self.assertEqual(original['bindPort'],5)
        self.assertEqual(result['unknown'],original['unknown'])

    def test_invalid_launch_arguments_preserve_original_bytes(self):
        for key in ('MAX_FPS', 'LOG_INTERVAL'):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory, patch.object(c.arma, 'agreement'):
                root = Path(directory)
                path = root / 'config.json'
                path.write_bytes(b'{ "operator": [1, 2] }\r\n')
                before = path.stat()
                with self.assertRaises(ValueError):
                    c.configure(root, 'reforger', dict(self.env(), **{key:'invalid'}))
                self.assertEqual(path.read_bytes(), b'{ "operator": [1, 2] }\r\n')
                self.assertEqual(path.stat().st_mtime_ns, before.st_mtime_ns)

    def test_duplicate_keys_refuse_without_write(self):
        for content in (b'{"game":{"name":"first","name":"second"}}', b'{"unknown":{"x":1,"x":2}}'):
            with tempfile.TemporaryDirectory() as directory, patch.object(c.arma, 'agreement'):
                root = Path(directory)
                path = root / 'config.json'
                path.write_bytes(content)
                with self.assertRaisesRegex(ValueError, 'Duplicate'):
                    c.configure(root, 'reforger', self.env())
                self.assertEqual(path.read_bytes(), content)

    def test_unchanged_native_bytes_and_metadata_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(c.arma, 'agreement'):
            root = Path(directory)
            data = c.configuration({}, self.env())
            data['game']['mods'] = [{'modId':'abc', 'unknown':{'keep':True}}]
            data['operating'] = {'custom': [1, False, 'literal']}
            path = root / 'config.json'
            original = b'\xef\xbb\xbf' + json.dumps(data, indent=4).replace('\n', '\r\n').encode() + b'\r\n'
            path.write_bytes(original)
            before = path.stat()
            c.configure(root, 'reforger', self.env())
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(path.stat().st_mtime_ns, before.st_mtime_ns)

    def test_auto_update_original_control_and_explicit_override(self):
        self.assertFalse(c.boolean({'AUTO_UPDATE':'0'}, 'VOLTRA_STEAM_AUTO_UPDATE', True))
        self.assertTrue(c.boolean({'AUTO_UPDATE':'1'}, 'VOLTRA_STEAM_AUTO_UPDATE', True))
        self.assertFalse(c.boolean({'AUTO_UPDATE':'1', 'VOLTRA_STEAM_AUTO_UPDATE':'0'}, 'VOLTRA_STEAM_AUTO_UPDATE', True))
        self.assertTrue(c.boolean({}, 'VOLTRA_STEAM_AUTO_UPDATE', True))

    def test_symlink_refusal_before_file_write(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(c.arma,'agreement'):
            root=Path(directory)
            outside=root/'outside';outside.write_text('{}')
            try: (root/'config.json').symlink_to(outside)
            except OSError: self.skipTest('Windows symlink privilege unavailable; Linux fixture still required')
            with self.assertRaises(ValueError): c.configure(root,'reforger',self.env())
            self.assertEqual(outside.read_text(),'{}')

if __name__ == '__main__': unittest.main()
