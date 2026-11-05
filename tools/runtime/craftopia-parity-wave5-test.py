"""Offline Craftopia preflight fixtures; no acquisition or native process."""
import importlib.util
import os
from pathlib import Path
import signal
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'
for name in ('steam-template', 'native-config', 'native-console', 'source-install', 'source-next-install',
             'tactical-install', 'tactical-runtime', 'crafting-install', 'crafting-runtime'):
    identity = name.replace('-', '_')
    module = types.ModuleType(identity)
    module.__file__ = str(BASE / (name + '.py'))
    sys.modules[identity] = module
    exec(compile((BASE / (name + '.py')).read_text(), module.__file__, 'exec'), module.__dict__)
shared = sys.modules['crafting_runtime']
file = BASE / 'craftopia-preflight.py'
spec = importlib.util.spec_from_file_location('craftopia_wave5', file)
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CraftopiaPreflight(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()
        self.environment = {'VOLTRA_CRAFTING': 'craftopia', 'SRCDS_APPID': '1670340', 'AUTO_UPDATE': '1',
                            'WORLD_NAME': 'Requested world', 'SERVER_PORT': '29140', 'VOLTRA_ALLOCATED_PORTS': '29140'}
        self.target = self.root / 'ServerSetting.ini'
        self.original = b'; operator\r\n[GameWorld]\r\nname=Original\r\ndifficulty=2\r\n[Host]\r\nport=8050\r\nmaxPlayerNumber=7\r\n[Save]\r\nsavePath=DedicatedServerSave/\r\nautoSaveSec=300\r\n[Unknown]\r\nrows=one\r\nrows=two\r\n'
        self.target.write_bytes(self.original)
        (self.root / 'Craftopia.x86_64').write_bytes(b'fixture executable')

    def files(self):
        return {str(file.relative_to(self.root)): file.read_bytes() for file in self.root.rglob('*') if file.is_file()}

    def invoke(self, environment=None, relay=None):
        return candidate.main(self.root, environment or self.environment, shared, lambda *args, **kwargs: relay or Mock())

    def test_baseline_acquires_before_invalid_control_refusal(self):
        with patch.object(shared, 'install') as install:
            with self.assertRaises(ValueError): shared.main(self.root, {**self.environment, 'SERVER_PORT': '1'})
        install.assert_called_once()
        self.assertEqual(self.target.read_bytes(), self.original)

    def test_invalid_controls_refuse_before_acquisition_or_writes(self):
        for bad in ({'SERVER_PORT': '1'}, {'VOLTRA_ALLOCATED_PORTS': '29141'}, {'WORLD_NAME': 'bad\nname'},
                    {'SRCDS_APPID': '1'}, {'AUTO_UPDATE': 'yes'}, {'WINDOWS_INSTALL': '1'}):
            with self.subTest(bad=bad):
                before = self.files()
                with patch.object(shared, 'install') as install, patch.object(shared, 'configure') as configure:
                    with self.assertRaises(ValueError): self.invoke({**self.environment, **bad})
                install.assert_not_called(); configure.assert_not_called()
                self.assertEqual(before, self.files())

    def test_ambiguous_managed_native_identities_refuse_before_update(self):
        for data in (self.original + b'[GameWorld]\nname=Second\n',
                     self.original.replace(b'[Save]', b'[save]'),
                     self.original.replace(b'name=Original', b'Name=Original'),
                     self.original.replace(b'port=8050', b'port=8050\nport=8051'),
                     self.original.replace(b'savePath=DedicatedServerSave/', b'savePath=one\nsavePath=two')):
            with self.subTest(data=data):
                self.target.write_bytes(data)
                with patch.object(shared, 'install') as install:
                    with self.assertRaises(ValueError): self.invoke()
                install.assert_not_called(); self.assertEqual(self.target.read_bytes(), data)

    def test_pure_plan_retains_unknown_text_and_default_savepath_fix(self):
        before = self.files()
        result = candidate.plan(shared, self.root, self.environment)
        self.assertEqual(before, self.files())
        self.assertIn(b'difficulty=2\r\n', result['planned'])
        self.assertIn(b'rows=one\r\nrows=two\r\n', result['planned'])
        self.assertIn(str(self.root / 'DedicatedServerSave').encode(), result['planned'])
        self.assertIn(b'Requested world', result['planned'])

    def test_custom_savepath_is_preserved_without_claiming_retention(self):
        self.target.write_bytes(self.original.replace(b'DedicatedServerSave/', b'custom/operator-save/'))
        result = candidate.plan(shared, self.root, self.environment)
        self.assertIn(b'savePath=custom/operator-save/', result['planned'])
        self.assertFalse((self.root / 'custom').exists())

    def test_bad_default_save_directory_refuses_before_acquisition(self):
        (self.root / 'DedicatedServerSave').write_bytes(b'operator file')
        with patch.object(shared, 'install') as install:
            with self.assertRaises(ValueError): self.invoke()
        install.assert_not_called()
        self.assertEqual((self.root / 'DedicatedServerSave').read_bytes(), b'operator file')

    def test_update_repairs_missing_payload_and_replans_before_supervision(self):
        (self.root / 'Craftopia.x86_64').unlink(); self.target.unlink()
        events = []; relay = Mock()
        def install(*args, **kwargs):
            events.append('install')
            self.target.write_bytes(self.original)
            (self.root / 'Craftopia.x86_64').write_bytes(b'repaired fixture')
        def configure(*args):
            events.append('configure')
            candidate.plan(shared, self.root, self.environment)
            return ['fixture executable'], {'HOME': str(self.root)}, ['fixture secret'], b'World is loaded!', '\x03'
        with patch.object(shared, 'install', side_effect=install), patch.object(shared, 'configure', side_effect=configure), patch.object(shared, 'run', return_value=19) as run:
            self.assertEqual(self.invoke(relay=relay), 19)
        self.assertEqual(events, ['install', 'configure'])
        relay.start.assert_called_once(); relay.finish.assert_called_once()
        self.assertEqual(run.call_args.kwargs['stop_signal'], signal.SIGINT)
        self.assertEqual(run.call_args.kwargs['ready_marker'], b'World is loaded!')
        self.assertEqual(run.call_args.kwargs['credentials'], ['fixture secret'])

    def test_failed_update_does_not_publish_or_enter_relay(self):
        with patch.object(shared, 'install', side_effect=RuntimeError('acquisition intercepted')), patch.object(shared, 'configure') as configure:
            with self.assertRaisesRegex(RuntimeError, 'acquisition intercepted'): self.invoke()
        configure.assert_not_called(); self.assertEqual(self.target.read_bytes(), self.original)

    def test_missing_payload_without_updates_refuses_before_configuration(self):
        (self.root / 'Craftopia.x86_64').unlink()
        with patch.object(shared, 'configure') as configure:
            with self.assertRaises(ValueError): self.invoke({**self.environment, 'AUTO_UPDATE': '0'})
        configure.assert_not_called()

    @unittest.skipIf(os.name == 'nt', 'Actual shared publisher requires Linux dirfd APIs')
    def test_actual_publisher_repeated_boots_preserve_operator_values_and_metadata(self):
        self.target.write_bytes(self.original.replace(b'maxPlayerNumber=7', b'maxPlayerNumber=7\r\nserverPassword=01234567'))
        self.target.chmod(0o640)
        relay = Mock()
        with patch.object(shared, 'run', return_value=0) as run, patch.object(shared, 'install') as install:
            self.assertEqual(self.invoke({**self.environment, 'AUTO_UPDATE': '0'}, relay=relay), 0)
            first = self.target.read_bytes()
            self.assertEqual(self.invoke({**self.environment, 'AUTO_UPDATE': '0'}, relay=relay), 0)
        install.assert_not_called()
        self.assertEqual(first, self.target.read_bytes())
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o640)
        for row in (b'difficulty=2\r\n', b'maxPlayerNumber=7\r\n', b'serverPassword=01234567\r\n', b'rows=one\r\nrows=two\r\n'):
            self.assertIn(row, first)
        self.assertIn('01234567', run.call_args.kwargs['credentials'])
        self.assertEqual(relay.start.call_count, 2); self.assertEqual(relay.finish.call_count, 2)
        self.assertTrue(list((self.root / '.voltra/crafting/config-backups').iterdir()))

    @unittest.skipIf(os.name == 'nt', 'Linux filesystem fixture')
    def test_symlinked_backup_parent_refuses_before_update(self):
        inside = self.root / 'retained-backup-area'; inside.mkdir()
        (self.root / '.voltra').mkdir()
        (self.root / '.voltra/crafting').symlink_to(inside, target_is_directory=True)
        with patch.object(shared, 'install') as install:
            with self.assertRaises(ValueError): self.invoke()
        install.assert_not_called(); self.assertEqual(self.target.read_bytes(), self.original)
        self.assertEqual(list(inside.iterdir()), [])

    def test_native_password_is_forwarded_to_log_relay_and_console_redaction(self):
        self.target.write_bytes(self.original.replace(b'maxPlayerNumber=7', b'maxPlayerNumber=7\r\nserverPassword=01234567'))
        relay = Mock(); observed = {}
        def factory(*args, **kwargs):
            observed.update(kwargs); return relay
        with patch.object(shared, 'install'), patch.object(shared, 'configure', return_value=(['fixture'], {}, [], b'World is loaded!', '\x03')), patch.object(shared, 'run', return_value=0) as run:
            self.assertEqual(candidate.main(self.root, self.environment, shared, factory), 0)
        self.assertIn('01234567', observed['credentials'])
        self.assertIn('01234567', run.call_args.kwargs['credentials'])


if __name__ == '__main__': unittest.main()
