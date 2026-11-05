"""Offline tests only. No subprocess, network, game or panel startup."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest

BASE = Path('internal/panel/game_library/scripts')
sys.modules['ddrace_legacy'] = types.SimpleNamespace(install=None, migrate_legacy_data=None)
sys.modules['ddrace_console'] = types.SimpleNamespace(run=None)
sys.modules['ddnet_install'] = types.SimpleNamespace(install=None)

def load(name, file):
    module = types.ModuleType(name)
    exec(compile((BASE / file).read_text(), file, 'exec'), module.__dict__)
    sys.modules[name] = module
    return module

load('ddnet_runtime', 'ddnet-runtime.py')
wrapper = load('ddrace_parity', 'ddrace-parity.py')

class ConfigurationTests(unittest.TestCase):
    def test_seed_once_and_no_environment_override(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = dict(SERVER_PORT='8303', SERVER_NAME='literal "; shutdown; \\ name', SERVER_PASSWORD='secret', SERVER_MAP='Tutorial')
            path = wrapper.configuration(root, env)
            original = path.read_bytes()
            self.assertIn(b'\\"; shutdown;', original)
            path.write_bytes(original + b'unknown_operator_value "keep"\n')
            expected = path.read_bytes()
            argv = wrapper.arguments(root, dict(env, SERVER_NAME='replacement', SERVER_MAP='missing'))
            self.assertEqual(path.read_bytes(), expected)
            self.assertEqual(argv[1:3], ['-f', 'autoexec_server.cfg'])
            self.assertFalse(any(s.startswith(('sv_map ', 'password ', 'sv_name ', 'sv_register ')) for s in argv))

    def test_existing_data_config_is_authoritative(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'ddnet/data/autoexec_server.cfg'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'# unknown\nexec operator.cfg\nsv_rcon_password "private"\n')
            before = path.read_bytes()
            self.assertEqual(wrapper.configuration(root, {}), path)
            self.assertEqual(path.read_bytes(), before)

    def test_bad_seed_rejected_before_file_creation(self):
        for env in ({'SERVER_NAME':'bad\nshutdown'}, {'SERVER_MAP':'../escape'}, {'SERVER_REGISTER':'1; shutdown'}, {'MAX_PLAYERS':'129'}):
            with self.subTest(env=env), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with self.assertRaises(ValueError):
                    wrapper.configuration(root, env)
                self.assertFalse((root/'ddnet/autoexec_server.cfg').exists())

    def test_fragment_preserves_original_controls(self):
        catalog = json.loads(Path('internal/panel/game_library/upstream/catalog.json').read_text())
        key = 'ddracenetwork/egg-d-d-race-network.json'
        original = next(e for e in catalog['entries'] if e['path'] == key)
        fragment = json.loads(Path('artifacts/game-parity-20261029/ddnet-profile.json').read_text())
        self.assertEqual(list(fragment), [key])
        profile = fragment[key]
        self.assertEqual(profile['egg']['variables'][:len(original['egg']['variables'])], original['egg']['variables'])
        self.assertEqual(profile['upstream_sha256'], original['sha256'])
        self.assertEqual(profile['verification'], 'not_verified')
        self.assertEqual(profile['egg']['config']['files'], '{}')

if __name__ == '__main__':
    unittest.main()
