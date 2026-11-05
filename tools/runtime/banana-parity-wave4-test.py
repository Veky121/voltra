"""Offline source fixtures. No Steam, native game or Docker execution."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


candidate = BASE / 'banana-native-authority.py'
wrapper = load('banana_wave4', candidate)
shared = wrapper.load_runtime()


class BananaAuthority(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()
        self.env = {'SERVER_PORT': '29130', 'VOLTRA_ALLOCATED_PORTS': '29130', 'SERVER': 'OperatorServer',
                    'SERVER_NAME': 'Stale setup', 'STEAM_GSLT': '', 'AUTO_UPDATE': '0'}
        self.target = self.root / 'Servers/OperatorServer/Config.json'
        self.target.parent.mkdir(parents=True)
        (self.root / 'BSDS.x86_64').write_bytes(b'fixture payload')
        self.original = b'{ "Server": {"Login_Token":"native-fixture-token","STEAM_GSLT":"native-fixture-token","Unknown":9007199254740993}, "Browser":{"Server_Name":"Native name"}, "Game":{"Rotation":["one","one"]}}\r\n'
        self.target.write_bytes(self.original)

    def invoke(self, env=None, installer=None):
        with patch.object(wrapper.Path, 'cwd', return_value=self.root), patch.dict(os.environ, env or self.env, clear=True):
            return wrapper.main(shared, installer or Mock())

    def test_baseline_overwrites_operator_identity_and_clears_token(self):
        shared.configure(self.root, 'banana', self.env)
        data = json.loads(self.target.read_text())
        self.assertEqual(data['Browser']['Server_Name'], 'Stale setup')
        self.assertEqual(data['Server']['Login_Token'], '')
        self.assertEqual(data['Server']['STEAM_GSLT'], '')

    def test_actual_shared_configure_twice_preserves_native_values_and_bytes(self):
        for _ in range(2):
            effective = wrapper.native_environment(shared, self.root, self.env, True)
            argv, _, stop, secrets, ready = shared.configure(self.root, 'banana', effective)
            self.assertEqual(stop, 'quit')
            self.assertEqual(ready, 'Connect to steam server successfully')
            self.assertEqual(secrets, ['native-fixture-token'])
            self.assertNotIn('native-fixture-token', ' '.join(argv))
            self.assertEqual(self.target.read_bytes(), self.original)

    def test_single_native_alias_seeds_other_without_losing_unknown_data(self):
        data = json.loads(self.original)
        del data['Server']['STEAM_GSLT']
        self.target.write_text(json.dumps(data))
        shared.configure(self.root, 'banana', wrapper.native_environment(shared, self.root, self.env))
        after = json.loads(self.target.read_text())
        self.assertEqual(after['Server']['STEAM_GSLT'], 'native-fixture-token')
        self.assertEqual(after['Server']['Unknown'], 9007199254740993)
        self.assertEqual(after['Game']['Rotation'], ['one', 'one'])

    def test_explicit_native_empty_token_remains_lan_only(self):
        self.target.write_text('{"Server":{"Login_Token":"","STEAM_GSLT":""}}')
        effective = wrapper.native_environment(shared, self.root, {**self.env, 'STEAM_GSLT': 'stale token'})
        self.assertEqual(effective['STEAM_GSLT'], '')

    def test_invalid_native_or_setup_refuses_before_update_and_publication(self):
        cases = [(b'{"Server":{"Login_Token":"a","STEAM_GSLT":"b"}}', {}),
                 (b'{"Server":{"Login_Token":"a","Login_Token":"a"}}', {}),
                 (b'{"Server":[]}', {}), (b'{"Browser":{"Server_Name":false}}', {}),
                 (b'{"server":{}}', {}), (b'{"Server":{"login_token":"ambiguous"}}', {}),
                 (b'{"Browser":{"server_name":"ambiguous"}}', {}),
                 (b'{"Game":{"value":NaN}}', {}), (self.original, {'SERVER': '../escape'}),
                 (self.original, {'SERVER_PORT': '29131'}), (self.original, {'SRCDS_APPID': '1'}),
                 (self.original, {'AUTO_UPDATE': 'yes'})]
        for content, change in cases:
            with self.subTest(change=change, content=content):
                self.target.write_bytes(content)
                before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
                installer = Mock()
                with patch.object(shared, 'configure') as configure, patch.object(shared, 'run') as run:
                    with self.assertRaises((ValueError, TypeError)):
                        self.invoke({**self.env, 'AUTO_UPDATE': '1', **change}, installer)
                installer.assert_not_called(); configure.assert_not_called(); run.assert_not_called()
                self.assertEqual(before, {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_missing_native_file_seeds_original_setup_values(self):
        self.target.unlink()
        effective = wrapper.native_environment(shared, self.root, {**self.env, 'STEAM_GSLT': 'seed-fixture'})
        shared.configure(self.root, 'banana', effective)
        data = json.loads(self.target.read_text())
        self.assertEqual(data['Browser']['Server_Name'], 'Stale setup')
        self.assertEqual(data['Server']['Login_Token'], 'seed-fixture')

    def test_missing_binary_no_update_refuses_before_writing(self):
        (self.root / 'BSDS.x86_64').unlink()
        with patch.object(shared, 'configure') as configure:
            with self.assertRaises(ValueError): self.invoke()
        configure.assert_not_called(); self.assertEqual(self.target.read_bytes(), self.original)

    def test_invalid_existing_binary_type_refuses_before_update(self):
        binary = self.root / 'BSDS.x86_64'
        binary.unlink(); binary.mkdir()
        installer = Mock()
        with self.assertRaises(ValueError): self.invoke({**self.env, 'AUTO_UPDATE': '1'}, installer)
        installer.assert_not_called(); self.assertEqual(self.target.read_bytes(), self.original)

    @unittest.skipIf(os.name == 'nt', 'Linux filesystem fixture')
    def test_symlinked_native_parent_is_rejected_without_outside_writes(self):
        outside = self.root / 'operator-outside'
        outside.mkdir()
        marker = outside / 'Config.json'; marker.write_bytes(self.original)
        for file in self.target.parent.iterdir(): file.unlink()
        self.target.parent.rmdir()
        self.target.parent.symlink_to(outside, target_is_directory=True)
        installer = Mock()
        with self.assertRaises(ValueError): self.invoke({**self.env, 'AUTO_UPDATE': '1'}, installer)
        installer.assert_not_called(); self.assertEqual(marker.read_bytes(), self.original)

    def test_update_repairs_missing_binary_and_reloads_native_values(self):
        (self.root / 'BSDS.x86_64').unlink()
        def install(root, game, effective, validate):
            self.assertEqual(game, 'banana'); self.assertFalse(validate)
            self.assertEqual(effective['STEAM_GSLT'], 'native-fixture-token')
            (root / 'BSDS.x86_64').write_bytes(b'repaired fixture')
            self.target.write_text('{"Server":{"Login_Token":"after-update-fixture"},"Browser":{"Server_Name":"After update"}}')
        with patch.object(shared, 'run', return_value=17) as run:
            self.assertEqual(self.invoke({**self.env, 'AUTO_UPDATE': '1'}, install), 17)
        self.assertEqual(run.call_args.kwargs['credentials'], ['after-update-fixture'])
        self.assertTrue(run.call_args.kwargs['terminal_input'])
        self.assertEqual(run.call_args.kwargs['ready_marker'], b'Connect to steam server successfully')
        self.assertEqual(json.loads(self.target.read_text())['Browser']['Server_Name'], 'After update')


if __name__ == '__main__':
    unittest.main()
