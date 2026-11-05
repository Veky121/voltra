import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
load('steam_template', BASE / 'steam-template.py')
load('native_config', BASE / 'native-config.py')
load('native_console', BASE / 'native-console.py')
shared = load('unreal_building', BASE / 'unreal-building.py')
adapter = load('brickadia_wave3', BASE / 'brickadia-file-authority.py')

class BrickadiaAuthority(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.info = shared.metadata()['brickadia']
        self.binary = self.root / self.info['binary']
        self.binary.parent.mkdir(parents=True)
        self.binary.write_bytes(b'fixture executable')
        self.file = self.root / self.info['config']
        self.file.parent.mkdir(parents=True)
        self.env = {'SERVER_PORT': '29100', 'VOLTRA_ALLOCATED_PORTS': '29100', 'SERVER_HOSTING_TOKEN': 'fixture-token'}
        self.published = []
        def publish(root, name, content):
            self.published.append(name)
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        self.publisher = patch.object(shared, 'publish', publish)
        self.publisher.start()
        self.addCleanup(self.publisher.stop)

    def test_complete_operator_file_is_byte_identical_and_password_redacted(self):
        original = ('\ufeff; operator\r\n[' + adapter.SECTION + ']\r\nServerName = Native operator\r\n'
                    'ServerPassword = "operator-password"\r\nbPubliclyListed = False\r\n+Custom=(One=2)\r\n').encode()
        self.file.write_bytes(original)
        for _ in range(2):
            argv, _, secrets, _ = adapter.configure(self.root, self.env)
            self.assertIn('operator-password', secrets)
            self.assertIn('-token=fixture-token', argv)
            self.assertEqual(self.file.read_bytes(), original)
        self.assertFalse(self.published)

    def test_missing_fields_seed_only_and_keep_existing_case_identity(self):
        original = '[' + adapter.SECTION.lower() + ']\nservername=Native name\nUnknown=keep\n'
        self.file.write_text(original)
        adapter.configure(self.root, {**self.env, 'SERVER_NAME': 'Creation default'})
        result = self.file.read_text()
        self.assertIn('servername=Native name', result)
        self.assertNotIn('Creation default', result)
        self.assertIn('ServerPassword = ', result)
        self.assertIn('Unknown=keep', result)
        self.assertEqual(result.count('['), 1)

    def test_duplicate_case_aliases_refused_before_publication(self):
        for content in ['[' + adapter.SECTION + ']\nServerName=one\nservername=two\n',
                        '[' + adapter.SECTION + ']\n[' + adapter.SECTION.lower() + ']\n']:
            self.file.write_text(content)
            with self.assertRaises(ValueError):
                adapter.configure(self.root, self.env)
            self.assertEqual(self.file.read_text(), content)
        self.assertFalse(self.published)

    def test_missing_binary_invalid_token_world_and_allocation_leave_config_absent(self):
        for change in [{'SERVER_HOSTING_TOKEN': ''}, {'WORLD_NAME': '../world'}, {'SERVER_PORT': '29101'},
                       {'SERVER_LIST_PUBLIC': 'maybe'}, {'SERVER_NAME': 'bad\nname'}]:
            with self.assertRaises(ValueError):
                adapter.configure(self.root, {**self.env, **change})
            self.assertFalse(self.file.exists())
        self.binary.unlink()
        with self.assertRaises(ValueError):
            adapter.configure(self.root, self.env)
        self.assertFalse(self.file.exists())

    def test_original_adapter_regression_exhibits_overwrite(self):
        self.file.write_text('[' + adapter.SECTION + ']\nServerName=Operator name\nServerPassword=operator-secret\nbPubliclyListed=False\n')
        shared.configure(self.root, 'brickadia', self.env)
        self.assertNotIn('Operator name', self.file.read_text())
        self.assertNotIn('operator-secret', self.file.read_text())

    def test_native_supervisor_handoff_remains_shared_and_real(self):
        with patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, {**self.env, 'AUTO_UPDATE': '0'}, clear=True), patch.object(shared, 'native_run', return_value=17) as run:
            self.assertEqual(adapter.main(), 17)
        self.assertEqual(run.call_args.args[1], 'brickadia')
        self.assertEqual(run.call_args.args[-1], self.info['ready'].encode())

    def test_invalid_update_flags_refuse_before_acquisition_or_publication(self):
        for change in [{'AUTO_UPDATE': 'yes'}, {'VOLTRA_STEAM_AUTO_UPDATE': '2'}, {'AUTO_UPDATE': ''}]:
            with patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, {**self.env, **change}, clear=True), patch.object(shared, 'install') as install, patch.object(shared, 'native_run') as run:
                with self.assertRaises(ValueError):
                    adapter.main()
                install.assert_not_called()
                run.assert_not_called()
            self.assertFalse(self.published)
            self.assertFalse(self.file.exists())

    def test_missing_binary_updater_can_repair_before_required_recheck(self):
        self.binary.unlink()
        def repair(root, game, environment):
            self.assertFalse(self.file.exists())
            self.binary.write_bytes(b'repaired fixture executable')
        with patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, {**self.env, 'AUTO_UPDATE': '1'}, clear=True), patch.object(shared, 'install', side_effect=repair) as install, patch.object(shared, 'native_run', return_value=0) as run:
            self.assertEqual(adapter.main(), 0)
            install.assert_called_once()
            run.assert_called_once()
        self.assertEqual(self.binary.read_bytes(), b'repaired fixture executable')
        self.assertTrue(self.file.exists())

    def test_update_enabled_still_checks_settings_before_acquisition_and_binary_after_it(self):
        self.binary.unlink()
        with patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, {**self.env, 'AUTO_UPDATE': '1', 'WORLD_NAME': '../bad'}, clear=True), patch.object(shared, 'install') as install:
            with self.assertRaises(ValueError):
                adapter.main()
            install.assert_not_called()
        with patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, {**self.env, 'AUTO_UPDATE': '1'}, clear=True), patch.object(shared, 'install') as install, patch.object(shared, 'native_run') as run:
            with self.assertRaises(ValueError):
                adapter.main()
            install.assert_called_once()
            run.assert_not_called()
        self.assertFalse(self.file.exists())

    def test_update_disabled_missing_binary_refuses_without_acquisition(self):
        self.binary.unlink()
        with patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, {**self.env, 'AUTO_UPDATE': '0'}, clear=True), patch.object(shared, 'install') as install:
            with self.assertRaises(ValueError):
                adapter.main()
            install.assert_not_called()
        self.assertFalse(self.file.exists())

if __name__ == '__main__':
    unittest.main()
