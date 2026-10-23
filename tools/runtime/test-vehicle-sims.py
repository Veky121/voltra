import importlib.util
import json
import os
import struct
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('vehicle_sims', ROOT / 'internal/panel/game_library/scripts/vehicle-sims.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def env(**values):
    return {'SERVER_PORT': '28020', 'VOLTRA_ALLOCATED_PORTS': '28020,28021,28022,28023', **values}


def put(root, name, content):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


class VehicleSimsTests(unittest.TestCase):
    def test_operator_files_architecture_hash_inventory_and_no_acquisition(self):
        # Structural headers are non-runnable fixtures, not native acceptance.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            header = bytearray(256)
            header[:2] = b'MZ'
            struct.pack_into('<I', header, 60, 128)
            header[128:132] = b'PE\0\0'
            struct.pack_into('<H', header, 132, 0x14c)
            for name in ('dedicated_server.exe', 'steamclient.dll', 'tier0_s.dll', 'vstdlib_s.dll'):
                (root / name).write_bytes(header)
            elf = bytearray(64); elf[:6] = b'\x7fELF\x02\x01'; struct.pack_into('<H', elf, 18, 62)
            put(root, 'linux64/steamclient.so', '').write_bytes(elf)
            content = put(root, 'rom_0/operator-content', 'licensed fixture')
            with mock.patch.object(adapter.steam, 'update') as update:
                adapter.install(root, 'carrier', {'INSTALL_MODE': 'operator_files'})
            update.assert_not_called()
            receipt = json.loads((root / '.voltra/vehicle-sims/operator-files.json').read_text())
            self.assertEqual(len(receipt['files']), 5)
            self.assertFalse(receipt['runtime_verified'])
            self.assertFalse(receipt['publisher_authenticity_verified'])
            self.assertEqual(content.read_text(), 'licensed fixture')
            self.assertFalse((root / 'steamapps').exists())
            (root / 'steamclient.dll').write_bytes(b'MZ wrong architecture')
            with self.assertRaises(ValueError):
                adapter.install(root, 'carrier', {'INSTALL_MODE': 'operator_files'})
            self.assertEqual(content.read_text(), 'licensed fixture')

    def test_operator_files_missing_content_symlink_and_mode_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for mode in ('operator_files', 'unknown'):
                with mock.patch.object(adapter.steam, 'update') as update, self.assertRaises(ValueError):
                    adapter.install(root, 'stormworks', {'INSTALL_MODE': mode})
                update.assert_not_called()
            (root / 'rom').symlink_to('/tmp', target_is_directory=True)
            with self.assertRaises(ValueError):
                adapter.install(root, 'stormworks', {'INSTALL_MODE': 'operator_files'})

    def test_storm_original_template_seed_playlists_and_literal_xml(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with mock.patch.object(adapter.secrets, 'randbelow', return_value=16):
                args, secrets, cwd = adapter.configure(root, 'stormworks', env(SERVER_NAME='Storm 日本 "&<name>', SERVER_PASSWORD='literal; $(no)', STEAM64_ID='76561198000000001', MAX_PLAYERS='12'))
            target = root / 'server_data/server_config.xml'
            doc = ET.parse(target).getroot()
            self.assertEqual(doc.get('name'), 'Storm 日本 "&<name>')
            self.assertEqual(doc.get('seed'), '17')
            self.assertEqual(doc.get('save_name'), 'autosave_server')
            self.assertEqual(doc.get('max_players'), '12')
            self.assertEqual(doc.get('dlc_weapons'), 'false')
            self.assertGreater(len(doc.find('playlists')), 20)
            self.assertEqual(args[-2:], ['+server_dir', str(root / 'server_data')])
            self.assertEqual(cwd, root)
            self.assertEqual(secrets, ['literal; $(no)'])
            adapter.configure(root, 'stormworks', env())
            self.assertEqual(ET.parse(target).getroot().get('seed'), '17')

    def test_storm_admin_updates_preserve_unrelated_entries_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = put(root, 'server_data/server_config.xml', '<server_data seed="42" save_name="operator" future="keep"><!--keep--><admins><id value="76561198000000002"/></admins><whitelist><id value="76561198000000003"/></whitelist><mods><mod name="custom"/></mods></server_data>')
            adapter.configure(root, 'stormworks', env(STEAM64_ID='76561198000000001'))
            adapter.configure(root, 'stormworks', env(STEAM64_ID='76561198000000004'))
            doc = ET.parse(target).getroot()
            self.assertEqual({x.get('value') for x in doc.find('admins')}, {'76561198000000002', '76561198000000004'})
            self.assertEqual(doc.get('future'), 'keep')
            self.assertEqual(doc.get('save_name'), 'operator')
            self.assertEqual(doc.find('whitelist/id').get('value'), '76561198000000003')
            self.assertIn('<!--keep-->', target.read_text())

    def test_carrier_all_match_controls_and_unknown_xml_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = put(root, 'server_config.xml', '<data game_data_path="operator_rom" other="keep"><permissions><peer steam_id="76561198000000001" is_admin="true"/></permissions><active_mod_folders><mod value="mods/custom"/></active_mod_folders></data>')
            args, secrets, cwd = adapter.configure(root, 'carrier', env(SERVER_NAME='Carrier "&<name>', SERVER_PASSWORD='literal & pass', SAVE_NAME='match 2', MAX_PLAYERS='16', ISLAND_COUNT='32', ISLAND_COUNT_PER_TEAM='8', CARRIER_COUNT_PER_TEAM='4', TEAM_COUNT_AI='0', TEAM_COUNT_HUMAN='4', BASE_DIFFICULTY='2', LOADOUT_TYPE='2', BLUEPRINTS='1'))
            doc = ET.parse(path).getroot()
            self.assertEqual(doc.get('server_name'), 'Carrier "&<name>')
            self.assertEqual(doc.get('game_data_path'), 'operator_rom')
            for key, value in {'island_count': '32', 'island_count_per_team': '8', 'carrier_count_per_team': '4', 'team_count_ai': '0', 'team_count_human': '4', 'base_difficulty': '2', 'loadout_type': '2', 'blueprints': '1', 'save_name': 'match 2'}.items():
                self.assertEqual(doc.get(key), value)
            self.assertEqual(doc.find('permissions/peer').get('is_admin'), 'true')
            self.assertEqual(doc.find('active_mod_folders/mod').get('value'), 'mods/custom')
            self.assertEqual(args, ['wine', str(root / 'dedicated_server.exe')])
            self.assertEqual(secrets, ['literal & pass'])

    def test_consecutive_ports_and_xml_save_names_fail_clearly(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for game, values in [('stormworks', {'VOLTRA_ALLOCATED_PORTS': '28020,28022'}), ('carrier', {'VOLTRA_ALLOCATED_PORTS': '28020,28021,28022'}), ('carrier', {'SAVE_NAME': '../other'}), ('carrier', {'ISLAND_COUNT': '33'}), ('stormworks', {'STEAM64_ID': 'not-an-id'})]:
                with self.subTest(game=game, values=values), self.assertRaises(ValueError):
                    adapter.configure(root, game, env(**values))
            self.assertFalse((root / 'server_config.xml').exists())

    def test_xml_entities_malformed_root_and_duplicate_admin_groups_rejected(self):
        for xml in ('<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///etc/passwd">]><server_data>&leak;</server_data>', '<wrong/>', '<server_data><admins/><admins/></server_data>'):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                target = put(root, 'server_data/server_config.xml', xml)
                with self.assertRaises(ValueError):
                    adapter.configure(root, 'stormworks', env())
                self.assertEqual(target.read_text(), xml)

    def test_archean_all_original_ini_controls_and_working_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = put(root, 'Archean-data/server/server.ini', '; keep comment\n[server]\noperator=yes\n[game]\nexternal_mods_dir=mods\n')
            args, secrets, cwd = adapter.configure(root, 'archean', env(SERVER_NAME='Archean 日本', PASSWORD='literal; pass', GAME_MODE='1', ONLINE_MODE='1', MAX_PLAYERS='10', SPAWN_PLANET='moon', WORLD_NAME='Orbit World', AUTOSAVE_INTERVAL='0', UPDATES_PER_SECOND='30', PHYSICS_UPDATES_PER_UPDATE='12'))
            result = path.read_text()
            for field in ('; keep comment', 'operator=yes', 'server_public_name = Archean 日本', 'game_mode = 1', 'server_online = yes', 'accept_remote_connections = yes', 'listen_port = 28020', 'spawn = moon', 'world = Orbit World', 'auto_save_interval_seconds = 0', 'physics_steps_per_update = 12', 'external_mods_dir=mods'):
                self.assertIn(field, result)
            self.assertEqual(cwd, root / 'Archean-game')
            self.assertEqual(args, [str(cwd / 'Archean_server')])
            self.assertEqual(secrets, ['literal; pass'])

    def test_archean_bounds_wrong_platform_and_wrong_app_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            for values in ({'GAME_MODE': 'creative'}, {'ONLINE_MODE': 'true'}, {'SPAWN_PLANET': 'mars'}, {'PHYSICS_UPDATES_PER_UPDATE': '0'}, {'WORLD_NAME': '/outside'}, {'WINDOWS_INSTALL': '1'}, {'SRCDS_APPID': '573090'}):
                with self.assertRaises(ValueError):
                    adapter.configure(Path(directory), 'archean', env(**values))

    def test_owned_game_private_steam_never_falls_back_to_anonymous(self):
        with tempfile.TemporaryDirectory() as directory:
            for game in ('stormworks', 'carrier'):
                for values in ({}, {'STEAM_USER': 'anonymous'}, {'STEAM_USER': 'legitimate-owner', 'STEAM_PASS': 'private-value', 'STEAM_AUTH': '12345'}):
                    with mock.patch.object(adapter.steam, 'update') as update, self.assertRaises(ValueError):
                        adapter.install(Path(directory), game, values)
                    update.assert_not_called()

    def test_public_archean_uses_original_linux_dedicated_app(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(adapter.steam, 'update') as update:
                adapter.install(Path(directory), 'archean', {})
            self.assertEqual(update.call_args.args[1], 3557220)
            self.assertEqual(update.call_args.kwargs['platform'], 'linux')
            self.assertEqual(update.call_args.kwargs['required'], ('Archean-game/Archean_server',))

    def test_carrier_sdk_manifest_isolation_and_all_dll_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            put(root, '.voltra/steamcmd/linux64/steamclient.so', 'ELF fixture')
            def update(stage, app, options, **kwargs):
                self.assertEqual(app, 1007)
                self.assertEqual(options, {'WINDOWS_INSTALL': '1'})
                self.assertEqual(kwargs['platform'], 'windows')
                self.assertTrue(stage.is_relative_to(root / '.voltra/carrier-sdk'))
                put(stage, 'steamapps/appmanifest_1007.acf', 'temporary SDK manifest')
                for name in ('steamclient.dll', 'tier0_s.dll', 'vstdlib_s.dll'):
                    (stage / name).write_bytes(b'MZ Windows SDK fixture')
            with mock.patch.object(adapter.steam, 'update', side_effect=update):
                adapter.carrier_sdk(root)
            self.assertFalse((root / 'steamapps/appmanifest_1007.acf').exists())
            self.assertEqual((root / 'steamclient.dll').read_bytes(), b'MZ Windows SDK fixture')
            self.assertEqual((root / 'linux64/steamclient.so').read_text(), 'ELF fixture')
            self.assertEqual(list((root / '.voltra/carrier-sdk').iterdir()), [])

    def test_carrier_sdk_incomplete_payload_does_not_publish_any_dll(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def update(stage, *args, **kwargs):
                (stage / 'steamclient.dll').write_bytes(b'MZ only one DLL')
            with mock.patch.object(adapter.steam, 'update', side_effect=update), self.assertRaises(ValueError):
                adapter.carrier_sdk(root)
            self.assertFalse((root / 'steamclient.dll').exists())

    def test_licensed_preinstalled_run_keeps_win32_contract_without_steam(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            put(root, 'dedicated_server.exe', 'licensed test fixture, not native executable')
            console = mock.Mock(); console.run.return_value = 0
            with mock.patch.object(adapter, 'helper', return_value=console), mock.patch.object(adapter, 'install') as install:
                self.assertEqual(adapter.run(root, 'carrier', env(AUTO_UPDATE='0', STEAM_PASS='must-not-leak')), 0)
            install.assert_not_called()
            environment = console.run.call_args.args[2]
            self.assertEqual(environment['WINEARCH'], 'win32')
            self.assertEqual(environment['SteamAppId'], '1489630')
            self.assertEqual(environment['WINEPREFIX'], str(root / '.wine'))
            self.assertNotIn('STEAM_PASS', environment)
            self.assertEqual(console.run.call_args.args[3], '\x03')


if __name__ == '__main__':
    unittest.main()
