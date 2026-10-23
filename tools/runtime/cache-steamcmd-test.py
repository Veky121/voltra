#!/usr/bin/env python3
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('steam_cache', Path(__file__).with_name('cache-steamcmd.py'))
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class SteamCacheTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'volume'
        self.root.mkdir()
        self.blob = Path(self.temp.name) / 'bootstrap.tgz'

    def archive(self, extras=()):
        with tarfile.open(self.blob, 'w:gz') as output:
            for name, data in [('steamcmd.sh', b'#!/bin/sh\nexec ./linux32/steamcmd "$@"\n'), ('linux32/steamcmd', b'native fixture')]:
                info = tarfile.TarInfo(name)
                info.size, info.mode = len(data), 0o644
                output.addfile(info, io.BytesIO(data))
            for extra in extras:
                output.addfile(extra, io.BytesIO(b'x' * extra.size))
        return hashlib.sha256(self.blob.read_bytes()).hexdigest()

    def stage(self, digest):
        return cache.provision(self.root, self.blob, digest, 'https://publisher.example/bootstrap.tgz', '2026-10-23T00:00:00Z')

    def test_fresh_bootstrap_has_independent_files_and_receipt(self):
        digest = self.archive()
        result = self.stage(digest)
        self.assertTrue(result['steamcmd_self_updates_enabled'])
        self.assertFalse(result['game_download_cache_used'])
        self.assertEqual((self.root / '.voltra/steamcmd/steamcmd.sh').stat().st_mode & 0o777, 0o755)
        self.assertEqual(json.loads((self.root / '.voltra/steamcmd-bootstrap.json').read_text())['sha256'], digest)
        self.assertEqual(hashlib.sha256(self.blob.read_bytes()).hexdigest(), digest)

    def test_existing_bootstrap_is_not_overwritten(self):
        digest = self.archive()
        self.stage(digest)
        with self.assertRaisesRegex(ValueError, 'must not be replaced'):
            self.stage(digest)

    def test_invalid_digest_does_not_publish(self):
        self.archive()
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.stage('0' * 64)
        self.assertFalse((self.root / '.voltra').exists())

    def test_unsafe_archives_do_not_publish(self):
        traversal = tarfile.TarInfo('../escape')
        traversal.size = 1
        link = tarfile.TarInfo('link')
        link.type, link.linkname = tarfile.SYMTYPE, '/tmp'
        for member in (traversal, link):
            with self.subTest(member=member.name):
                digest = self.archive([member])
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    self.stage(digest)
                self.assertFalse((self.root / '.voltra/steamcmd').exists())

    def test_duplicate_archive_rejected(self):
        duplicate = tarfile.TarInfo('steamcmd.sh')
        digest = self.archive([duplicate])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.stage(digest)

    def test_actual_acquired_bootstrap_can_be_staged(self):
        acquisition = Path('/workspace/.local/cache-steamcmd/acquisition.json')
        if not acquisition.is_file():
            self.skipTest('Real public acquisition not mounted')
        record = json.loads(acquisition.read_text())
        self.blob = acquisition.with_name('steamcmd_linux.tar.gz')
        result = self.stage(record['sha256'])
        self.assertTrue((self.root / '.voltra/steamcmd/linux32/steamcmd').stat().st_size > 1000)
        self.assertEqual(result['sha256'], record['sha256'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
