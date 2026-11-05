import codecs
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('carrier_wave4', ROOT / 'internal/panel/game_library/scripts/carrier-file-authority.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)
runtime = wrapper.load_runtime()
BASE = {'SERVER_PORT': '28020', 'VOLTRA_ALLOCATED_PORTS': '28020,28021,28022,28023', 'AUTO_UPDATE': '0', 'INSTALL_MODE': 'steam'}


class CarrierAuthority(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.target = self.root / 'server_config.xml'
        (self.root / 'dedicated_server.exe').write_bytes(b'fixture payload only')

    def fixture(self, port='28020'):
        data = runtime.CARRIER_DEFAULT.replace('port="25565"', 'port="' + port + '"').replace('password=""', 'password="native&amp;pass"').replace('server_name="Carrier Command 2 Dedicated Server"', 'server_name="Operator &quot;Name&quot;"')
        return codecs.BOM_UTF8 + ('<?xml version="1.0"?>\r\n<!-- <data false="root"> -->\r\n' + data.replace('<permissions/>', '<permissions><peer is_admin="true"/></permissions>').replace('<active_mod_folders/>', '<active_mod_folders><mod value="licensed/mod"/></active_mod_folders>') + '\r\n').encode()

    def test_canonical_baseline_reproduces_native_overwrite_and_acquisition_order(self):
        self.target.write_bytes(self.fixture())
        with patch.object(runtime, 'save_xml') as publication:
            runtime.configure(self.root, 'carrier', {**BASE, 'SERVER_NAME': 'stale setup', 'SERVER_PASSWORD': 'stale setup password'})
        document = publication.call_args.args[2]
        self.assertEqual(document.get('server_name'), 'stale setup')
        self.assertEqual(document.get('password'), 'stale setup password')
        with patch.object(runtime, 'install') as install, self.assertRaises(ValueError):
            runtime.run(self.root, 'carrier', {**BASE, 'AUTO_UPDATE': '1', 'MAX_PLAYERS': '17'})
        install.assert_called_once()

    def test_existing_all_native_values_and_exact_bytes_win(self):
        original = self.fixture()
        self.target.write_bytes(original)
        planned = wrapper.plan(runtime, self.root, {**BASE, 'SERVER_NAME': 'stale', 'SERVER_PASSWORD': 'stale', 'MAX_PLAYERS': '16'})
        self.assertEqual(planned['updated'], original)
        self.assertEqual(planned['password'], 'native&pass')
        self.assertEqual(self.target.read_bytes(), original)

    def test_only_port_changes_preserving_comment_bom_entities_permissions_mods(self):
        original = self.fixture('25565')
        self.target.write_bytes(original)
        prepared = wrapper.plan(runtime, self.root, BASE)
        self.assertEqual(prepared['updated'], original.replace(b'port="25565"', b'port="28020"', 1))

    def test_missing_native_fields_seed_once_from_setup(self):
        self.target.write_bytes(b'<data password="" unknown="retain"><permissions/></data>')
        prepared = wrapper.plan(runtime, self.root, {**BASE, 'SERVER_NAME': 'literal < & " name', 'SERVER_PASSWORD': 'stale'})
        document = runtime.parse_xml(prepared['updated'].decode(), 'data')
        self.assertEqual(document.get('password'), '')
        self.assertEqual(document.get('server_name'), 'literal < & " name')
        self.assertEqual(document.get('unknown'), 'retain')
        self.target.write_bytes(prepared['updated'])
        self.assertEqual(wrapper.plan(runtime, self.root, {**BASE, 'SERVER_NAME': 'changed'})['updated'], prepared['updated'])

    def test_invalid_native_or_setup_never_acquires_writes_or_starts(self):
        cases = [(b'<data password="one" Password="two"/>', {}), (b'<data max_players="17"/>', {}),
                 (b'<!DOCTYPE data><data/>', {}), (b'<data save_name="../outside"/>', {}),
                 (b'<data/>', {'VOLTRA_ALLOCATED_PORTS': '28020,28021,28023'}),
                 (b'<data/>', {'AUTO_UPDATE': 'yes'}), (b'<data/>', {'SRCDS_APPID': '1'})]
        for contents, extra in cases:
            self.target.write_bytes(contents)
            before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
            with patch.object(runtime, 'install') as install, patch.object(runtime.steam, '_publish') as publish, patch.object(runtime, 'helper') as helper:
                with self.assertRaises((ValueError, wrapper.ET.ParseError)):
                    wrapper.run(runtime, self.root, {**BASE, 'AUTO_UPDATE': '1', **extra})
            install.assert_not_called(); publish.assert_not_called(); helper.assert_not_called()
            self.assertEqual(before, {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_actual_run_preserves_native_credentials_and_shared_supervisor(self):
        self.target.write_bytes(self.fixture())
        console = types.SimpleNamespace(run=Mock(return_value=-11))
        with patch.object(runtime, 'helper', return_value=console), patch.object(runtime, 'install') as install:
            result = wrapper.run(runtime, self.root, {**BASE, 'SERVER_PASSWORD': 'stale'})
        self.assertEqual(result, 139)
        install.assert_not_called()
        self.assertIn('native&pass', console.run.call_args.args[4])
        self.assertNotIn('native&pass', ' '.join(console.run.call_args.args[1]))
        self.assertEqual(console.run.call_args.args[3], '\x03')
        self.assertEqual(console.run.call_args.args[2]['WINEARCH'], 'win32')

    def test_update_repairs_missing_binary_after_validation_and_replans(self):
        (self.root / 'dedicated_server.exe').unlink()
        self.target.write_bytes(self.fixture())
        def repair(*args):
            (self.root / 'dedicated_server.exe').write_bytes(b'repaired fixture')
        console = types.SimpleNamespace(run=Mock(return_value=0))
        with patch.object(runtime, 'install', side_effect=repair) as install, patch.object(runtime, 'helper', return_value=console):
            self.assertEqual(wrapper.run(runtime, self.root, {**BASE, 'AUTO_UPDATE': '1'}), 0)
        install.assert_called_once()

    def test_concurrent_operator_edit_rejects_publication(self):
        self.target.write_bytes(self.fixture('25565'))
        prepared = wrapper.plan(runtime, self.root, BASE)
        self.target.write_bytes(b'<data password="external"/>')
        with patch.object(runtime.steam, '_publish') as publish, self.assertRaises(ValueError):
            wrapper.publish(runtime, prepared)
        publish.assert_not_called()

    def test_symlink_refusal_leaves_operator_target_unchanged(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / 'native.xml'
            original = self.fixture()
            target.write_bytes(original)
            try:
                self.target.symlink_to(target)
            except OSError:
                self.skipTest('This host cannot create fixture symbolic links')
            with patch.object(runtime, 'install') as install, patch.object(runtime.steam, '_publish') as publication, self.assertRaises(ValueError):
                wrapper.run(runtime, self.root, {**BASE, 'AUTO_UPDATE':'1'})
            install.assert_not_called(); publication.assert_not_called()
            self.assertEqual(target.read_bytes(), original)

    def test_publication_retains_original_backup_bytes(self):
        original = self.fixture('25565')
        self.target.write_bytes(original)
        prepared = wrapper.plan(runtime, self.root, BASE)
        def publication(root, name, writer, mode):
            output = io.BytesIO(); writer(output)
            target = root / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(output.getvalue())
        # Windows lacks the shared publisher's Linux dirfd/O_NOFOLLOW API. Linux
        # root rerun must use the actual shared publisher for filesystem proof.
        if os.name == 'nt':
            with patch.object(runtime.steam, '_publish', side_effect=publication):
                wrapper.publish(runtime, prepared)
        else:
            wrapper.publish(runtime, prepared)
        self.assertEqual(self.target.read_bytes(), prepared['updated'])
        backups = list((self.root / '.voltra/carrier-config-history').glob('*.xml'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
