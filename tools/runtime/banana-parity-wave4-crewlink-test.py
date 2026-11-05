import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('crewlink_seed', ROOT / 'internal/panel/game_library/scripts/crewlink-controls.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
shared = adapter.load_shared()


class CrewLinkNativeSeedTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name in ('.voltra/node/bin/node', 'crewlink/dist/index.js'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'fixture-only')
        self.target = self.root / 'crewlink/config/peerConfig.yml'
        self.receipt = self.root / '.voltra/crewlink/release.json'
        self.receipt.parent.mkdir()
        self.receipt.write_text(json.dumps({'version': adapter.PINNED_CREW_SOURCE, 'sha256': adapter.PINNED_CREW_SHA256}))
        self.env = {'SERVER_PORT': '29100', 'VOLTRA_ALLOCATED_PORTS': '29100', 'HTTPS': '', 'PORT': ''}

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file() and not p.is_symlink()}

    def test_pure_preflight_does_not_publish_defaults(self):
        before = self.snapshot()
        adapter.preflight(shared, self.root, self.env)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.target.parent.exists())

    def test_first_valid_launch_seeds_actual_code_defaults_before_launch(self):
        def launch(game, root, environment):
            self.assertEqual(game, 'crewlink')
            self.assertEqual(self.target.read_text(), adapter.DEFAULT_PEER_YAML)
            self.assertEqual(environment['PORT'], '29100')
            return 17
        with patch.object(shared, 'run', side_effect=launch):
            self.assertEqual(adapter.run(shared, self.root, self.env), 17)
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o600)
        self.assertIn('  enabled: false\n', self.target.read_text())
        self.assertIn('  externalIps: null\n', self.target.read_text())
        self.assertIn('  relayIps: []\n', self.target.read_text())
        self.assertIn('forceRelayOnly: false\n', self.target.read_text())
        self.assertIn('stun:stun.l.google.com:19302', self.target.read_text())

    def test_existing_operator_bytes_and_mode_survive_repeated_launches(self):
        self.target.parent.mkdir()
        content = b'# operator\r\nforceRelayOnly: true\r\nintegratedRelay:\r\n  enabled: false\r\nunknown: custom\r\n'
        self.target.write_bytes(content)
        self.target.chmod(0o640)
        with patch.object(shared, 'run', return_value=0):
            for _ in range(2):
                adapter.run(shared, self.root, self.env)
        self.assertEqual(self.target.read_bytes(), content)
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o640)

    def test_invalid_port_or_https_prerequisites_refuse_before_seed(self):
        before = self.snapshot()
        for override in ({'PORT': '29999'}, {'HTTPS': 'false'}, {'VOLTRA_ALLOCATED_PORTS': '29100,29100'}):
            with self.subTest(override=override), patch.object(shared, 'run') as launch, self.assertRaises(ValueError):
                adapter.run(shared, self.root, {**self.env, **override})
            launch.assert_not_called()
            self.assertEqual(self.snapshot(), before)
            self.assertFalse(self.target.exists())

    def test_missing_payload_refuses_before_seed(self):
        (self.root / 'crewlink/dist/index.js').unlink()
        before = self.snapshot()
        with patch.object(shared, 'run') as launch, self.assertRaises(ValueError):
            adapter.run(shared, self.root, self.env)
        launch.assert_not_called()
        self.assertEqual(self.snapshot(), before)

    def test_symlink_parent_and_leaf_refuse_without_modifying_target(self):
        outside = self.root / 'operator-data'
        outside.mkdir()
        sentinel = outside / 'peerConfig.yml'
        sentinel.write_bytes(b'private operator content')
        self.target.parent.symlink_to(outside, target_is_directory=True)
        with patch.object(shared, 'run') as launch, self.assertRaises(ValueError):
            adapter.run(shared, self.root, self.env)
        launch.assert_not_called()
        self.assertEqual(sentinel.read_bytes(), b'private operator content')
        self.target.parent.unlink()
        self.target.parent.mkdir()
        self.target.symlink_to(sentinel)
        with patch.object(shared, 'run'), self.assertRaises(ValueError):
            adapter.run(shared, self.root, self.env)
        self.assertEqual(sentinel.read_bytes(), b'private operator content')

    def test_non_directory_parent_and_non_regular_leaf_refuse(self):
        self.target.parent.write_bytes(b'operator file')
        with patch.object(shared, 'run'), self.assertRaises(ValueError):
            adapter.run(shared, self.root, self.env)
        self.assertEqual(self.target.parent.read_bytes(), b'operator file')
        self.target.parent.unlink()
        self.target.mkdir(parents=True)
        with patch.object(shared, 'run'), self.assertRaises(ValueError):
            adapter.run(shared, self.root, self.env)
        self.assertTrue(self.target.is_dir())

    def test_custom_or_unproven_source_keeps_its_own_native_defaults(self):
        for receipt in ({'version': 'alternate-publisher-source', 'sha256': adapter.PINNED_CREW_SHA256}, {'version': adapter.PINNED_CREW_SOURCE, 'sha256': '0' * 64}):
            self.receipt.write_text(json.dumps(receipt))
            with patch.object(shared, 'run', return_value=0):
                adapter.run(shared, self.root, self.env)
            self.assertFalse(self.target.exists())
        self.receipt.unlink()
        with patch.object(shared, 'run', return_value=0):
            adapter.run(shared, self.root, self.env)
        self.assertFalse(self.target.exists())

    def test_invalid_source_receipt_refuses_before_seed(self):
        self.receipt.write_bytes(b'not JSON')
        before = self.snapshot()
        with patch.object(shared, 'run') as launch, self.assertRaises(ValueError):
            adapter.run(shared, self.root, self.env)
        launch.assert_not_called()
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
