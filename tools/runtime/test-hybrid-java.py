import importlib.util
import io
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def load(name, source):
    spec = importlib.util.spec_from_file_location(name, ROOT / source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


load('minecraft_install', 'internal/panel/game_library/minecraft-install.py')
load('limbo_install', 'internal/panel/game_library/scripts/limbo-install.py')
load('paper_family_install', 'internal/panel/game_library/scripts/paper-family-install.py')
adapter = load('hybrid_java', 'internal/panel/game_library/scripts/hybrid-java-install.py')


def jar():
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as package:
        package.writestr('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\nMain-Class: example.Main\n')
        package.writestr('example/Main.class', bytes.fromhex('cafebabe0000003d'))
    return out.getvalue()


class HybridJavaTests(unittest.TestCase):
    def test_pinned_defaults_have_strong_identity(self):
        for project in ('arclight', 'canvas', 'spongevanilla'):
            release = adapter.select(project, {})
            self.assertEqual(release['project'], project)
            self.assertRegex(release['sha256'], r'^[0-9a-f]{64}$')
            self.assertTrue(release['url'].startswith('https://'))
        beta = adapter.arclight({'ARCLIGHT_CHANNEL': 'beta'})
        stable = adapter.arclight({'ARCLIGHT_CHANNEL': 'stable'})
        self.assertEqual(beta['channel'], 'beta')
        self.assertIn('SNAPSHOT-494b2c8', beta['release'])
        self.assertEqual(stable['channel'], 'stable')
        self.assertNotEqual(beta['sha256'], stable['sha256'])

    def test_arclight_original_loader_channels_and_build_directory(self):
        def metadata(url):
            if url.endswith('/forge'):
                return {'files': [{'name': 'versions-snapshot', 'type': 'directory'}]}
            return {'files': [{'name': 'old.jar', 'last-modified': '2025'}, {'name': 'new.jar', 'last-modified': '2026'}]}
        with mock.patch.object(adapter, 'metadata', side_effect=metadata), mock.patch.object(adapter, 'public_url', side_effect=lambda x: x):
            selected = adapter.arclight({'MINECRAFT_VERSION': '1.20.1', 'ARCLIGHT_LOADER': 'forge', 'ARCLIGHT_CHANNEL': 'beta'})
            self.assertTrue(selected['url'].endswith('/versions-snapshot/new.jar'))
            with self.assertRaises(ValueError):
                adapter.arclight({'MINECRAFT_VERSION': '1.20.1', 'ARCLIGHT_CHANNEL': 'stable'})
        with self.assertRaises(ValueError):
            adapter.arclight({'ARCLIGHT_LOADER': '../../forge'})

    def test_arclight_auto_chooses_loader_supported_version(self):
        def metadata(url):
            if url == adapter.ARCLIGHT:
                return {'files': [{'name': '26.1.2'}, {'name': '1.21.1'}]}
            if url.endswith('/26.1.2/loaders'):
                return {'files': [{'name': 'fabric'}]}
            if url.endswith('/loaders'):
                return {'files': [{'name': 'neoforge'}]}
            return {'files': [{'name': 'latest-stable', 'type': 'link'}]}
        with mock.patch.object(adapter, 'metadata', side_effect=metadata), mock.patch.object(adapter, 'public_url', side_effect=lambda x: x):
            release = adapter.arclight({'ARCLIGHT_LOADER': 'neoforge'})
            self.assertEqual(release['version'], '1.21.1')

    def test_arclight_custom_download_preserves_original_controls(self):
        with mock.patch.object(adapter, 'public_url', side_effect=lambda x: x):
            release = adapter.arclight({'DOWNLOAD_URL': 'https://publisher.invalid/custom.jar', 'ARCLIGHT_LOADER': 'fabric', 'MINECRAFT_VERSION': '1.21.1'})
        self.assertTrue(release['custom'])
        self.assertEqual(release['loader'], 'fabric')

    def test_canvas_exact_and_latest_original_controls(self):
        row = {'result': 'SUCCESS', 'channelVersion': '1.21.11', 'buildNumber': 800, 'downloadUrl': 'https://publisher.invalid/canvas.jar'}
        with mock.patch.object(adapter, 'metadata', return_value=row), mock.patch.object(adapter, 'public_url', side_effect=lambda x: x):
            release = adapter.canvas({'MC_VERSION': '1.21.11', 'CANVAS_BUILD': 'latest'})
            self.assertEqual(release['build'], '800')
            release = adapter.canvas({'CANVAS_BUILD': '790'})
            self.assertEqual(release['version'], '1.21.11')
            self.assertIn('/790/artifact/', release['url'])
        with self.assertRaises(ValueError):
            adapter.canvas({'MC_VERSION': '1.21.11', 'CANVAS_BUILD': '../991'})

    def test_sponge_exact_latest_and_ambiguous_assets(self):
        row = {'assets': [{'extension': 'jar', 'classifier': 'universal', 'downloadUrl': 'https://publisher.invalid/sponge.jar', 'sha1': 'a' * 40}], 'coordinates': {'version': '1.20.6-11.0.0'}, 'tags': {'minecraft': '1.20.6'}}
        with mock.patch.object(adapter, 'metadata', return_value=row) as metadata, mock.patch.object(adapter, 'public_url', side_effect=lambda x: x):
            self.assertEqual(adapter.sponge({'SV_VERSION': '1.20.6-11.0.0'})['version'], '1.20.6')
            self.assertIn('/versions/1.20.6-11.0.0', metadata.call_args.args[0])
            adapter.sponge({'SV_VERSION': 'latest'})
            self.assertTrue(metadata.call_args.args[0].endswith('recommended=false'))
            row['assets'].append(row['assets'][0])
            with self.assertRaises(ValueError):
                adapter.sponge({'SV_VERSION': 'latest'})

    def test_program_cache_preserves_operator_files_and_eula(self):
        data = jar()
        release = {'project': 'canvas', 'version': '26.3', 'url': 'https://publisher.invalid/server.jar', 'sha256': hashlib.sha256(data).hexdigest()}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('eula.txt', 'server.properties', 'plugins/plugin.jar', 'mods/mod.jar', 'world/level.dat', 'libraries/operator.jar'):
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('operator')
            with mock.patch.object(adapter, 'select', return_value=release.copy()), mock.patch.object(adapter, 'fetch', return_value=data) as download:
                adapter.install(root, 'canvas', {})
                adapter.install(root, 'canvas', {})
                self.assertEqual(download.call_count, 1)
            self.assertTrue(all(p.read_text() == 'operator' for p in root.rglob('*') if p.is_file() and p.name not in ('server.jar', 'download.jar', 'release.json')))

    def test_hash_failure_and_symlink_prevalidation_do_not_replace_program(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'server.jar').write_bytes(b'old program')
            release = {'version': '26.3', 'url': 'https://publisher.invalid/jar', 'sha256': 'f' * 64}
            with mock.patch.object(adapter, 'select', return_value=release), mock.patch.object(adapter, 'fetch', return_value=jar()):
                with self.assertRaises(ValueError):
                    adapter.install(root, 'canvas', {})
            self.assertEqual((root / 'server.jar').read_bytes(), b'old program')
            (root / 'server.properties').symlink_to('/tmp/outside-hybrid-config')
            with mock.patch.object(adapter, 'select', return_value=release), mock.patch.object(adapter, 'fetch') as download:
                with self.assertRaises(ValueError):
                    adapter.install(root, 'canvas', {})
                download.assert_not_called()

    def test_original_sponge_filename_without_extension_matches_startup(self):
        data = jar()
        release = {'version': '1.21.10', 'url': 'https://publisher.invalid/sponge.jar', 'sha256': hashlib.sha256(data).hexdigest()}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with mock.patch.object(adapter, 'select', return_value=release), mock.patch.object(adapter, 'fetch', return_value=data):
                adapter.install(root, 'spongevanilla', {'SERVER_JARFILE': 'operator-server'})
            self.assertEqual((root / 'operator-server').read_bytes(), data)
            self.assertFalse((root / 'operator-server.jar').exists())


if __name__ == '__main__':
    unittest.main()
