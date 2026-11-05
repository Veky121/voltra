import runpy
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

scripts = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
for name in ['native-release', 'native-zip-release', 'steam-template', 'native-console', 'quake-ss14-query', 'quake-ss14-runtime', 'quake-ss14-install', 'ss14-parity']:
    import importlib.util
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), scripts / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
adapter = module


class SS14Tests(unittest.TestCase):
    def test_seed_literal_then_file_authority(self):
        with tempfile.TemporaryDirectory() as d:
            game = adapter.seed(d, {'SERVER_NAME':'literal " \\ café', 'SERVER_TICK':'30', 'SERVER_MAX_PLAYERS':'8'})
            config = game / 'server_config.toml'
            data = adapter.tomllib.loads(config.read_text(encoding='utf-8'))
            self.assertEqual(data['game']['hostname'], 'literal " \\ café')
            self.assertEqual(data['net']['tickrate'], 30)
            config.write_bytes(b'# operator\r\n[unknown]\nsecret="retain"\n')
            before = config.read_bytes()
            adapter.seed(d, {'SERVER_NAME':'changed'})
            self.assertEqual(config.read_bytes(), before)

    def test_listing_and_invalid_toml_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError): adapter.seed(d, {'PUBLIC_SERVER':'1'})
            game = adapter.seed(d, {})
            for content in ['[hub]\nadvertise=true', 'invalid=[']:
                (game/'server_config.toml').write_text(content)
                with self.assertRaises(ValueError): adapter.seed(d, {})

    def test_launch_keeps_settings_out_of_cli_and_propagates_crash(self):
        with tempfile.TemporaryDirectory() as d, patch.object(adapter, 'run', return_value=-9) as run:
            self.assertEqual(adapter.launch(d, {'SERVER_PORT':'28010', 'VOLTRA_ALLOCATED_PORTS':'28010', 'ROBUST_CVARS':'unsafe'}), 137)
            argv = run.call_args.args[1]
            self.assertIn('net.port=28010', argv)
            self.assertFalse(any('hostname=' in value or 'tickrate=' in value for value in argv))
            self.assertNotIn('ROBUST_CVARS', run.call_args.args[2])
            self.assertEqual(run.call_args.args[3], 'shutdown VoltraStop')

    def test_acquisition_excludes_operator_paths_and_restores_extractor(self):
        import zipfile
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive = root/'fixture.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                for name in ['Robust.Server', 'server_config.toml', 'data/operator.db', 'content.bin']:
                    z.writestr(name, 'fixture')
            original = adapter.native_zip_release.extract
            def install(*args):
                target = root/'fixture'; target.mkdir()
                adapter.native_zip_release.extract(archive, target, None)
                self.assertTrue((target/'Robust.Server').exists())
                self.assertFalse((target/'server_config.toml').exists())
                self.assertFalse((target/'data').exists())
            with patch.object(adapter.platform, 'machine', return_value='x86_64'), patch.object(adapter, 'tar_install'), patch.object(adapter.native_zip_release, 'install_release', side_effect=install):
                adapter.install(root, {})
            self.assertIs(adapter.native_zip_release.extract, original)

if __name__ == '__main__': unittest.main(verbosity=2)

