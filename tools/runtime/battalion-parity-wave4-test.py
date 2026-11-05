"""Offline real shared-entrypoint validation; acquisition and process launch mocked."""
import ast
import importlib.util
from pathlib import Path
import signal
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'internal/panel/game_library/scripts'


def load(name):
    if name in sys.modules:
        return sys.modules[name]
    file = SOURCES / (name.replace('_', '-') + '.py')
    module = types.ModuleType(name)
    module.__file__ = str(file)
    sys.modules[name] = module
    source = file.read_text(encoding='utf-8')
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            candidate = SOURCES / (node.module.replace('_', '-') + '.py')
            if candidate.exists():
                load(node.module)
    exec(compile(source, str(file), 'exec'), module.__dict__)
    return module


shared = load('tactical_next_runtime')
spec = importlib.util.spec_from_file_location('battalion_preflight', SOURCES / 'battalion-preflight.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)
BASE = {'VOLTRA_TACTICAL_NEXT': 'battalion', 'SRCDS_APPID': '805140', 'SERVER_PORT': '28010',
        'VOLTRA_ALLOCATED_PORTS': '28010,28020', 'QUERY_PORT': '28020', 'AUTO_UPDATE': '1'}


class BattalionPreflight(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.binary = self.root / 'Battalion/Binaries/Linux/BattalionServer-Linux-Shipping'
        self.binary.parent.mkdir(parents=True)
        self.binary.write_bytes(b'publisher fixture')
        self.operator = self.root / 'Battalion/Saved/Config/LinuxServer/Game.ini'
        self.operator.parent.mkdir(parents=True)
        self.operator.write_bytes(b';operator\r\n[Custom]\r\nUnknown=retain\r\n')

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_baseline_acquires_before_invalid_control_refusal(self):
        with patch.object(shared, 'install') as install, self.assertRaises(ValueError):
            shared.main(self.root, {**BASE, 'SERVER_NAME': 'bad\nvalue'})
        install.assert_called_once()

    def test_invalid_controls_never_acquire_or_start_and_preserve_files(self):
        cases = [{'SERVER_NAME': 'bad\nvalue'}, {'ADMIN_PW': 'x' * 21}, {'SERVER_PORT': '1'},
                 {'QUERY_PORT': '28010'}, {'QUERY_PORT': '28030'}, {'AUTO_UPDATE': 'yes'},
                 {'VALIDATE': 'false'}, {'VOLTRA_ALLOCATED_PORTS': '28010,28020,70000'},
                 {'VOLTRA_ALLOCATED_PORTS': '28010,28010'}, {'SRCDS_APPID': '1'}, {'WINDOWS_INSTALL': '1'}]
        initial = self.snapshot()
        for invalid in cases:
            with self.subTest(invalid=invalid), patch.object(shared, 'install') as install, patch.object(shared, 'run') as run:
                with self.assertRaises(ValueError):
                    wrapper.main(self.root, {**BASE, **invalid}, shared)
                install.assert_not_called()
                run.assert_not_called()
                self.assertEqual(self.snapshot(), initial)

    def test_private_acquisition_refuses_before_shared_install(self):
        with patch.object(shared, 'install') as install, self.assertRaises(ValueError):
            wrapper.main(self.root, {**BASE, 'STEAM_PASS': 'fixture-only'}, shared)
        install.assert_not_called()

    def test_missing_executable_can_be_restored_by_update(self):
        self.binary.unlink()
        def restore(*args, **kwargs):
            self.binary.write_bytes(b'restored fixture')
        with patch.object(shared, 'install', side_effect=restore) as install, patch.object(shared, 'run', return_value=17) as run:
            self.assertEqual(wrapper.main(self.root, BASE, shared), 17)
        install.assert_called_once()
        self.assertEqual(run.call_args.kwargs['stop_signal'], signal.SIGINT)
        self.assertEqual(run.call_args.kwargs['ready_marker'], b' OnCreateSessionComplete ')

    def test_missing_executable_without_update_and_ambiguous_layout_refuse(self):
        self.binary.unlink()
        with patch.object(shared, 'install') as install, self.assertRaises(ValueError):
            wrapper.main(self.root, {**BASE, 'AUTO_UPDATE': '0'}, shared)
        install.assert_not_called()
        self.binary.write_bytes(b'fixture')
        alternate = self.root / 'BattalionServer/BattalionServer.sh'
        alternate.parent.mkdir()
        alternate.write_bytes(b'fixture')
        with patch.object(shared, 'install') as install, self.assertRaises(ValueError):
            wrapper.main(self.root, BASE, shared)
        install.assert_not_called()

    def test_valid_manual_start_retains_literal_controls_shared_supervisor_and_operator_bytes(self):
        before = self.snapshot()
        environment = {**BASE, 'AUTO_UPDATE': '0', 'SERVER_NAME': "Literal $ name 'x'", 'ADMIN_PW': 'fixture-admin'}
        with patch.object(shared, 'install') as install, patch.object(shared, 'run', return_value=0) as run:
            self.assertEqual(wrapper.main(self.root, environment, shared), 0)
        install.assert_not_called()
        self.assertIn("-SteamServerName=Literal $ name 'x'", run.call_args.args[1])
        self.assertIn('fixture-admin', run.call_args.kwargs['credentials'])
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
