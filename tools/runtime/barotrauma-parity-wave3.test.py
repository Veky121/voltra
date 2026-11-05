import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('barotrauma_authority', Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/barotrauma-file-authority.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class Authority(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / 'serversettings.xml'

    def test_native_values_override_stale_environment(self):
        original = b'<serversettings servername="Native &amp; World" password="" maxplayers="12" ispublic="true" port="1" queryport="2"><unknown/></serversettings>'
        self.target.write_bytes(original)
        result = adapter.native_environment(self.root, {'SERVER_NAME': 'old', 'SERVER_PASSWORD': 'old', 'MAX_PLAYERS': '8', 'PUBLIC_SERVER': '0', 'SERVER_PORT': '28000'},)
        self.assertEqual(result['SERVER_NAME'], 'Native & World')
        self.assertEqual(result['SERVER_PASSWORD'], '')
        self.assertEqual(result['MAX_PLAYERS'], '12')
        self.assertEqual(result['PUBLIC_SERVER'], '1')
        self.assertEqual(result['SERVER_PORT'], '28000')
        self.assertEqual(self.target.read_bytes(), original)

    def test_missing_fields_seed_from_environment(self):
        self.assertEqual(adapter.native_environment(self.root, {'SERVER_NAME': 'Seed'}), {'SERVER_NAME': 'Seed'})
        self.target.write_text('<serversettings password="native"/>')
        result = adapter.native_environment(self.root, {'SERVER_NAME': 'Seed'})
        self.assertEqual(result['SERVER_NAME'], 'Seed')
        self.assertEqual(result['SERVER_PASSWORD'], 'native')

    def test_ambiguous_aliases_refuse_without_writes(self):
        for content in ('<serversettings password="a" Password="b"/>', '<serversettings Port="1" port="2"/>'):
            self.target.write_text(content)
            with self.assertRaises(ValueError):
                adapter.native_environment(self.root, {})
            self.assertEqual(self.target.read_text(), content)

    def test_unsafe_xml_and_native_values_refuse(self):
        for content in ('<!DOCTYPE x><serversettings/>', '<other/>', '<serversettings maxplayers="17"/>', '<serversettings ispublic="maybe"/>', '<serversettings password="bad&#10;value"/>'):
            self.target.write_text(content)
            with self.assertRaises((ValueError, adapter.ET.ParseError)):
                adapter.native_environment(self.root, {})

    def test_missing_binary_refuses_before_shared_configure(self):
        shared = types.SimpleNamespace(configure=lambda *args: self.fail('must not configure'), install=lambda *args, **kwargs: self.fail('must not acquire'))
        with patch.dict(sys.modules, {'barotrauma_runtime': shared}), patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, {'VOLTRA_STEAM_AUTO_UPDATE': '0', 'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000,28001'}, clear=True):
            with self.assertRaises(ValueError):
                adapter.main()
        self.assertFalse(self.target.exists())

    def test_native_credentials_and_shared_supervision_handoff(self):
        self.target.write_text('<serversettings password="native-fixture"/>')
        (self.root / 'DedicatedServer').write_bytes(b'fixture')
        observed = {}
        def configure(root, environment):
            observed.update(environment)
            return ['fixture'], {}, [environment['SERVER_PASSWORD']]
        def run(root, argv, child, stop, **kwargs):
            self.assertEqual(stop, 'quit')
            self.assertEqual(kwargs['credentials'], ['native-fixture'])
            self.assertTrue(kwargs['terminal_query_reply'])
            return 23
        shared = types.SimpleNamespace(configure=configure, run=run)
        with patch.dict(sys.modules, {'barotrauma_runtime': shared}), patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, {'SERVER_PASSWORD': 'stale', 'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000,28001'}, clear=True):
            self.assertEqual(adapter.main(), 23)
        self.assertEqual(observed['SERVER_PASSWORD'], 'native-fixture')

    def test_invalid_ports_refuse_before_acquisition_publication_or_start(self):
        original = b'<serversettings password="native-fixture"/>\n'
        self.target.write_bytes(original)
        shared = types.SimpleNamespace(
            install=lambda *args, **kwargs: self.fail('invalid ports acquired game'),
            configure=lambda *args, **kwargs: self.fail('invalid ports published configuration'),
            run=lambda *args, **kwargs: self.fail('invalid ports started game'))
        valid = {'VOLTRA_STEAM_AUTO_UPDATE': '1', 'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000,28001'}
        for invalid in (
            {'SERVER_PORT': ''}, {'SERVER_PORT': '0'}, {'SERVER_PORT': '28002'},
            {'VOLTRA_ALLOCATED_PORTS': '28000'}, {'VOLTRA_ALLOCATED_PORTS': ''},
            {'VOLTRA_ALLOCATED_PORTS': '28000,bad'}, {'VOLTRA_ALLOCATED_PORTS': '28000,65536'},
            {'QUERY_PORT': '28000'}, {'QUERY_PORT': '28002'}, {'QUERY_PORT': 'bad'},
        ):
            with self.subTest(invalid=invalid), patch.dict(sys.modules, {'barotrauma_runtime': shared}), patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, {**valid, **invalid}, clear=True):
                with self.assertRaises(ValueError):
                    adapter.main()
            self.assertEqual(self.target.read_bytes(), original)
            self.assertEqual({item.name for item in self.root.iterdir()}, {'serversettings.xml'})

    def test_valid_auto_update_can_repair_missing_binary(self):
        calls = []
        def install(root, game, environment, validate):
            calls.append('install')
            self.assertEqual(game, 'barotrauma')
            self.assertFalse(validate)
            (root / 'DedicatedServer').write_bytes(b'fixture repaired executable')
        def configure(root, environment):
            calls.append('configure')
            self.assertTrue((root / 'DedicatedServer').is_file())
            return ['fixture'], {}, []
        def run(*args, **kwargs):
            calls.append('run')
            return 0
        shared = types.SimpleNamespace(install=install, configure=configure, run=run)
        environment = {'VOLTRA_STEAM_AUTO_UPDATE': '1', 'SERVER_PORT': '28001', 'VOLTRA_ALLOCATED_PORTS': '28001,28000', 'QUERY_PORT': ''}
        self.assertEqual(adapter.validate_ports(environment), (28001, 28000))
        with patch.dict(sys.modules, {'barotrauma_runtime': shared}), patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(adapter.os.environ, environment, clear=True):
            self.assertEqual(adapter.main(), 0)
        self.assertEqual(calls, ['install', 'configure', 'run'])

    def test_real_shared_configuration_retains_values_on_repeated_boots(self):
        base = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
        for name in ('steam-template', 'native-config', 'native-console', 'additional-survival-install', 'barotrauma-runtime'):
            identity = name.replace('-', '_')
            spec = importlib.util.spec_from_file_location(identity, base / (name + '.py'))
            shared = importlib.util.module_from_spec(spec)
            sys.modules[identity] = shared
            spec.loader.exec_module(shared)
        (self.root / 'DedicatedServer').write_bytes(b'fixture')
        self.target.write_text('<serversettings servername="Native" password="native-fixture" maxplayers="12" ispublic="true" extra="keep"><nested keep="yes"/><!--comment--></serversettings>')
        def write(target, content):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        for _ in range(2):
            effective = adapter.native_environment(self.root, {'SERVER_NAME': 'stale', 'SERVER_PASSWORD': 'stale', 'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000,28001'})
            # Linux private publication is a separate security boundary. Only
            # its filesystem write is replaced for this Windows fixture.
            with patch.object(shared, 'private_write', write):
                argv, child, credentials = shared.configure(self.root, effective)
            self.assertEqual(argv[argv.index('-name') + 1], 'Native')
            self.assertEqual(argv[argv.index('-maxplayers') + 1], '12')
            self.assertIn('native-fixture', credentials)
            self.assertNotIn('native-fixture', argv)
            element = adapter.ET.fromstring(self.target.read_text())
            self.assertEqual(element.attrib['password'], 'native-fixture')
            self.assertEqual(element.attrib['extra'], 'keep')
            self.assertIsNotNone(element.find('nested'))
            self.assertIn('<!--comment-->', self.target.read_text())


if __name__ == '__main__':
    unittest.main()
