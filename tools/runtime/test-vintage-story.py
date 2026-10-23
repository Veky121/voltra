import contextlib
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

installer = {'__name__': 'fixture'}
exec(INSTALL_SOURCE, installer)
runtime = {'__name__': 'fixture'}
exec(RUNTIME_SOURCE, runtime)


def archive(extra=None):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as output:
        for name, value in {'VintagestoryServer.dll': b'engine',
                            'VintagestoryServer.runtimeconfig.json': b'{}',
                            'assets/fixture.json': b'{}', **(extra or {})}.items():
            info = tarfile.TarInfo(name)
            info.size = len(value)
            output.addfile(info, io.BytesIO(value))
    return stream.getvalue()


class VintageStoryTests(unittest.TestCase):
    def test_native_arguments_are_literal(self):
        env = {'SERVER_PORT': '23560', 'MAX_CLIENTS': '17',
               'OPTIONS': '--name "literal $value; $(touch injected)"'}
        args = runtime['arguments'](env, Path('/server'))
        self.assertEqual(args[-1], 'literal $value; $(touch injected)')
        self.assertIn('--maxclients=17', args)
        self.assertIn('/server/data', args)

    def test_invalid_bounds_and_multiline_options(self):
        for changes in ({'MAX_CLIENTS': '0'}, {'MAX_CLIENTS': '257'},
                        {'SERVER_PORT': '65536'}, {'OPTIONS': 'bad\nflag'},
                        {'OPTIONS': '"unclosed'}):
            with self.assertRaises(ValueError):
                runtime['arguments']({'SERVER_PORT': '23560', **changes}, Path('/server'))

    def test_selection_uses_unique_latest_and_https(self):
        entry = {'latest': 1, 'md5': 'a' * 32,
                 'urls': {'cdn': 'https://cdn.vintagestory.at/gamefiles/stable/vs_server_linux-x64_1.22.7.tar.gz'}}
        with patch.dict(installer, request=lambda url: io.BytesIO(json.dumps({'1.22.7': {'linuxserver': entry}}).encode())):
            self.assertEqual(installer['select_release']('stable', 'latest')['version'], '1.22.7')
        with self.assertRaises(ValueError):
            installer['select_release']('pre', 'latest')
        with self.assertRaises(ValueError):
            installer['select_release']('stable', '../../escape')

    def test_explicit_pre_retained_without_invented_checksum(self):
        with patch.dict(installer, request=lambda url: io.BytesIO(b'{}')):
            result = installer['select_release']('pre', '1.23.0-pre.1')
        self.assertIsNone(result['md5'])
        self.assertIn('/pre/', result['url'])

    def test_staged_install_cache_and_update_preserve_data(self):
        body = archive()
        release = {'branch': 'stable', 'version': '1.0.0', 'url': 'https://fixture.invalid/a',
                   'md5': hashlib.md5(body).hexdigest()}
        with tempfile.TemporaryDirectory() as directory, patch.dict(installer, request=lambda url: io.BytesIO(body)):
            root = Path(directory)
            (root / 'data/Mods').mkdir(parents=True)
            (root / 'data/Mods/operator.zip').write_bytes(b'keep mod')
            (root / 'data/world.db').write_bytes(b'keep save')
            installer['install'](root, release)
            current = root / '.voltra/vintage-story/current'
            (current / 'assets/operator.json').write_bytes(b'keep override')
            with patch.dict(installer, request=lambda url: self.fail('Cached install downloaded again')):
                installer['install'](root, release)
            self.assertEqual((current / 'assets/operator.json').read_bytes(), b'keep override')
            installer['install'](root, {**release, 'version': '1.0.1'})
            backups = list((root / '.voltra/vintage-story').glob('previous-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual((backups[0] / 'assets/operator.json').read_bytes(), b'keep override')
            self.assertEqual((root / 'data/world.db').read_bytes(), b'keep save')
            self.assertEqual((root / 'data/Mods/operator.zip').read_bytes(), b'keep mod')

    def test_bad_download_never_changes_current(self):
        for body, checksum in ((archive(), '0' * 32),
                               (archive({'../escape': b'bad'}), None)):
            release = {'branch': 'stable', 'version': '1.0.0', 'url': 'https://fixture.invalid/a',
                       'md5': checksum or hashlib.md5(body).hexdigest()}
            with tempfile.TemporaryDirectory() as directory, patch.dict(installer, request=lambda url: io.BytesIO(body)):
                root = Path(directory)
                current = root / '.voltra/vintage-story/current'
                current.mkdir(parents=True)
                (current / 'original').write_bytes(b'keep')
                with self.assertRaises(ValueError):
                    installer['install'](root, release)
                self.assertEqual((current / 'original').read_bytes(), b'keep')
                self.assertFalse((root / '.voltra/vintage-story/escape').exists())

    def test_publication_failure_restores_previous_release(self):
        body = archive()
        release = {'branch': 'stable', 'version': '1.0.0', 'url': 'https://fixture.invalid/a',
                   'md5': hashlib.md5(body).hexdigest()}
        with tempfile.TemporaryDirectory() as directory, patch.dict(installer, request=lambda url: io.BytesIO(body)):
            root = Path(directory)
            current = root / '.voltra/vintage-story/current'
            current.mkdir(parents=True)
            (current / 'original').write_bytes(b'keep')
            with patch.object(installer['os'], 'replace', side_effect=OSError('fixture publication failure')):
                with self.assertRaises(OSError):
                    installer['install'](root, release)
            self.assertEqual((current / 'original').read_bytes(), b'keep')


unittest.main()
