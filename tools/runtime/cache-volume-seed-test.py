#!/usr/bin/env python3
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('volume_seed', Path(__file__).with_name('cache-volume-seed.py'))
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class VolumeSeedTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'volume'
        self.root.mkdir()
        self.blobs = Path(self.temp.name) / 'blobs'
        self.blobs.mkdir()
        self.sha = hashlib.sha256(b'public publisher bytes').hexdigest()
        (self.blobs / self.sha).write_bytes(b'public publisher bytes')

    def test_private_copy_and_idempotent_verified_hit(self):
        result = cache.seed(self.root, self.blobs, [self.sha])
        self.assertEqual(result['public_blobs'][0]['sha256'], self.sha)
        destination = self.root / '.voltra/public-cache' / self.sha
        self.assertNotEqual(destination.stat().st_ino, (self.blobs / self.sha).stat().st_ino)
        self.assertEqual(cache.seed(self.root, self.blobs, [self.sha])['public_blobs'][0]['materialization'], 'existing_verified')
        destination.write_bytes(b'private changed')
        self.assertEqual((self.blobs / self.sha).read_bytes(), b'public publisher bytes')
        with self.assertRaisesRegex(ValueError, 'differs'):
            cache.seed(self.root, self.blobs, [self.sha])

    def test_all_sources_verified_before_any_copy(self):
        with self.assertRaisesRegex(ValueError, 'integrity'):
            cache.seed(self.root, self.blobs, [self.sha, '0' * 64])
        self.assertFalse((self.root / '.voltra').exists())

    def test_parent_symlink_rejected(self):
        (self.root / '.voltra').symlink_to(self.blobs)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            cache.seed(self.root, self.blobs, [self.sha])


if __name__ == '__main__':
    unittest.main(verbosity=2)
