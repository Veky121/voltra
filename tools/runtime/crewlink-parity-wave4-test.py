import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('crewlink_wave4', ROOT / 'internal/panel/game_library/scripts/crewlink-controls.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
shared = adapter.load_shared()


class CrewLinkAllocationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name in ('.voltra/node/bin/node', 'crewlink/dist/index.js'):
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'fixture-only')
        self.native = self.root / 'crewlink/config/peerConfig.yml'
        self.native.parent.mkdir()
        self.native.write_bytes(b'# operator\nforceRelayOnly: false\nintegratedRelay:\n  enabled: false\n')
        self.env = {'SERVER_PORT': '29100', 'VOLTRA_ALLOCATED_PORTS': '29100,29101', 'NAME': 'Literal " $ +', 'HOSTNAME': 'node.example', 'HTTPS': '', 'PORT': ''}

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_unallocated_custom_port_refuses_before_launch_without_writes(self):
        before = self.snapshot()
        with patch.object(shared, 'run') as launch, self.assertRaises(ValueError):
            adapter.run(shared, self.root, {**self.env, 'PORT': '29999'})
        launch.assert_not_called()
        self.assertEqual(self.snapshot(), before)

    def test_empty_port_uses_allocated_primary_and_preserves_literal_controls(self):
        before = dict(self.env)
        with patch.object(shared, 'run', return_value=17) as launch:
            self.assertEqual(adapter.run(shared, self.root, self.env), 17)
        self.assertEqual(launch.call_args.args[2]['PORT'], '29100')
        self.assertEqual(launch.call_args.args[2]['NAME'], 'Literal " $ +')
        self.assertEqual(self.env, before)

    def test_allocated_secondary_port_remains_supported(self):
        with patch.object(shared, 'run', return_value=0) as launch:
            adapter.run(shared, self.root, {**self.env, 'PORT': '29101'})
        self.assertEqual(launch.call_args.args[2]['PORT'], '29101')

    def test_invalid_allocations_refuse_without_launch_or_mutation(self):
        before = self.snapshot()
        for value in ('', '29101', '29100,29100', '29100,0', '29100,65536', '29100;echo bad'):
            with self.subTest(value=value), patch.object(shared, 'run') as launch, self.assertRaises(ValueError):
                adapter.run(shared, self.root, {**self.env, 'VOLTRA_ALLOCATED_PORTS': value})
            launch.assert_not_called()
            self.assertEqual(self.snapshot(), before)

    def test_original_nonempty_https_false_requires_private_certificates(self):
        with patch.object(shared, 'run') as launch, self.assertRaises(ValueError):
            adapter.run(shared, self.root, {**self.env, 'HTTPS': 'false'})
        launch.assert_not_called()
        for name in ('privkey.pem', 'fullchain.pem'):
            (self.root / 'crewlink' / name).write_text('fixture-only')
        with patch.object(shared, 'run', return_value=0) as launch:
            adapter.run(shared, self.root, {**self.env, 'HTTPS': 'false'})
        self.assertEqual(launch.call_args.args[2]['SSLPATH'], str(self.root / 'crewlink'))

    def test_missing_payload_refuses_without_publishing_files(self):
        (self.root / 'crewlink/dist/index.js').unlink()
        before = self.snapshot()
        with patch.object(shared, 'run') as launch, self.assertRaises(ValueError):
            adapter.run(shared, self.root, self.env)
        launch.assert_not_called()
        self.assertEqual(self.snapshot(), before)

    def test_actual_shared_launch_retains_signal_handler_and_nonzero_exit(self):
        child = Mock()
        child.wait.return_value = 19
        with patch.object(shared.subprocess, 'Popen', return_value=child) as launch, patch.object(shared.signal, 'signal') as signals:
            self.assertEqual(adapter.run(shared, self.root, self.env), 19)
        self.assertEqual(launch.call_args.kwargs['cwd'], self.root / 'crewlink')
        self.assertEqual(launch.call_args.kwargs['env']['PORT'], '29100')
        self.assertEqual(signals.call_count, 2)

    def test_canonical_baseline_accepts_unallocated_port_repro(self):
        before = self.snapshot()
        effective = shared.crew_environment(self.root, {**self.env, 'PORT': '29999'})
        self.assertEqual(effective['PORT'], '29999')
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
