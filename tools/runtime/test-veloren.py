"""Installer and configuration fixtures. These are not game runtime acceptance."""
import hashlib
import io
import json
import subprocess
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest import mock

runtime = types.ModuleType('veloren_runtime')
installer = types.ModuleType('veloren_installer')
exec(RUNTIME_SOURCE, runtime.__dict__)
exec(INSTALL_SOURCE, installer.__dict__)


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.env = dict(SERVER_PORT='23560', SERVER_NAME='Name, $literal 世界', MAX_PLAYERS='32',
                        AUTH_MODE='official', AUTH_SERVER_URL='https://auth.veloren.net', MANAGE_NETWORK='1',
                        VOLTRA_ALLOCATED_PORTS='23560,23561', QUERY_ENABLED='1', QUERY_PORT='0',
                        METRICS_PORT='14005', METRICS_PUBLIC='0')

    def test_native_ports_authentication_and_private_metrics(self):
        game, cli = runtime.managed_settings(self.env)
        self.assertEqual(game['server_name']['value'], self.env['SERVER_NAME'])
        self.assertIn('23560', game['gameserver_protocols']['value'])
        self.assertEqual(game['query_address']['value'], '0.0.0.0:23560')
        self.assertEqual(game['auth_server_address']['value'], 'https://auth.veloren.net')
        self.assertEqual(cli['web_address']['value'], '127.0.0.1:14005')

    def test_unallocated_ports_and_invalid_values_rejected(self):
        for key, value in [('SERVER_PORT', '23562'), ('QUERY_PORT', '23562'), ('MAX_PLAYERS', '0'),
                           ('METRICS_PORT', '23560'), ('AUTH_MODE', 'unknown'), ('SERVER_NAME', 'bad\nname'),
                           ('AUTH_SERVER_URL', 'https://user:secret@example.com'), ('AUTH_SERVER_URL', 'http://example.com')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                runtime.managed_settings(dict(self.env, **{key: value}))
        with self.assertRaises(ValueError):
            runtime.managed_settings(dict(self.env, METRICS_PUBLIC='1'))

    def test_explicit_public_metrics_uses_an_allocation(self):
        _, cli = runtime.managed_settings(dict(self.env, METRICS_PUBLIC='1', METRICS_PORT='23561'))
        self.assertEqual(cli['web_address']['value'], '0.0.0.0:23561')

    def test_manual_network_keeps_native_protocols_and_cli_bindings(self):
        game, cli = runtime.managed_settings(dict(self.env, MANAGE_NETWORK='0'))
        self.assertNotIn('gameserver_protocols', game)
        self.assertNotIn('query_address', game)
        self.assertNotIn('web_address', cli)
        offline, _ = runtime.managed_settings(dict(self.env, AUTH_MODE='offline', QUERY_ENABLED='0'))
        self.assertIsNone(offline['auth_server_address']['value'])
        self.assertIsNone(offline['query_address']['value'])

    def test_native_rejection_does_not_modify_live_files_or_expose_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.voltra').mkdir()
            game = root / 'userdata/server/server_config/settings.ron'
            game.parent.mkdir(parents=True)
            game.write_text('(custom: "private-fixture")')

            def execute(args, **options):
                if str(args[0]).endswith('voltra-ron-config'):
                    Path(args[1]).write_text('()')
                    return types.SimpleNamespace(returncode=0)
                self.assertEqual(args[1:4], ['--no-auth', 'admin', 'remove'])
                self.assertNotEqual(options['env']['VELOREN_USERDATA'], str(root / 'userdata'))
                return types.SimpleNamespace(returncode=0, stdout='Failed to parse setting file! private-fixture', stderr='')

            with mock.patch.object(runtime.subprocess, 'run', side_effect=execute), self.assertRaises(ValueError) as error:
                runtime.configure(root, self.env)
            self.assertNotIn('private-fixture', str(error.exception))
            self.assertEqual(game.read_text(), '(custom: "private-fixture")')
            self.assertFalse((root / 'userdata/server-cli/settings.ron').exists())
            self.assertFalse(list((root / '.voltra').glob('.veloren-validate-*')))

    def test_changed_configuration_during_validation_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.voltra').mkdir()
            game = root / 'userdata/server/server_config/settings.ron'
            game.parent.mkdir(parents=True)
            game.write_text('()')

            def execute(args, **options):
                if str(args[0]).endswith('voltra-ron-config'):
                    Path(args[1]).write_text('()')
                    return types.SimpleNamespace(returncode=0)
                game.write_text('(operator: "concurrent edit")')
                return types.SimpleNamespace(returncode=0, stdout='Using userdata folder at ' + options['env']['VELOREN_USERDATA'], stderr='')

            with mock.patch.object(runtime.subprocess, 'run', side_effect=execute), self.assertRaisesRegex(ValueError, 'changed during'):
                runtime.configure(root, self.env)
            self.assertEqual(game.read_text(), '(operator: "concurrent edit")')


def archive(asset='stock', binary='server', extra=()):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as zipped:
        zipped.writestr('assets/common/fixture.ron', asset)
        zipped.writestr('veloren-server-cli', binary)
        zipped.writestr('LICENSE', 'fixture license')
        for name, value in extra:
            zipped.writestr(name, value)
    return stream.getvalue()


def builds(data):
    return {'weekly': {'x86_64': dict(name='fixture.zip', url='https://example.invalid/fixture.zip',
                                    bytes=len(data), sha256=hashlib.sha256(data).hexdigest())}}


class InstallTests(unittest.TestCase):
    def test_first_install_and_cached_operator_assets_need_no_network(self):
        data = archive()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertTrue(installer.install(root, builds(data), 'weekly', 'x86_64', lambda _: io.BytesIO(data)))
            asset = root / 'assets/common/fixture.ron'
            asset.write_text('operator override')
            self.assertFalse(installer.install(root, builds(data), 'weekly', 'x86_64', lambda _: self.fail('Unexpected download')))
            self.assertEqual(asset.read_text(), 'operator override')

    def test_missing_assets_and_corrupt_binary_are_repaired(self):
        data = archive()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer.install(root, builds(data), 'weekly', 'x86_64', lambda _: io.BytesIO(data))
            (root / 'assets/common/fixture.ron').unlink()
            (root / 'assets/custom.ron').write_text('operator extra')
            (root / 'veloren-server-cli').write_text('corrupt')
            installer.install(root, builds(data), 'weekly', 'x86_64', lambda _: io.BytesIO(data))
            self.assertEqual((root / 'veloren-server-cli').read_text(), 'server')
            self.assertEqual((root / 'assets/common/fixture.ron').read_text(), 'stock')
            self.assertEqual((root / 'assets/custom.ron').read_text(), 'operator extra')

    def test_changed_build_backs_up_assets_and_preserves_userdata(self):
        first, second = archive(), archive('new stock', 'new server')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer.install(root, builds(first), 'weekly', 'x86_64', lambda _: io.BytesIO(first))
            userdata = root / 'userdata/server/saves/db.sqlite'
            userdata.parent.mkdir(parents=True)
            userdata.write_bytes(b'operator save fixture')
            installer.install(root, builds(second), 'weekly', 'x86_64', lambda _: io.BytesIO(second))
            self.assertEqual(userdata.read_bytes(), b'operator save fixture')
            self.assertEqual((root / 'assets/common/fixture.ron').read_text(), 'new stock')
            self.assertTrue(any(p.read_text() == 'stock' for p in (root / '.voltra/veloren-backups').glob('*/assets/common/fixture.ron')))

    def test_failed_deployment_rolls_back_existing_game(self):
        first, second = archive(), archive('new stock', 'new server')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer.install(root, builds(first), 'weekly', 'x86_64', lambda _: io.BytesIO(first))
            replace = installer.os.replace

            def fail(source, destination):
                if Path(destination) == root / 'veloren-server-cli' and Path(source).parent.name == 'game':
                    raise OSError('Fixture publication failure')
                return replace(source, destination)

            with mock.patch.object(installer.os, 'replace', side_effect=fail), self.assertRaises(OSError):
                installer.install(root, builds(second), 'weekly', 'x86_64', lambda _: io.BytesIO(second))
            self.assertEqual((root / 'veloren-server-cli').read_text(), 'server')
            self.assertEqual((root / 'assets/common/fixture.ron').read_text(), 'stock')

    def test_integrity_and_traversal_fail_before_publishing(self):
        for data in [archive(extra=[('../escape', 'bad')]), b'invalid zip']:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    installer.install(root, builds(data), 'weekly', 'x86_64', lambda _: io.BytesIO(data))
                self.assertFalse((root / 'veloren-server-cli').exists())
        data = archive()
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, 'checksum'):
            installer.install(directory, builds(data), 'weekly', 'x86_64', lambda _: io.BytesIO(data[:-1]))


if __name__ == '__main__':
    unittest.main()
