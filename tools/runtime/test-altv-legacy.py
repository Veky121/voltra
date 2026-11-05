import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('altv', Path(__file__).with_name('altv-legacy-inspect.py'))
altv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(altv)


class LegacyBoundary(unittest.TestCase):
    def test_inventory_preserves_bytes_and_hides_secrets(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'server.toml'
            raw = b'# operator\r\nport=7788\r\npassword="PRIVATE"\r\ntoken="SECRET"\r\nresources=["owned"]\r\nmodules=["js-module","csharp-module"]\r\n[voice]\r\nexternalPort=7798\r\n'
            path.write_bytes(raw)
            result = altv.discover(tmp)
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual(result['resource_count'], 1)
            self.assertFalse(result['active_file_verified'])
            self.assertFalse(result['writable'])
            self.assertNotIn('PRIVATE', json.dumps(result))
            self.assertNotIn('SECRET', json.dumps(result))

    def test_ambiguous_and_explicit_native_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'server.toml').write_text('port=7788')
            (root / 'srv.toml').write_text('port=7790')
            with self.assertRaises(ValueError): altv.discover(tmp)
            self.assertEqual(altv.discover(tmp, 'srv.toml')['port'], 7790)
            for path in ['../server.toml', '/server.toml', 'C:/server.toml', '..\\server.toml']:
                with self.assertRaises(ValueError): altv.discover(tmp, path)

    def test_malformed_types_and_duplicates_leave_original(self):
        for raw in ['port=true', 'port=65536', 'port=1\nport=2', 'resources="owned"', 'modules=[1]', 'password="SECRET\n']:
            with self.subTest(raw=raw), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'server.toml'
                path.write_text(raw)
                before = path.read_bytes()
                with self.assertRaises(ValueError) as caught: altv.discover(tmp)
                self.assertNotIn('SECRET', str(caught.exception))
                self.assertEqual(path.read_bytes(), before)

    def test_stage_exact_scope_and_original_controls(self):
        subprocess.run(['node', 'tools/runtime/stage-altv-legacy.mjs'], check=True)
        out = Path('artifacts/game-parity-20261029/altv-owner')
        fragment = json.loads((out / 'profiles.fragment.json').read_text())
        recipe = 'gta/altv/egg-alt--v.json'
        self.assertEqual(list(fragment), [recipe])
        catalog = json.loads(Path('internal/panel/game_library/upstream/catalog.json').read_text())
        original = next(e['egg'] for e in catalog['entries'] if e['path'] == recipe)
        egg = fragment[recipe]['egg']
        self.assertEqual(egg['variables'], original['variables'])
        self.assertEqual(egg['startup'], original['startup'])
        self.assertEqual(egg['docker_images'], original['docker_images'])
        self.assertEqual(egg['config'], original['config'])
        self.assertEqual((out / 'altv-legacy-inspect.py').read_bytes(), Path('tools/runtime/altv-legacy-inspect.py').read_bytes())
        script = egg['scripts']['installation']['script']
        self.assertIn('exit 78', script)
        for mutation in ['apt-get', 'curl ', 'wget ', 'mkdir ', 'python', 'tee ']:
            self.assertNotIn(mutation, script)


if __name__ == '__main__': unittest.main()
