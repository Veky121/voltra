import importlib.util
from contextlib import nullcontext
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


canonical = BASE / 'cryofall-file-authority.py'
wrapper = load('cryofall_wave4', canonical)
for name in ('steam-template', 'additional-survival-install', 'native-console', 'strategy-survival-install'):
    load(name.replace('-', '_'), BASE / (name + '.py'))
native = load('cryofall_runtime', BASE / 'cryofall-runtime.py')
ENV = {'SERVER_PORT': '28010', 'VOLTRA_ALLOCATED_PORTS': '28010', 'SERVER_NAME': 'Stale name',
       'MAX_PLAYERS': '30', 'PUBLIC_SERVER': '0', 'NO_CLIENT_MODS': '0', 'SERVER_OPERATORS': 'StaleOperator'}
XML = b'<settings version="20"><!--operator--><network><port>9999</port><ip>0.0.0.0</ip><is_public_server>1</is_public_server><server_private_guid>private-fixture-guid</server_private_guid></network><server><name>Native name</name><players_max_count>24</players_max_count><no_client_mods>1</no_client_mods><server_operators_list></server_operators_list><unknown_option>retained</unknown_option></server></settings>'


class CryoFallAuthority(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.target = self.root / wrapper.DOCUMENT
        self.target.parent.mkdir()
        self.target.write_bytes(XML)
        for relative in ('.voltra/dotnet-6/dotnet', 'Binaries/Server/CryoFall_Server.dll'):
            file = self.root / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'payload fixture')

    def invoke(self, shared, env=None):
        with patch.object(wrapper.Path, 'cwd', return_value=self.root), patch.dict(os.environ, env or ENV, clear=True):
            return wrapper.main(shared)

    def test_native_controls_and_deliberately_empty_operators_win_without_planning_writes(self):
        effective = wrapper.preflight(self.root, ENV)
        self.assertEqual({key: effective[key] for key in ('SERVER_NAME', 'MAX_PLAYERS', 'PUBLIC_SERVER', 'NO_CLIENT_MODS', 'SERVER_OPERATORS')},
                         {'SERVER_NAME': 'Native name', 'MAX_PLAYERS': '24', 'PUBLIC_SERVER': '1', 'NO_CLIENT_MODS': '1', 'SERVER_OPERATORS': ''})
        self.assertEqual(effective['SERVER_PORT'], '28010')
        self.assertEqual(self.target.read_bytes(), XML)

    def test_missing_fields_seed_from_original_environment(self):
        self.target.write_bytes(b'<settings><server><unknown>keep</unknown></server></settings>')
        self.assertEqual(wrapper.preflight(self.root, ENV), ENV)
        self.target.unlink()
        self.assertEqual(wrapper.preflight(self.root, ENV), ENV)
        self.assertFalse(self.target.exists())

    def test_duplicate_alias_and_unsafe_xml_refuse_before_acquisition(self):
        cases = [b'<settings><server><name>a</name><name>b</name></server></settings>',
                 b'<settings><Server><name>a</name></Server></settings>',
                 b'<settings><server><Name>a</Name></server></settings>',
                 b'<settings><network><port>1</port><port>2</port></network></settings>',
                 b'<!DOCTYPE settings><settings/>', b'<settings><server><name><nested/></name></server></settings>']
        for data in cases:
            with self.subTest(data=data):
                self.target.write_bytes(data)
                shared = types.SimpleNamespace(install=Mock(), configure=Mock(), run=Mock())
                with self.assertRaises(ValueError): self.invoke(shared, {**ENV, 'AUTO_UPDATE': '1'})
                shared.install.assert_not_called(); shared.configure.assert_not_called(); shared.run.assert_not_called()
                self.assertEqual(self.target.read_bytes(), data)

    def test_invalid_ports_and_update_flags_do_not_acquire(self):
        for change in ({'SERVER_PORT': '3'}, {'VOLTRA_ALLOCATED_PORTS': '28010,99999'}, {'AUTO_UPDATE': 'yes'}, {'SRCDS_APPID': '1'}):
            shared = types.SimpleNamespace(install=Mock(), configure=Mock(), run=Mock())
            with self.subTest(change=change), self.assertRaises(ValueError): self.invoke(shared, {**ENV, 'AUTO_UPDATE': '1', **change})
            shared.install.assert_not_called(); shared.configure.assert_not_called()
        self.assertEqual(self.target.read_bytes(), XML)

    def test_original_auto_update_can_restore_missing_binary_then_revalidate(self):
        binary = self.root / 'Binaries/Server/CryoFall_Server.dll'; binary.unlink()
        def repair(*args, **kwargs): binary.write_bytes(b'repaired fixture')
        shared = types.SimpleNamespace(install=Mock(side_effect=repair), configure=Mock(return_value=(['fixture'], {})), run=Mock(return_value=17))
        self.assertEqual(self.invoke(shared, {**ENV, 'AUTO_UPDATE': '1'}), 17)
        shared.install.assert_called_once()
        self.assertEqual(shared.install.call_args.kwargs, {'validate': False})
        self.assertEqual(shared.configure.call_args.args[1]['SERVER_NAME'], 'Native name')
        self.assertEqual(shared.run.call_args.args[3], 'stop 0')
        self.assertEqual(shared.run.call_args.kwargs['ready_marker'], b'UDPServer: Socket-server listening on')

    def test_missing_payload_without_update_refuses_before_configuration(self):
        (self.root / '.voltra/dotnet-6/dotnet').unlink()
        shared = types.SimpleNamespace(install=Mock(), configure=Mock(), run=Mock())
        with self.assertRaises(ValueError): self.invoke(shared, {**ENV, 'AUTO_UPDATE': '0'})
        shared.install.assert_not_called(); shared.configure.assert_not_called(); shared.run.assert_not_called()

    def test_two_actual_shared_configure_calls_preserve_values_and_private_unknowns(self):
        self.target.chmod(0o640)
        identity = self.target.stat()
        def fixture_write(file, data, metadata=None):
            file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(data)
        # Windows uses a publication fixture because metadata APIs are absent.
        # Linux exercises the actual shared atomic publisher in the temp volume.
        publisher = patch.object(native, 'private_bytes', side_effect=fixture_write) if os.name == 'nt' else nullcontext()
        with publisher:
            for _ in range(2):
                effective = wrapper.preflight(self.root, ENV)
                argv, child = native.configure(self.root, effective)
                root = ET.fromstring(self.target.read_bytes())
                self.assertEqual(root.findtext('server/name'), 'Native name')
                self.assertEqual(root.findtext('server/players_max_count'), '24')
                self.assertEqual(root.findtext('server/no_client_mods'), '1')
                self.assertEqual(root.findtext('server/server_operators_list'), '')
                self.assertEqual(root.findtext('network/is_public_server'), '1')
                self.assertEqual(root.findtext('network/port'), '28010')
                self.assertEqual(root.findtext('network/server_private_guid'), 'private-fixture-guid')
                self.assertEqual(root.findtext('server/unknown_option'), 'retained')
                self.assertIn(b'<!--operator-->', self.target.read_bytes())
                self.assertEqual(argv[-1], 'loadOrNew'); self.assertEqual(child['DOTNET_ROLL_FORWARD'], 'LatestPatch')
                if os.name != 'nt':
                    current = self.target.stat()
                    self.assertEqual((current.st_uid, current.st_gid, current.st_mode & 0o777),
                                     (identity.st_uid, identity.st_gid, 0o640))

    def test_utf16_and_invalid_native_scalar_handling(self):
        self.target.write_bytes(XML.decode().encode('utf-16'))
        self.assertEqual(wrapper.preflight(self.root, ENV)['SERVER_NAME'], 'Native name')
        for old, new in ((b'<players_max_count>24', b'<players_max_count>301'), (b'<no_client_mods>1', b'<no_client_mods>true')):
            self.target.write_bytes(XML.replace(old, new))
            with self.assertRaises(ValueError): wrapper.preflight(self.root, ENV)


if __name__ == '__main__': unittest.main()
