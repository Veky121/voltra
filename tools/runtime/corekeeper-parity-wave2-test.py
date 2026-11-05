import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('bridge', Path(__file__).with_name('corekeeper-parity-wave2.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
steam = types.ModuleType('steam_template')
steam.Redactor = object
steam.update = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('No acquisition allowed'))
sys.modules['steam_template'] = steam
spec = importlib.util.spec_from_file_location('native', ROOT / 'internal/panel/game_library/scripts/core-keeper-runtime.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'CoreKeeperServer').write_bytes(b'fixture only')
        self.env = {'SERVER_PORT': '29100', 'VOLTRA_ALLOCATED_PORTS': '29100,29101', 'WORLD_NAME': 'Creation default',
                    'MAX_PLAYERS': '100', 'GAME_ID': 'Abcdefghijk12345', 'SERVER_PASSWORD': 'fixture-password'}
        self.file = self.root / bridge.DOCUMENT
        self.file.parent.mkdir()

    def write(self, value):
        self.file.write_text(json.dumps(value), encoding='utf-8')

    def test_missing_file_retains_creation_settings_without_writes(self):
        self.assertEqual(bridge.effective_environment(self.root, self.env), self.env)
        self.assertFalse(self.file.exists())

    def test_native_values_reach_original_runtime_and_preserve_bytes(self):
        self.write({'world': 3, 'worldName': 'Operator $name', 'worldSeed': 0, 'hashedWorldSeed': 123,
                    'maxNumberPlayers': 6, 'worldMode': 1, 'gameId': 'Abcdefghijk12346', 'password': 'operator-password',
                    'networkSendRate': 42, 'unknown': {'keep': [1, 2]}})
        original = self.file.read_bytes()
        for _ in range(2):
            argv, _, secrets = native.configure(self.root, bridge.effective_environment(self.root, self.env))
            for flag, value in [('-world', '3'), ('-worldname', 'Operator $name'), ('-hashedworldseed', '123'),
                                ('-maxplayers', '6'), ('-worldmode', 'Hard'), ('-password', 'operator-password')]:
                self.assertEqual(argv[argv.index(flag) + 1], value)
            self.assertIn('operator-password', secrets)
            self.assertEqual(self.file.read_bytes(), original)

    def test_invalid_shape_duplicates_nonfinite_and_scalar_types_reject_without_writes(self):
        for content in ['[]', '{"world":1,"world":2}', '{"unknown":NaN}', '{"world":true}',
                        '{"maxNumberPlayers":101}', '{"worldMode":false}', '{"worldName":"bad\\nname"}']:
            self.file.write_text(content, encoding='utf-8')
            before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
            with self.assertRaises(ValueError):
                bridge.effective_environment(self.root, self.env)
            self.assertEqual(before, {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_listener_allocation_remains_runtime_owned(self):
        self.write({'port': 1234, 'ip': '127.0.0.1', 'maxNumberPlayers': 8})
        argv, _, _ = native.configure(self.root, bridge.effective_environment(self.root, self.env))
        self.assertEqual(argv[argv.index('-port') + 1], '29100')
        self.assertEqual(argv[argv.index('-ip') + 1], '0.0.0.0')

    def test_conflicting_seeds_refused_by_original_runtime(self):
        self.write({'worldSeed': 100, 'hashedWorldSeed': 200})
        with self.assertRaises(ValueError):
            native.configure(self.root, bridge.effective_environment(self.root, self.env))
        self.assertFalse((self.root / '.voltra').exists())

    def test_symlink_refused_if_platform_supports_it(self):
        target = self.root / 'outside.json'
        target.write_text('{}')
        try:
            self.file.symlink_to(target)
        except OSError as error:
            self.skipTest('Host cannot create fixture symlink: ' + type(error).__name__)
        with self.assertRaises(ValueError):
            bridge.effective_environment(self.root, self.env)


if __name__ == '__main__':
    unittest.main()
