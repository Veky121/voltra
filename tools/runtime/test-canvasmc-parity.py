import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest import mock

BASE = Path(__file__).resolve().parent
support = runpy.run_path(str(BASE / 'test-hybrid-java.py'))
shared = support['adapter']
import sys
sys.modules['hybrid_java_install'] = shared
canvas = support['load']('canvasmc_install', 'internal/panel/game_library/scripts/canvasmc-install.py')
stager = support['load']('stage_canvas', 'tools/runtime/stage-canvasmc-parity.py')


class CanvasTests(unittest.TestCase):
    def setUp(self):
        self.data = support['jar']()
        self.release = dict(project='canvas', version='26.3', build='991', url='https://publisher.invalid/server.jar', sha256=hashlib.sha256(self.data).hexdigest())

    def test_seed_allocation_then_preserve_every_operator_file(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(shared, 'canvas', return_value=self.release), mock.patch.object(shared, 'fetch', return_value=self.data) as fetch:
            root = Path(folder)
            canvas.install(root, {'SERVER_PORT': '25591'})
            self.assertIn('server-port=25591', (root / 'server.properties').read_text())
            originals = {'server.properties': b'# secret\nunknown=opaque\nserver-port=25592\n', 'eula.txt': b'eula=false\n', 'world/level.dat': b'world', 'plugins/Private/config.yml': b'token: secret', 'canvas-server.yml': b'unknown: preserve'}
            for name, data in originals.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            canvas.install(root, {'SERVER_PORT': '25593'})
            self.assertEqual(fetch.call_count, 1)
            for name, data in originals.items():
                self.assertEqual((root / name).read_bytes(), data)

    def test_hash_failure_preserves_existing_program(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(shared, 'canvas', return_value=self.release), mock.patch.object(shared, 'fetch', return_value=b'bad'):
            root = Path(folder)
            (root / 'server.jar').write_bytes(b'old')
            with self.assertRaises(ValueError):
                canvas.install(root, {})
            self.assertEqual((root / 'server.jar').read_bytes(), b'old')
            self.assertFalse((root / 'eula.txt').exists())

    def test_unpinned_build_requires_reviewed_digest_and_bad_port_fails(self):
        release = dict(self.release)
        del release['sha256']
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(shared, 'canvas', return_value=release), mock.patch.object(shared, 'fetch') as fetch:
            with self.assertRaises(ValueError):
                canvas.install(folder, {})
            with self.assertRaises(ValueError):
                canvas.install(folder, {'SERVER_PORT': '65536'})
            fetch.assert_not_called()

    def test_in_volume_symlink_rejected_before_download(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(shared, 'canvas', return_value=self.release), mock.patch.object(shared, 'fetch') as fetch:
            root = Path(folder)
            (root / 'operator.properties').write_text('secret')
            (root / 'server.properties').symlink_to(root / 'operator.properties')
            with self.assertRaises(ValueError):
                canvas.install(root, {})
            fetch.assert_not_called()

    def test_fragment_preserves_original_rows_and_real_lifecycle(self):
        root = stager.ROOT
        profile = json.loads((root / 'artifacts/game-parity-20261029/canvasmc-profile.json').read_text())[stager.KEY]
        original = json.loads((BASE / 'fixtures/canvasmc/original-controls.json').read_text())
        self.assertEqual(profile['egg']['variables'][:len(original['variables'])], original['variables'])
        self.assertEqual(profile['egg']['config']['stop'], 'stop')
        self.assertEqual(profile['egg']['config']['startup'], original['config']['startup'])
        self.assertEqual(profile['egg']['config']['files'], '{}')
        self.assertEqual(profile['egg']['voltra']['java_config']['required_major'], 25)
        self.assertIn('eula', profile['egg']['features'])
        self.assertEqual(profile['verification'], 'not_verified')


if __name__ == '__main__':
    unittest.main()
