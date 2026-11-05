"""Actual staged CSS seed wrapper through unchanged shared Counter-Strike code."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    if spec is None:
        from importlib.machinery import SourceFileLoader
        spec = importlib.util.spec_from_loader(name, SourceFileLoader(name, str(file)))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


for name in ('steam-template', 'native-console', 'source-install', 'source-runtime', 'counterstrike-preflight'):
    load(name.replace('-', '_'), BASE / (name + '.py'))
shared = sys.modules['source_runtime']
adapter = sys.modules['counterstrike_preflight']
candidate = load('css_native_settings', BASE / 'css-native-settings.py.pending')


class CSSSeed(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / 'srcds_run').write_bytes(b'fixture-only')
        (self.root / 'cstrike/cfg').mkdir(parents=True)
        (self.root / '.voltra').mkdir()
        self.cfg = self.root / 'cstrike/cfg/server.cfg'
        self.env = {'SERVER_PORT': '29110', 'VOLTRA_ALLOCATED_PORTS': '29110,29111,29112', 'SRCDS_APPID': '232330', 'SRCDS_MAP': 'de_dust2', 'HOSTNAME': 'CSS fixture', 'MAX_PLAYERS': '24', 'PUBLIC_SERVER': '0', 'AUTO_UPDATE': '0'}

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file() and not p.is_symlink()}

    def execute(self):
        with patch.object(shared, 'run', return_value=17) as run, patch.object(shared, 'update') as update:
            result = candidate.main(self.root, self.env, adapter, shared)
            return result, run.call_args, update.call_count

    def test_missing_native_cfg_seeds_exact_measured_values_and_shared_launch(self):
        before = self.snapshot()
        target, seed = candidate.plan(self.root, adapter)
        self.assertEqual(before, self.snapshot())
        result, call, updates = self.execute()
        self.assertEqual((result, updates), (17, 0))
        self.assertEqual(target.read_text(), seed)
        self.assertIn('mp_roundtime "2.5"', seed)
        self.assertEqual(call.args[3], 'quit')
        self.assertTrue(call.kwargs['terminal_input'])

    def test_existing_unknown_cfg_and_permissions_are_unchanged_on_repeated_boots(self):
        original = b'// operator\r\nmp_friendlyfire "1"\r\nexec own-mod.cfg\r\nunknown "retain"\r\n'
        self.cfg.write_bytes(original)
        self.cfg.chmod(0o640)
        self.execute()
        self.execute()
        self.assertEqual(self.cfg.read_bytes(), original)
        self.assertEqual(self.cfg.stat().st_mode & 0o777, 0o640)

    def test_invalid_environment_refuses_before_seed_or_updater(self):
        self.env.update(AUTO_UPDATE='1', MAX_PLAYERS='999')
        before = self.snapshot()
        with patch.object(shared, 'run') as run, patch.object(shared, 'update') as update:
            with self.assertRaises(ValueError):
                candidate.main(self.root, self.env, adapter, shared)
            run.assert_not_called()
            update.assert_not_called()
        self.assertEqual(before, self.snapshot())

    def test_unsafe_cfg_path_refuses_before_updater_and_existing_bytes_survive(self):
        operator = self.root / 'operator.cfg'
        operator.write_bytes(b'// preserve exact operator bytes\n')
        self.cfg.symlink_to(operator)
        self.env['AUTO_UPDATE'] = '1'
        before = self.snapshot()
        with patch.object(shared, 'update') as update:
            with self.assertRaises(ValueError):
                candidate.main(self.root, self.env, adapter, shared)
            update.assert_not_called()
        self.assertEqual(before, self.snapshot())


if __name__ == '__main__':
    unittest.main()
