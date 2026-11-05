"""Offline ASA filesystem tests, no Steam, Wine, native server or player."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import signal
import hashlib
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('asa', 'internal/panel/game_library/scripts/arkascended.py')
asa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asa)


def env():
    return {'SERVER_PORT': '7777', 'VOLTRA_ALLOCATED_PORTS': '7777,7778,37015',
            'RCON_PORT': '37015', 'ARK_ADMIN_PASSWORD': 'fixture-password',
            'SESSION_NAME': 'Seed name', 'MAX_PLAYERS': '70', 'SERVER_PVE': '1'}


class AsaTests(unittest.TestCase):
    def test_current_fragment_metadata_and_helper_hashes(self):
        base = Path('artifacts/game-parity-20261029/resume-wave4-arkascended')
        recipe = 'ark_survival_ascended/egg-ark-survival-ascended.json'
        fragment = json.loads((base/'profile.json').read_text())
        self.assertEqual(list(fragment), [recipe])
        current = json.loads(Path('internal/panel/game_library/overrides.json').read_text())[recipe]
        candidate = fragment[recipe]
        for key in ('revision', 'verification', 'detail'):
            candidate[key] = current[key]
        candidate['egg']['scripts']['installation']['script'] = current['egg']['scripts']['installation']['script']
        self.assertEqual(candidate, current)
        hashes = json.loads((base/'helper-hashes.json').read_text())
        for name, digest in hashes['helpers'].items():
            self.assertEqual(hashlib.sha256(Path(name).read_bytes()).hexdigest(), digest)

    def test_owned_readiness_forwards_authenticated_command(self):
        original = asa.ark.command
        with patch.object(asa.ark, 'command', return_value='No Players Connected') as command, \
             patch.object(asa.ark, 'native_pids', return_value=[123]):
            def lifecycle(*args):
                self.assertEqual(asa.ark.command(37015, 'private', 'ListPlayers'), 'No Players Connected')
                return 17
            with patch.object(asa.ark, 'run', side_effect=lifecycle):
                self.assertEqual(asa.run(Path('.'), {}, {}), 17)
            command.assert_called_once_with(37015, 'private', 'ListPlayers')
        self.assertIs(asa.ark.command, original)

    def test_explicit_rcon_allocation_required_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for value in ('', '0', '7777', '7778', '37016'):
                values = env() | {'RCON_PORT': value}
                with self.subTest(port=value), self.assertRaises(ValueError):
                    asa.effective(root, values)
                self.assertEqual(list(root.iterdir()), [])

    def test_readiness_requires_owned_native_process_and_restores_hooks(self):
        original_signal, original_command = asa.ark.signal, asa.ark.command
        def lifecycle(*args):
            with self.assertRaises(ValueError):
                asa.ark.command(37015, 'private', 'ListPlayers')
            return 0
        with patch.object(asa.ark, 'native_pids', return_value=[]), \
             patch.object(asa.ark, 'run', side_effect=lifecycle):
            self.assertEqual(asa.run(Path('.'), {}, {}), 1)
        self.assertIs(asa.ark.signal, original_signal)
        self.assertIs(asa.ark.command, original_command)

    def test_raw_exit_and_requested_stop_classification(self):
        for requested, code, expected in ((False, 0, 1), (False, 17, 17),
                                          (True, 0, 0), (True, 137, 137)):
            handlers = {signal.SIGINT: signal.SIG_DFL, signal.SIGTERM: signal.SIG_DFL}
            baseline = dict(handlers)
            def register(sig, handler):
                old = handlers[sig]
                handlers[sig] = handler
                return old
            proxy = SimpleNamespace(SIGINT=signal.SIGINT, SIGTERM=signal.SIGTERM, signal=register)
            def lifecycle(*args):
                old = asa.ark.signal.signal(signal.SIGTERM, lambda *_: None)
                if requested:
                    handlers[signal.SIGTERM](signal.SIGTERM, None)
                asa.ark.signal.signal(signal.SIGTERM, old)
                return code
            with self.subTest(requested=requested, code=code), \
                 patch.object(asa.ark, 'signal', proxy), \
                 patch.object(asa.ark, 'run', side_effect=lifecycle):
                self.assertEqual(asa.run(Path('.'), {}, {}), expected)
            self.assertEqual(handlers, baseline)

    def test_lifecycle_exception_restores_adapter_hooks(self):
        original_signal, original_command = asa.ark.signal, asa.ark.command
        with patch.object(asa.ark, 'run', side_effect=RuntimeError('fixture')):
            with self.assertRaises(RuntimeError):
                asa.run(Path('.'), {}, {})
        self.assertIs(asa.ark.signal, original_signal)
        self.assertIs(asa.ark.command, original_command)

    def test_seed_native_authority_and_unknown_repeated_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asa.ark.configure(root, 'ascended', asa.effective(root, env()))
            path = root / asa.CONFIG
            content = path.read_text().replace('Seed name', 'Operator name').replace('MaxPlayers = 70', 'MaxPlayers = 42')
            content += '\n[OperatorMod]\n; keep comment\nArray=one\nArray=two\n'
            path.write_text(content)
            # Duplicate unmanaged arrays are valid Unreal INI, so strict configparser
            # must not reject them when reading only managed authority fields.
            values = asa.effective(root, env())
            plan = asa.ark.configure(root, 'ascended', values)
            self.assertIn('SessionName="Operator name"', plan['args'][0])
            self.assertIn('-WinLiveMaxPlayers=42', plan['args'])
            self.assertIn('[OperatorMod]\n; keep comment\nArray=one\nArray=two', path.read_text())

    def test_update_failure_restores_ini_and_leaves_world(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / asa.CONFIG
            path.parent.mkdir(parents=True)
            path.write_bytes(b'; operator\r\n[ServerSettings]\r\nCustom=1\r\n')
            world = root / 'ShooterGame/Saved/SavedArks/world.ark'
            world.parent.mkdir()
            world.write_bytes(b'fixture-world')
            before = path.read_bytes(), path.stat().st_mtime_ns
            def fail(*args, **kwargs):
                path.write_bytes(b'overwritten by fixture updater')
                raise RuntimeError('fixture interruption')
            with patch.object(asa.ark.steam, 'arguments'), patch.object(asa.ark.steam, 'update', side_effect=fail):
                with self.assertRaises(RuntimeError):
                    asa.ark.install(root, 'ascended', env())
            self.assertEqual(before, (path.read_bytes(), path.stat().st_mtime_ns))
            self.assertEqual(world.read_bytes(), b'fixture-world')

    def test_invalid_file_value_rejected_before_config_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / asa.CONFIG
            path.parent.mkdir(parents=True)
            path.write_text('[SessionSettings]\nSessionName=bad?Port=1\n')
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                asa.effective(root, env())
            self.assertEqual(before, path.read_bytes())

    def test_exact_original_rows_and_disjoint_fragment(self):
        recipe = 'ark_survival_ascended/egg-ark-survival-ascended.json'
        fragment = json.loads(Path('artifacts/game-parity-20261029/arkascended-profile.json').read_text())
        original = next(e for e in json.loads(Path('internal/panel/game_library/upstream/catalog.json').read_text())['entries'] if e['path'] == recipe)
        self.assertEqual(list(fragment), [recipe])
        rows = original['egg']['variables']
        self.assertEqual(fragment[recipe]['egg']['variables'][:len(rows)], rows)
        self.assertEqual(fragment[recipe]['verification'], 'not_verified')


if __name__ == '__main__':
    unittest.main()
