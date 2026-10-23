import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

native = types.ModuleType('native_release')
exec(NATIVE_SOURCE, native.__dict__)
sys.modules['native_release'] = native
installer = types.ModuleType('ddnet_install')
exec(INSTALL_SOURCE, installer.__dict__)
sys.modules['ddnet_install'] = installer
runtime = {'__name__': 'fixture'}
exec(RUNTIME_SOURCE, runtime)


def archive(binary=b'engine one', library=b'library one'):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:xz') as output:
        for name, data in {'DDNet-Server': binary, 'library': library,
                           'data/maps/Sunny Side Up.map': b'original map',
                           'data/autoexec_server.cfg': b'# original configuration'}.items():
            info = tarfile.TarInfo('release/' + name)
            info.size = len(data)
            info.mode = 0o755 if name == 'DDNet-Server' else 0o644
            output.addfile(info, io.BytesIO(data))
    return stream.getvalue()


class DDNetTests(unittest.TestCase):
    def release(self, body, version='20.1.1'):
        return {'version': version, 'prefix': 'release', 'url': 'https://fixture.invalid/release',
                'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)}

    def test_native_literal_text_and_byte_bounds(self):
        quoted = runtime['quote']('literal "; shutdown; " $safe 世界', 127)
        self.assertIn('\\"; shutdown; \\"', quoted)
        for text, limit in [('世' * 43, 127), ('bad\ncommand', 255), ('bad\x00text', 255)]:
            with self.assertRaises(ValueError):
                runtime['quote'](text, limit)

    def test_native_controls_and_private_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'ddnet/maps').mkdir(parents=True)
            (root / 'ddnet/maps/Sunny Side Up.map').write_bytes(b'map')
            env = {'SERVER_PORT': '23560', 'MAX_PLAYERS': '128'}
            argv = runtime['arguments'](env, root)
            self.assertIn('sv_max_clients 128', argv)
            self.assertIn('sv_register 0', argv)
            self.assertIn('sv_sixup 1', argv)
            self.assertIn('sv_test_cmds 0', argv)
            self.assertNotIn('-f', argv)
            credential = root / '.voltra/ddnet/rcon-password'
            self.assertEqual(credential.stat().st_mode & 0o777, 0o600)
            self.assertEqual(runtime['arguments'](env, root), argv)
            for values in ({'MAX_PLAYERS': '129'}, {'SERVER_PORT': '0'}, {'SERVER_MAP': '../map'},
                           {'SERVER_MAP': 'absent'}, {'PUBLIC_SERVER': 'true'}, {'SIXUP': '2'}, {'TEST_COMMANDS': 'true'}):
                with self.assertRaises(ValueError):
                    runtime['arguments']({**env, **values}, root)

    def test_pinned_and_publisher_latest_selection(self):
        pinned = installer.select_release('20.1.1')
        self.assertEqual(pinned['bytes'], 45927396)
        def fixture(url):
            return '<a href="DDNet-20.2-linux_x86_64.tar.xz">Linux</a>' if url.endswith('/downloads/') else 'a' * 64 + '  DDNet-20.2-linux_x86_64.tar.xz\n'
        with patch.object(installer, 'text', side_effect=fixture):
            latest = installer.select_release('latest')
            self.assertEqual(latest['version'], '20.2')
            self.assertEqual(latest['sha256'], 'a' * 64)
        with self.assertRaises(ValueError):
            installer.select_release('../escape')

    def test_extraction_rejects_traversal_and_links(self):
        for name, kind in [('release/../escape', tarfile.REGTYPE), ('release/link', tarfile.SYMTYPE), ('/escape', tarfile.REGTYPE)]:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with tarfile.open(root / 'archive', 'w') as output:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    output.addfile(member, io.BytesIO())
                with self.assertRaises(ValueError):
                    native.extract(root / 'archive', root / 'target', 'release')

    def test_cache_preserves_operator_files(self):
        body = archive()
        with tempfile.TemporaryDirectory() as directory, patch.object(native.urllib.request, 'urlopen', side_effect=lambda *a, **k: io.BytesIO(body)):
            root = Path(directory)
            native.install_release(root, self.release(body), 'ddnet', 'DDNet-Server')
            target = root / 'ddnet'
            (target / 'scores.sqlite').write_bytes(b'operator database')
            (target / 'data/autoexec_server.cfg').write_bytes(b'operator cfg')
            (target / 'data/maps/Sunny Side Up.map').write_bytes(b'operator map')
            with patch.object(native.urllib.request, 'urlopen', side_effect=AssertionError('Cached release should not download')):
                native.install_release(root, self.release(body), 'ddnet', 'DDNet-Server')
            self.assertEqual((target / 'scores.sqlite').read_bytes(), b'operator database')
            self.assertEqual((target / 'data/autoexec_server.cfg').read_bytes(), b'operator cfg')
            self.assertEqual((target / 'data/maps/Sunny Side Up.map').read_bytes(), b'operator map')

    def test_update_retains_overrides_and_backs_up_managed_files(self):
        first, second = archive(), archive(b'engine two', b'library two')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(native.urllib.request, 'urlopen', return_value=io.BytesIO(first)):
                native.install_release(root, self.release(first), 'ddnet', 'DDNet-Server')
            (root / 'ddnet/library').write_bytes(b'operator override')
            with patch.object(native.urllib.request, 'urlopen', return_value=io.BytesIO(second)):
                native.install_release(root, self.release(second, '20.2'), 'ddnet', 'DDNet-Server')
            self.assertEqual((root / 'ddnet/DDNet-Server').read_bytes(), b'engine two')
            self.assertEqual((root / 'ddnet/library').read_bytes(), b'operator override')
            backups = list((root / '.voltra/ddnet').glob('previous-*/DDNet-Server'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), b'engine one')

    def test_bad_checksum_leaves_existing_binary_unchanged(self):
        body = archive()
        with tempfile.TemporaryDirectory() as directory, patch.object(native.urllib.request, 'urlopen', return_value=io.BytesIO(body)):
            root = Path(directory)
            (root / 'ddnet').mkdir()
            (root / 'ddnet/DDNet-Server').write_bytes(b'keep original')
            with self.assertRaises(ValueError):
                native.install_release(root, {**self.release(body), 'sha256': '0' * 64}, 'ddnet', 'DDNet-Server')
            self.assertEqual((root / 'ddnet/DDNet-Server').read_bytes(), b'keep original')

    def test_publication_failure_restores_previous_release(self):
        first, second = archive(), archive(b'engine two', b'library two')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(native.urllib.request, 'urlopen', return_value=io.BytesIO(first)):
                native.install_release(root, self.release(first), 'ddnet', 'DDNet-Server')
            receipt = (root / '.voltra/ddnet/release.json').read_bytes()
            replace = native.os.replace
            def publish(source, destination):
                if Path(source).name == 'receipt.json':
                    raise OSError('Fixture publication failure')
                return replace(source, destination)
            with patch.object(native.urllib.request, 'urlopen', return_value=io.BytesIO(second)), patch.object(native.os, 'replace', side_effect=publish):
                with self.assertRaises(OSError):
                    native.install_release(root, self.release(second, '20.2'), 'ddnet', 'DDNet-Server')
            self.assertEqual((root / 'ddnet/DDNet-Server').read_bytes(), b'engine one')
            self.assertEqual((root / 'ddnet/library').read_bytes(), b'library one')
            self.assertEqual((root / '.voltra/ddnet/release.json').read_bytes(), receipt)


unittest.main()
