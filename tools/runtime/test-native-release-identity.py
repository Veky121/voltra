"""Offline Linux publication/rollback ownership checks; no game execution."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('native_release', Path('internal/panel/game_library/scripts/native-release.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
sys.modules['native_release'] = native
spec = importlib.util.spec_from_file_location('native_zip_release', Path('internal/panel/game_library/scripts/native-zip-release.py'))
zipped = importlib.util.module_from_spec(spec)
spec.loader.exec_module(zipped)


class Identity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.first = self.archive(b'old')
        self.second = self.archive(b'new')
        self.install(self.first, '1')
        self.binary = self.root / 'game/server'
        self.library = self.root / 'game/library'
        self.receipt = self.root / '.voltra/game/release.json'
        for p, mode in [(self.binary, 0o751), (self.library, 0o640), (self.receipt, 0o600)]:
            os.chown(p, 988, 988)
            p.chmod(mode)

    def archive(self, body):
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode='w') as archive:
            for name in ['server', 'library']:
                member = tarfile.TarInfo('release/' + name)
                member.size = len(body)
                member.mode = 0o755
                archive.addfile(member, io.BytesIO(body))
        return out.getvalue()

    def install(self, body, version):
        release = dict(url='https://example.invalid/fixture', version=version,
                       prefix='release', sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
        with patch.object(native.urllib.request, 'urlopen', return_value=io.BytesIO(body)):
            native.install_release(self.root, release, 'game', 'server')

    def identity(self, p):
        s = p.stat()
        return stat.S_IMODE(s.st_mode), s.st_uid, s.st_gid

    def test_update_preserves_existing_identity_and_updates_bytes(self):
        self.install(self.second, '2')
        for p, mode in [(self.binary, 0o751), (self.library, 0o640), (self.receipt, 0o600)]:
            self.assertEqual(self.identity(p), (mode, 988, 988))
        self.assertEqual(self.binary.read_bytes(), b'new')
        self.assertEqual(self.library.read_bytes(), b'new')
        saved = next((self.root / '.voltra/game').glob('previous-*/server'))
        self.assertEqual(self.identity(saved), (0o751, 988, 988))

    def test_same_version_repair_preserves_existing_binary_identity(self):
        self.library.unlink()
        self.install(self.first, '1')
        self.assertEqual(self.identity(self.binary), (0o751, 988, 988))
        self.assertEqual(self.identity(self.receipt), (0o600, 988, 988))

    def test_receipt_failure_rolls_back_bytes_and_full_identity(self):
        before = {p: (p.read_bytes(), self.identity(p)) for p in [self.binary, self.library, self.receipt]}
        replace = native.os.replace
        def fail_receipt(source, destination):
            if Path(source).name == 'receipt.json':
                raise OSError('fixture receipt publication failure')
            return replace(source, destination)
        with patch.object(native.os, 'replace', side_effect=fail_receipt):
            with self.assertRaises(OSError):
                self.install(self.second, '2')
        for p, row in before.items():
            self.assertEqual((p.read_bytes(), self.identity(p)), row)

    def test_identity_failure_leaves_existing_program_untouched(self):
        before = self.binary.read_bytes(), self.identity(self.binary), self.receipt.read_bytes()
        with patch.object(native.os, 'chown', side_effect=PermissionError('fixture denied ownership')):
            with self.assertRaises(PermissionError):
                self.install(self.second, '2')
        self.assertEqual((self.binary.read_bytes(), self.identity(self.binary), self.receipt.read_bytes()), before)

    def test_dangling_destination_symlink_refused_without_following(self):
        self.library.unlink()
        self.library.symlink_to('operator-missing')
        with self.assertRaisesRegex(ValueError, 'symbolic link'):
            self.install(self.second, '2')
        self.assertTrue(self.library.is_symlink())
        self.assertFalse((self.root / 'game/operator-missing').exists())
        self.assertEqual(self.binary.read_bytes(), b'old')


class ZipIdentity(Identity):
    def archive(self, body):
        out = io.BytesIO()
        with zipfile.ZipFile(out, mode='w') as archive:
            for name in ['server', 'library']:
                member = zipfile.ZipInfo('release/' + name)
                member.external_attr = (stat.S_IFREG | 0o755) << 16
                archive.writestr(member, body)
        return out.getvalue()

    def install(self, body, version):
        release = dict(url='https://example.invalid/fixture', version=version,
                       prefix='release', sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
        with patch.object(native.urllib.request, 'urlopen', return_value=io.BytesIO(body)):
            zipped.install_release(self.root, release, 'game', 'server')


if __name__ == '__main__':
    unittest.main()
