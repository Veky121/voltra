"""Offline SpongeVanilla fixtures. No game process or network acceptance."""
import importlib.util
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


load('minecraft_install', 'internal/panel/game_library/minecraft-install.py')
for name in ['limbo', 'paper-family', 'hybrid-java', 'spongevanilla']:
    adapter = load(name.replace('-', '_') + '_install', f'internal/panel/game_library/scripts/{name}-install.py')


class SpongeTests(unittest.TestCase):
    def test_publisher_modes_exact_and_no_fallback(self):
        row = {'coordinates': {'version': 'test-release'}, 'tags': {'minecraft': 'test-mc'},
               'assets': [{'extension': 'jar', 'classifier': 'universal', 'sha1': 'a'*40, 'downloadUrl': 'https://repo.spongepowered.org/test.jar'}]}
        with patch.object(adapter.shared, 'metadata', return_value=row) as metadata, patch.object(adapter.shared, 'public_url', side_effect=lambda x: x):
            for mode in ['recommended', 'latest', 'test-release']:
                self.assertEqual(adapter.select({'SV_VERSION': mode})['release'], 'test-release')
                self.assertIn('recommended=true' if mode == 'recommended' else 'recommended=false' if mode == 'latest' else '/versions/test-release', metadata.call_args.args[0])
            with self.assertRaises(ValueError):
                adapter.select({'SV_VERSION': 'missing'})
            row['assets'] *= 2
            with self.assertRaises(ValueError):
                adapter.select({'SV_VERSION': 'latest'})
        with patch.object(adapter.shared, 'metadata', side_effect=RuntimeError('publisher unavailable')):
            with self.assertRaises(RuntimeError):
                adapter.select({'SV_VERSION': 'recommended'})

    def test_preservation_checksum_and_repeat_install(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as jar:
            jar.writestr('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\nMain-Class: example.Main\n')
            jar.writestr('example/Main.class', bytes.fromhex('cafebabe00000041'))
        data = output.getvalue()
        release = dict(project='spongevanilla', release='fixture', version='fixture', url='https://example.org/test.jar', algorithm='sha1', hash=hashlib.sha1(data).hexdigest(), sha256=hashlib.sha256(data).hexdigest())
        with tempfile.TemporaryDirectory() as temp, patch.object(adapter, 'select', return_value=release), patch.object(adapter.shared, 'fetch', return_value=data) as fetch:
            root = Path(temp)
            preserved = {'eula.txt': b'eula=false\n', 'server.properties': b'unknown=keep\nrcon.password=secret\n', 'world/level.dat': b'save', 'mods/plugin.jar': b'plugin', 'config/sponge/launch.properties': b'custom=true\n'}
            for name, contents in preserved.items():
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(contents)
            adapter.install(root, {'SERVER_JARFILE': 'operator-server'})
            adapter.install(root, {'SERVER_JARFILE': 'operator-server'})
            self.assertEqual(fetch.call_count, 1)
            for name, contents in preserved.items():
                self.assertEqual((root / name).read_bytes(), contents)
            self.assertEqual((root / 'operator-server').read_bytes(), data)
            for name in ['server.properties', 'eula.txt', 'ops.json', '../escape', 'world']:
                with self.assertRaises(ValueError):
                    adapter.install(root, {'SERVER_JARFILE': name})
            release['sha256'] = '0'*64
            with self.assertRaises(ValueError):
                adapter.install(root, {'SERVER_JARFILE': 'operator-server'})
            self.assertEqual((root / 'operator-server').read_bytes(), data)

    def test_staged_controls_and_authority(self):
        recipe = 'minecraft/java/spongevanilla/egg-sponge-vanilla.json'
        profile = json.loads((ROOT / 'artifacts/game-parity-20261029/spongevanilla-profile.json').read_text())[recipe]
        egg = profile['egg']
        self.assertEqual({v['env_variable'] for v in egg['variables']}, {'SERVER_JARFILE', 'SV_VERSION'})
        self.assertIn('eula', egg['features'])
        self.assertEqual(egg['config']['stop'], 'stop')
        self.assertIn(')! For help, type ', json.loads(egg['config']['startup'])['done'])
        self.assertEqual(set(json.loads(egg['config']['files'])['server.properties']['find']), {'server-ip', 'server-port', 'query.port'})
        self.assertIn('spongevanilla_install.py', egg['scripts']['installation']['script'])
        self.assertEqual(profile['verification'], 'not_verified')


if __name__ == '__main__':
    unittest.main()
