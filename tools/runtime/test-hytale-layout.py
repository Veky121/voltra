"""Source fixtures only: no Java, Docker, downloader or authentication."""
import runpy
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import json
import io

runpy.run_path(str(pathlib.Path(__file__).with_name('test-hytale-resume-wave4.py')), run_name='fixture_import')
import hytale_runtime as runtime


class LayoutTests(unittest.TestCase):
    def setUp(self):
        # Windows source fixtures substitute only the Linux dir-fd publication
        # primitive. This does not test its Linux confinement/atomicity.
        def publish(root, name, writer, mode=0o600):
            output = io.BytesIO()
            writer(output)
            self.put(root, name, output.getvalue())
        replacement = patch.object(runtime.publisher, '_publish', side_effect=publish)
        replacement.start()
        self.addCleanup(replacement.stop)

    def put(self, root, name, value=b'fixture'):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)

    def test_config_authority_and_tokens(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            self.put(root, 'Server/HytaleServer.jar')
            self.put(root, 'config.json', b'{"Unknown":{"keep":true},"Update":{"Enabled":false,"Custom":7}}')
            self.put(root, 'universe/worlds/default/config.json', b'{"Seed":123}')
            env = dict(VOLTRA_PUBLISHER='hytale', ACQUISITION_MODE='operator', HYTALE_PATCHLINE='pre-release', INSTALL_SOURCEQUERY_PLUGIN='0', HYTALE_SERVER_SESSION_TOKEN='private-fixture')
            result = (['java'], {}, ['private-fixture'], b'ready', '/stop', None)
            with patch.object(runtime.publisher, 'configure', return_value=result), patch.object(runtime.publisher, 'install_query') as query:
                argv, child, *_ = runtime.configure(root, env)
            data = json.loads((root/'Server/config.json').read_text())
            self.assertEqual(data, {'Unknown': {'keep': True}, 'Update': {'Enabled': False, 'Custom': 7, 'Patchline': 'pre-release'}})
            self.assertEqual(child['HYTALE_SERVER_SESSION_TOKEN'], 'private-fixture')
            self.assertNotIn('private-fixture', argv)
            query.assert_called_once_with(root/'Server', 'operator', enabled=False)
            self.assertEqual((root/'Server/universe/worlds/default/config.json').read_bytes(), b'{"Seed":123}')

    def test_conflict_refuses_before_any_move(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            for name in ('config.json', 'universe/world', 'Server/universe/world'):
                self.put(root, name)
            with self.assertRaises(ValueError): runtime.migrate_state(root)
            self.assertTrue((root/'config.json').exists())

    def test_selective_update_and_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            for name in ('Server/HytaleServer.jar', 'Assets.zip', 'Server/config.json', 'Server/auth.enc', 'Server/universe/world', 'Server/mods/custom.jar'):
                self.put(root, name, b'old')
                self.put(root, 'updater/staging/'+name, b'new')
            self.put(root, 'updater/staging/Server/HytaleServer.aot', b'new-cache')
            self.put(root, 'updater/staging/Server/Licenses/NOTICE', b'license')
            self.assertTrue(runtime.apply_update(root))
            self.assertFalse(runtime.apply_update(root))
            self.assertEqual((root/'Server/HytaleServer.jar').read_bytes(), b'new')
            self.assertEqual((root/'Server/HytaleServer.aot').read_bytes(), b'new-cache')
            for name in ('config.json', 'auth.enc', 'universe/world', 'mods/custom.jar'):
                self.assertEqual((root/'Server'/name).read_bytes(), b'old')
            self.assertEqual(len(list((root/'.voltra/publisher/update-backups').glob('*/Server/HytaleServer.jar'))), 1)

    def test_exit8_restarts_only_with_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            env = dict(VOLTRA_PUBLISHER='hytale', VOLTRA_ALLOCATED_PORTS='5520,5521')
            config = (['java'], {}, [], b'ready', '/stop', None)
            with patch.object(runtime, 'apply_update', side_effect=[True, True]), patch.object(runtime, 'configure', return_value=config), patch.object(runtime.publisher, 'run', side_effect=[8, 0]) as launch, patch.object(runtime.publisher, 'acquire') as acquire:
                self.assertEqual(runtime.main(root, env), 0)
                acquire.assert_not_called()
                self.assertEqual(launch.call_count, 2)
                self.assertEqual(launch.call_args.args[0], root/'Server')
            with patch.object(runtime, 'apply_update', side_effect=[True, False]), patch.object(runtime, 'configure', return_value=config), patch.object(runtime.publisher, 'run', return_value=8):
                with self.assertRaises(ValueError): runtime.main(root, env)


if __name__ == '__main__': unittest.main()
