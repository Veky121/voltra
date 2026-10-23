#!/usr/bin/env python3
"""Offline cache integrity, contention and writable-copy acceptance."""
import concurrent.futures
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('download_cache', Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/download-cache.py')
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class CacheTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.write_bytes(b'public immutable artifact\n' * 5000)
        self.sha = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.directory = self.root / 'cache'

    def seed(self, **kwargs):
        return cache.cached(self.directory, self.sha, source=self.source, **kwargs)

    def test_writable_copy_does_not_change_cached_blob(self):
        blob, hit = self.seed()
        self.assertFalse(hit)
        target = self.root / 'target'
        method = cache.materialize(blob, target)
        self.assertIn(method, ('copy', 'reflink'))
        self.assertNotEqual(blob.stat().st_ino, target.stat().st_ino)
        target.write_bytes(b'game-specific mutation')
        self.assertEqual(cache.digest_file(blob), self.sha)
        self.assertTrue(self.seed()[1])

    def test_concurrent_publish_has_one_writer(self):
        # flock applies to separate opens, including threads in the same process.
        self.directory.mkdir(mode=0o700)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _: self.seed(), range(16)))
        self.assertEqual(sum(not hit for _, hit in results), 1)
        self.assertEqual(len(list((self.directory / 'sha256').iterdir())), 1)

    def test_mismatch_is_not_published(self):
        self.source.write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError, 'does not match'):
            self.seed()
        self.assertEqual(list((self.directory / 'sha256').iterdir()), [])

    def test_size_limit_is_enforced(self):
        with self.assertRaisesRegex(ValueError, 'size limit'):
            self.seed(max_bytes=1)
        self.assertEqual(list((self.directory / 'sha256').iterdir()), [])

    def test_shared_capacity_counts_other_namespace_and_inflight(self):
        other=self.directory/'steam-games/work/fixture';other.mkdir(parents=True)
        (other/'inflight').write_bytes(b'other namespace acquisition')
        with self.assertRaisesRegex(ValueError,'capacity'):
            self.seed(capacity_bytes=self.source.stat().st_size)
        self.assertEqual(list((self.directory/'sha256').iterdir()),[])
        self.assertTrue((other/'inflight').exists())

    def test_distinct_publishers_cannot_overcommit_shared_capacity(self):
        second=self.root/'second';second.write_bytes(b'x'*self.source.stat().st_size)
        def publish(source):
            try:
                return cache.cached(self.directory,cache.digest_file(source),source=source,
                                    capacity_bytes=self.source.stat().st_size+8)[1]
            except ValueError as error:
                self.assertIn('capacity',str(error));return 'capacity'
        self.directory.mkdir(mode=0o700)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results=list(executor.map(publish,[self.source,second]))
        self.assertEqual(results.count(False),1);self.assertEqual(results.count('capacity'),1)
        self.assertEqual(len(list((self.directory/'sha256').iterdir())),1)

    def test_existing_corruption_fails(self):
        blob, _ = self.seed()
        blob.chmod(0o600)
        blob.write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            self.seed()

    def test_url_credentials_and_signed_queries_rejected(self):
        for url in ('http://example.org/a', 'https://user:pass@example.org/a',
                    'https://example.org/a?token=private', 'https://example.org/a#secret'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                cache.public_url(url)

    def test_public_github_release_redirect_accepts_its_ephemeral_signature(self):
        url = 'https://release-assets.githubusercontent.com/github-production-release-asset/123/archive?sig=public-redirect-fixture'
        self.assertEqual(cache.public_url(url, redirect=True), url)
        with self.assertRaises(ValueError): cache.public_url(url)
        with self.assertRaises(ValueError): cache.public_url('https://elsewhere.example/archive?token=private', redirect=True)
        with self.assertRaises(ValueError): cache.public_url('http://release-assets.githubusercontent.com/archive?sig=value', redirect=True)

    def test_symlink_cache_and_target_rejected(self):
        actual = self.root / 'actual'
        actual.mkdir()
        self.directory.symlink_to(actual, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.seed()
        target = self.root / 'target'
        target.symlink_to(self.source)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            cache.materialize(self.source, target)

    def test_world_writable_cache_rejected(self):
        self.directory.mkdir(mode=0o777)
        self.directory.chmod(0o777)
        with self.assertRaisesRegex(ValueError, 'other users'):
            self.seed()


if __name__ == '__main__':
    unittest.main(verbosity=2)
