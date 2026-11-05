"""Shared GE-Proton missing-loader preflight, pure local archive fixtures."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('proton_preflight', BASE / 'internal/panel/game_library/scripts/enshrouded-proton.py')
proton = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proton)


class Loader(unittest.TestCase):
    def test_missing_loader_retains_fresh_and_existing_partial_tree(self):
        for partial in (False, True):
            with self.subTest(partial=partial), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                if partial:
                    target = root / '.voltra/proton' / proton.VERSION / 'proton'
                    target.parent.mkdir(parents=True)
                    target.write_bytes(b'existing partial operator bytes')
                before = {str(file.relative_to(root)): file.read_bytes() for file in root.rglob('*') if file.is_file()}
                paths = {str(file.relative_to(root)) for file in root.rglob('*')}
                with patch.object(proton, 'VULKAN_LIBRARY', root / 'missing.so'), patch.object(proton.urllib.request, 'urlopen') as acquire:
                    with self.assertRaisesRegex(ValueError, 'libvulkan1'):
                        proton.provision(root)
                    acquire.assert_not_called()
                self.assertEqual(before, {str(file.relative_to(root)): file.read_bytes() for file in root.rglob('*') if file.is_file()})
                self.assertEqual(paths, {str(file.relative_to(root)) for file in root.rglob('*')})

    def test_valid_loader_copies_and_commits_receipt_then_cached_return_works(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            loader = root / 'fixture-libvulkan.so.1'
            loader.write_bytes(b'fixture loader')
            sdk = root / '.steam/sdk64/steamclient.so'
            sdk.parent.mkdir(parents=True)
            sdk.write_bytes(b'SteamUtils011 fixture SDK')
            archive = io.BytesIO()
            with tarfile.open(fileobj=archive, mode='w:gz') as stream:
                for relative, body in [('proton', b'fixture program'), ('files/lib/wine/x86_64-unix/lsteamclient.so', b'SteamUtils011 fixture bridge'), ('LICENSE', b'fixture license text')]:
                    member = tarfile.TarInfo(proton.ARCHIVE_ROOT + '/' + relative)
                    member.size = len(body)
                    member.mode = 0o755
                    stream.addfile(member, io.BytesIO(body))
            data = archive.getvalue()
            first, second = hashlib.sha256(data).hexdigest(), hashlib.sha512(data).hexdigest()
            cache = root / '.voltra/public-cache' / first
            cache.parent.mkdir(parents=True)
            cache.write_bytes(data)
            with patch.object(proton, 'VULKAN_LIBRARY', loader), patch.object(proton, 'SHA256', first), patch.object(proton, 'SHA512', second), patch.object(proton.urllib.request, 'urlopen') as acquire:
                receipt = proton.provision(root)
                acquire.assert_not_called()
                self.assertTrue(receipt['cache_hit'])
                self.assertEqual((root / '.voltra/proton/lib/libvulkan.so.1').read_bytes(), loader.read_bytes())
                self.assertTrue((root / '.voltra/proton/release.json').is_file())
                self.assertEqual(proton.location(root).read_bytes(), b'fixture program')
                with patch.object(proton, 'VULKAN_LIBRARY', root / 'now-absent.so'):
                    self.assertEqual(proton.provision(root), receipt)


if __name__ == '__main__':
    unittest.main()
