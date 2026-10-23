import hashlib
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

native = types.ModuleType('native_release'); exec(NATIVE_SOURCE, native.__dict__); sys.modules['native_release'] = native
zipped = types.ModuleType('native_zip_release'); exec(ZIP_SOURCE, zipped.__dict__); sys.modules['native_zip_release'] = zipped
installer = types.ModuleType('xonotic_install'); exec(INSTALL_SOURCE, installer.__dict__)
runtime = types.ModuleType('xonotic_runtime'); exec(RUNTIME_SOURCE, runtime.__dict__)


def package(binary=b'engine', extra=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, value in {'xonotic-linux64-dedicated': binary, 'data/stock.pk3': b'data', 'COPYING': b'GPL', 'source/engine.c': b'source', **(extra or {})}.items():
            archive.writestr(zipfile.ZipInfo('Xonotic/' + name, date_time=(2020, 1, 1, 0, 0, 0)), value)
    return output.getvalue()


class XonoticInstallerTests(unittest.TestCase):
    def test_darkplaces_quoting_and_config_preserve_native_data(self):
        self.assertEqual(runtime.quoted('literal $name "quote" \\path;value'), '"literal $$name \\"quote\\" \\\\path;value"')
        for value in ['bad\ncommand', 'bad\x00command', 'x' * 256, '\u00e4' * 128]:
            with self.assertRaises(ValueError): runtime.quoted(value)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); folder = root / '.xonotic/data'; folder.mkdir(parents=True)
            (folder / 'server.cfg').write_bytes(b'operator config')
            with zipfile.ZipFile(folder / 'custom.pk3', 'w') as archive:
                archive.writestr('maps/stormkeep.bsp', b'custom map')
            env = {'SERVER_PORT': '23560', 'SERVER_NAME': 'literal $name "quoted"', 'MIN_PLAYERS': '2'}
            argv = runtime.configure(env, root)
            managed = folder / 'voltra-managed.cfg'; before = managed.stat().st_mtime_ns
            self.assertIn('hostname "literal $$name \\"quoted\\""', managed.read_text())
            self.assertIn('rcon_secure 2', managed.read_text())
            self.assertEqual(managed.stat().st_mode & 0o777, 0o600)
            self.assertEqual((root / '.voltra/xonotic/rcon-password').stat().st_mode & 0o777, 0o600)
            self.assertEqual((folder / 'server.cfg').read_bytes(), b'operator config')
            self.assertEqual(runtime.configure(env, root), argv)
            self.assertEqual(managed.stat().st_mtime_ns, before)
            self.assertEqual(argv[argv.index('-userdir') + 1], str(root / '.xonotic'))
            self.assertLess(argv.index('+sv_public'), argv.index('+startmap_dm'))
            self.assertLess(argv.index('+port'), argv.index('+startmap_dm'))
            self.assertLess(argv.index('+startmap_dm'), argv.index('+exec'))
            self.assertLess(argv.index('+exec'), argv.index('+map'))
            for key, value in [('SERVER_NAME', 'bad\\name'), ('RCON_PASSWORD', 'two passwords'), ('MAX_PLAYERS', '100'), ('MIN_PLAYERS', '17'), ('MIN_PLAYERS_PER_TEAM', '17'), ('BOT_JOIN_EMPTY', 'true'), ('GAME_MAP', '../map'), ('GAME_MAP', 'missing'), ('PUBLIC_SERVER', 'true'), ('BOT_SKILL', '11'), ('GAME_TYPE', 'unknown')]:
                with self.assertRaises(ValueError): runtime.configure({**env, key: value}, root)

    def install(self, root, body, fail_receipt=False):
        release = {'version': 'fixture', 'channel': 'release', 'url': 'https://fixture.invalid/release.zip', 'sha512': hashlib.sha512(body).hexdigest()}
        def fetch(url, destination):
            destination.write_bytes(body)
            return hashlib.sha512(body).hexdigest()
        replace = installer.os.replace
        def publish(source, destination):
            if fail_receipt and Path(source).name == 'receipt.json':
                raise OSError('fixture publication failure')
            return replace(source, destination)
        with patch.object(installer, 'resolve_release', return_value=release), patch.object(installer, 'fetch', side_effect=fetch), patch.object(installer.os, 'replace', side_effect=publish):
            installer.install(root, {})

    def test_default_is_pinned_stable_and_invalid_selection_rejected(self):
        with patch.object(installer, 'fetch', side_effect=AssertionError('no network needed')):
            value = installer.resolve_release({})
            self.assertEqual(value['version'], '0.8.6')
            self.assertEqual(value['sha512'], installer.STABLE_SHA512)
            for env in [{'VERSION': '../oops'}, {'UPDATE_CHANNEL': 'other'}]:
                with self.assertRaises(ValueError): installer.resolve_release(env)

    def test_autobuild_checksum_selection(self):
        checksum = 'a' * 128
        with patch.object(installer, 'fetch', return_value=checksum + '  Xonotic-latest.zip\n'):
            self.assertEqual(installer.resolve_release({'UPDATE_CHANNEL': 'autobuild'})['sha512'], checksum)
        for body in ['', checksum + '  wrong.zip\n', (checksum + '  Xonotic-latest.zip\n') * 2]:
            with patch.object(installer, 'fetch', return_value=body):
                with self.assertRaises(ValueError): installer.resolve_release({'UPDATE_CHANNEL': 'autobuild'})

    def test_install_preserves_source_userdata_operator_changes_and_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            userdata = root / '.xonotic/data/server.cfg'; userdata.parent.mkdir(parents=True); userdata.write_bytes(b'private operator config')
            self.install(root, package())
            self.assertEqual((root / 'xonotic/source/engine.c').read_bytes(), b'source')
            self.assertEqual((root / 'xonotic/xonotic-linux64-dedicated').stat().st_mode & 0o777, 0o755)
            (root / 'xonotic/data/custom.pk3').write_bytes(b'custom')
            (root / 'xonotic/data/stock.pk3').write_bytes(b'modified stock')
            self.install(root, package(b'engine two'))
            self.assertEqual((root / 'xonotic/data/stock.pk3').read_bytes(), b'modified stock')
            self.assertEqual((root / 'xonotic/data/custom.pk3').read_bytes(), b'custom')
            self.assertEqual(userdata.read_bytes(), b'private operator config')
            self.assertTrue(list((root / '.voltra/xonotic').glob('previous-*')))
            before = (root / '.voltra/xonotic/release.json').read_bytes()
            self.install(root, package(b'engine two'))
            self.assertEqual(before, (root / '.voltra/xonotic/release.json').read_bytes())

    def test_receipt_publication_failure_rolls_back_engine_and_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); self.install(root, package())
            before = (root / '.voltra/xonotic/release.json').read_bytes()
            with self.assertRaises(OSError): self.install(root, package(b'new engine'), True)
            self.assertEqual((root / 'xonotic/xonotic-linux64-dedicated').read_bytes(), b'engine')
            self.assertEqual((root / '.voltra/xonotic/release.json').read_bytes(), before)

    def test_checksum_failure_has_no_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(installer, 'resolve_release', return_value={'url': 'https://fixture.invalid', 'sha512': 'bad'}), patch.object(installer, 'fetch', return_value='wrong'):
                with self.assertRaises(ValueError): installer.install(root, {})
            self.assertFalse((root / 'xonotic').exists())

    def test_safe_internal_links_and_unsafe_archives(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for target in ['script.sh', '../../../../outside']:
                archive = root / 'release.zip'
                with zipfile.ZipFile(archive, 'w') as out:
                    out.writestr('Xonotic/misc/script.sh', b'publisher script')
                    link = zipfile.ZipInfo('Xonotic/misc/link.sh'); link.create_system = 3; link.external_attr = (stat.S_IFLNK | 0o777) << 16
                    out.writestr(link, target)
                ready = root / ('safe' if target == 'script.sh' else 'unsafe'); ready.mkdir()
                if target == 'script.sh':
                    installer.unpack(archive, ready)
                    self.assertEqual((ready / 'misc/link.sh').read_bytes(), b'publisher script')
                    self.assertFalse((ready / 'misc/link.sh').is_symlink())
                else:
                    with self.assertRaises(ValueError): installer.unpack(archive, ready)

    def test_linux_package_omits_macos_framework_directory_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); archive = root / 'release.zip'; ready = root / 'ready'; ready.mkdir()
            with zipfile.ZipFile(archive, 'w') as out:
                out.writestr('Xonotic/COPYING', b'GPL')
                out.writestr('Xonotic/source/engine.c', b'publisher source')
                link = zipfile.ZipInfo('Xonotic/Xonotic.app/Contents/Frameworks/SDL2.framework/Versions/Current')
                link.create_system = 3; link.external_attr = (stat.S_IFLNK | 0o777) << 16
                out.writestr(link, 'A')
            installer.unpack(archive, ready)
            self.assertFalse((ready / 'Xonotic.app').exists())
            self.assertEqual((ready / 'COPYING').read_bytes(), b'GPL')
            self.assertEqual((ready / 'source/engine.c').read_bytes(), b'publisher source')


unittest.main()
