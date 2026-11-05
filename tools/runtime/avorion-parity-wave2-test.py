"""Offline refusal-before-acquisition regression for the staged Avorion wrapper."""
import importlib.util
import os
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
BASE = {'SERVER_PORT': '28010', 'VOLTRA_ALLOCATED_PORTS': '28010,28011,28012,28013', 'VOLTRA_STEAM_AUTO_UPDATE': '1'}


def modules():
    return {'native_console': types.SimpleNamespace(run=Mock(return_value=0)),
            'strategy_survival_install': types.SimpleNamespace(install=Mock()),
            'private_nss': types.SimpleNamespace(native_environment=Mock(side_effect=lambda root, env, *_: env))}


def candidate():
    spec = importlib.util.spec_from_file_location('avorion_wave2', ROOT / 'internal/panel/game_library/scripts/avorion-runtime.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class RefusalBeforeAcquisition(unittest.TestCase):
    def test_invalid_inputs_leave_files_and_acquisition_untouched(self):
        cases = [{'GALAXY_NAME': '../escape'}, {'SERVER_PORT': '9000'}, {'QUERY_PORT': '28010'},
                 {'COLLISION_DMG': 'nan'}, {'ADMIN_ID': 'bad'}, {'MAX_PLAYERS': '0'},
                 {'VOLTRA_NATIVE_LIBRARY_PATH': '/outside'}, {'VOLTRA_STEAM_AUTO_UPDATE': 'yes'}]
        for invalid in cases:
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                marker = root / 'operator.dat'
                marker.write_bytes(b'unchanged native data')
                initial = {p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                mocks = modules()
                with patch.dict(sys.modules, mocks):
                    runtime = candidate()
                    with self.assertRaises(ValueError):
                        runtime.main(root, {**BASE, **invalid})
                mocks['strategy_survival_install'].install.assert_not_called()
                mocks['private_nss'].native_environment.assert_not_called()
                mocks['native_console'].run.assert_not_called()
                self.assertEqual(initial, {p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file()})

    def test_valid_update_preserves_native_tokens_and_shared_supervision(self):
        with tempfile.TemporaryDirectory() as directory:
            mocks = modules()
            with patch.dict(sys.modules, mocks):
                runtime = candidate()
                self.assertEqual(runtime.main(directory, {**BASE, 'SERVER_NAME': 'literal $ name'}), 0)
            mocks['strategy_survival_install'].install.assert_called_once_with(Path(directory), 'avorion', {**BASE, 'SERVER_NAME': 'literal $ name'}, validate=False)
            call = mocks['native_console'].run.call_args
            self.assertEqual(call.args[1][call.args[1].index('--server-name') + 1], 'literal $ name')
            self.assertEqual(call.args[3], '/stop')
            self.assertEqual(call.kwargs['ready_marker'], b'Server startup complete')

    def test_manual_start_skips_acquisition_and_propagates_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            mocks = modules()
            mocks['native_console'].run.return_value = 17
            with patch.dict(sys.modules, mocks):
                runtime = candidate()
                self.assertEqual(runtime.main(directory, {**BASE, 'VOLTRA_STEAM_AUTO_UPDATE': '0'}), 17)
            mocks['strategy_survival_install'].install.assert_not_called()

    def test_installer_failure_does_not_enter_native_identity_or_start(self):
        with tempfile.TemporaryDirectory() as directory:
            mocks = modules()
            mocks['strategy_survival_install'].install.side_effect = RuntimeError('fixture failure')
            with patch.dict(sys.modules, mocks):
                runtime = candidate()
                with self.assertRaisesRegex(RuntimeError, 'fixture failure'):
                    runtime.main(directory, BASE)
            mocks['private_nss'].native_environment.assert_not_called()
            mocks['native_console'].run.assert_not_called()

    def test_caller_environment_is_not_mutated(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {**BASE, 'VOLTRA_STEAM_AUTO_UPDATE': '0'}
            before = dict(env)
            with patch.dict(sys.modules, modules()):
                candidate().main(directory, env)
            self.assertEqual(env, before)


if __name__ == '__main__':
    unittest.main()
