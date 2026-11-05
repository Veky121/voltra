"""Offline actual INI file behavior, no game acquisition or process."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('astro', BASE/'internal/panel/game_library/scripts/astroneer-parity.py')
astro = importlib.util.module_from_spec(spec); spec.loader.exec_module(astro)
ENV = {'PUBLIC_IP': '8.8.8.8', 'OWNER_NAME': 'Owner', 'OWNER_GUID': '0',
       'SERVER_PORT': '8777', 'VOLTRA_ALLOCATED_PORTS': '8777', 'SERVER_PWD': 'seed-secret'}


class Files(unittest.TestCase):
    def test_seed_and_native_authority(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            astro.configure(root, ENV)
            settings = root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini'
            content = settings.read_text().replace('seed-secret', 'native-secret')
            content += '\n; operator comment\nPlayerProperties=(PlayerGuid="123",PlayerCategory=Admin)\nPlayerProperties=(PlayerGuid="456",PlayerCategory=Blacklisted)\nCustom=keep\n'
            settings.write_text(content)
            saves = root/'Astro/Saved/SaveGames'; saves.mkdir()
            world = saves/'WORLD$2026.10.29-01.00.00.savegame'; world.write_bytes(b'world-data')
            before = settings.read_bytes()
            self.assertEqual(astro.configure(root, {**ENV, 'SERVER_NAME': 'environment-change'})[0], 'native-secret')
            self.assertEqual(settings.read_bytes(), before)
            self.assertEqual(world.read_bytes(), b'world-data')
            self.assertNotIn('PlayerProperties', astro.seed('', astro.SECTION, {'OwnerGuid': '0'}))

    def test_port_constraint_and_encryption_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); astro.configure(root, ENV)
            engine = root/'Astro/Saved/Config/WindowsServer/Engine.ini'
            engine.write_text(engine.read_text().replace('false', 'true').replace('8777', '9999'))
            astro.configure(root, ENV)
            self.assertRegex(engine.read_text(), r'Port\s*=\s*8777')
            self.assertRegex(engine.read_text(), r'net.AllowEncryption\s*=\s*true')

    def test_injection_fails_before_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaises(ValueError): astro.configure(root, {**ENV, 'OWNER_NAME': 'bad\nInjected=yes'})
            self.assertFalse((root/'Astro').exists())

    def test_fragment_original_rows(self):
        catalog = json.loads((BASE/'internal/panel/game_library/upstream/catalog.json').read_text())
        path = 'astroneer/egg-astroneer-dedicated-server.json'
        original = next(e['egg'] for e in catalog['entries'] if e['path'] == path)
        profile = json.loads((BASE/'artifacts/game-parity-20261029/astroneer-profile.json').read_text())[path]
        self.assertEqual(profile['egg']['variables'][:len(original['variables'])], original['variables'])
        self.assertEqual(profile['verification'], 'not_verified')
        self.assertEqual(json.loads(profile['egg']['config']['startup']), {})
        self.assertIn('astroneer-parity.py', profile['egg']['scripts']['installation']['script'])

    @unittest.skipUnless(hasattr(os, 'fchown'), 'Linux ownership restoration requires POSIX; reuse prior Docker receipt')
    def test_actual_preservation_context_on_failed_update(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            paths = ['Astro/Saved/SaveGames/world.savegame',
                     'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini',
                     'Astro/Saved/Config/WindowsServer/operators.ini']
            for name in paths:
                path = root/name; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(('original '+name).encode())
            expected = {name: (root/name).read_bytes() for name in paths}
            with self.assertRaises(RuntimeError):
                with astro.legacy.shared.preserve(root):
                    for name in paths: (root/name).write_bytes(b'publisher update replacement')
                    raise RuntimeError('fixture update failure')
            for name in paths: self.assertEqual((root/name).read_bytes(), expected[name])

    def test_confined_escape_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaises(ValueError):
                astro.legacy.shared.confined(root, root/'..'/'outside.ini')


if __name__ == '__main__': unittest.main()
