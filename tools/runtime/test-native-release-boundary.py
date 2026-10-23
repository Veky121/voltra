import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/native-release.py'
spec = importlib.util.spec_from_file_location('native_release', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReleaseBoundary(unittest.TestCase):
    def test_normal_verified_install_keeps_operator_files_without_download(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / '.voltra/game'
            target = root / 'game'
            state.mkdir(parents=True)
            target.mkdir()
            (target / 'server').write_bytes(b'publisher binary')
            (target / 'operator.cfg').write_text('retain settings')
            archive_hash = 'a' * 64
            receipt = {'sha256': archive_hash,
                       'binary_sha256': hashlib.sha256(b'publisher binary').hexdigest(),
                       'files': {'operator.cfg': 'retained operator content'}}
            (state / 'release.json').write_text(json.dumps(receipt))
            with patch.object(module, 'download', side_effect=AssertionError('unexpected download')):
                module.install_release(root, {'sha256': archive_hash, 'version': 'fixture'}, 'game', 'server')
            self.assertEqual((target / 'operator.cfg').read_text(), 'retain settings')

    def test_external_state_and_engine_links_fail_before_creation_or_download(self):
        for location in ['state_parent', 'state_leaf', 'engine']:
            with self.subTest(location=location), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / 'volume'
                outside = Path(temporary) / 'outside'
                root.mkdir()
                outside.mkdir()
                if location == 'state_parent':
                    (root / '.voltra').symlink_to(outside, target_is_directory=True)
                elif location == 'state_leaf':
                    (root / '.voltra').mkdir()
                    (root / '.voltra/game').symlink_to(outside, target_is_directory=True)
                else:
                    (root / 'game').symlink_to(outside, target_is_directory=True)
                with patch.object(module, 'download', side_effect=AssertionError('network reached')):
                    with self.assertRaisesRegex(ValueError, 'escapes'):
                        module.install_release(root, {}, 'game', 'server')
                self.assertEqual(list(outside.iterdir()), [])
                if location == 'engine':
                    self.assertFalse((root / '.voltra').exists())

    def test_receipt_link_cannot_read_or_overwrite_external_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'volume'
            state = root / '.voltra/game'
            state.mkdir(parents=True)
            victim = Path(temporary) / 'operator.json'
            victim.write_text('retain bytes')
            (state / 'release.json').symlink_to(victim)
            with self.assertRaisesRegex(ValueError, 'receipt'):
                module.install_release(root, {}, 'game', 'server')
            self.assertEqual(victim.read_text(), 'retain bytes')


if __name__ == '__main__':
    unittest.main()
