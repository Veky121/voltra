import importlib.util
import json
import io
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'internal/panel/game_library/scripts/automation-sims.py'
spec = importlib.util.spec_from_file_location('automation_sims', SOURCE)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def env(**values):
    return {'SERVER_PORT': '28020', 'VOLTRA_ALLOCATED_PORTS': '28020,28021,28022', **values}


def put(root, name, content):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


class AutomationSimsTests(unittest.TestCase):
    def test_eco_json_types_original_controls_and_literal_license_argv(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            put(root, 'Configs/Network.eco', '{"Operator":{"Keep":true},"Description":"old","MaxConnections":10}')
            put(root, 'Configs/Localization.eco', '{"Operator":"keep"}')
            args, secrets = adapter.configure(root, 'eco', env(SLG_USER='name with spaces', SLG_PW='literal;$(not-a-command)"', SRV_NAME='Eco 日本 "quoted"', DEDES='line1\nline2', MAX_CON='-1', WEBSRVURL='https://eco.example.invalid:443', LANGUAGE='German'))
            config = json.loads((root / 'Configs/Network.eco').read_text())
            self.assertEqual(config['Name'], 'Eco 日本 "quoted"')
            self.assertEqual(config['Description'], config['Name'])
            self.assertEqual(config['DefaultSlots'], -1)
            self.assertEqual(config['MaxConnections'], -1)
            self.assertEqual(config['DetailedDescription'], 'line1\nline2')
            self.assertIs(config['PublicServer'], False)
            self.assertEqual(config['WebServerPort'], 28021)
            self.assertEqual(config['RconServerPort'], 28022)
            self.assertEqual(config['Operator'], {'Keep': True})
            self.assertEqual(args[1:], ['--username=name with spaces', '--password=literal;$(not-a-command)"'])
            self.assertIn('literal;$(not-a-command)"', secrets)
            self.assertEqual(json.loads((root / 'Configs/Localization.eco').read_text()), {'Language': 'German', 'Operator': 'keep'})

    def test_eco_invalid_language_and_duplicate_json_do_not_partially_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            network = put(root, 'Configs/Network.eco', '{"Operator":1}')
            put(root, 'Configs/Localization.eco', '{}')
            with self.assertRaises(ValueError):
                adapter.configure(root, 'eco', env(SLG_USER='account', SLG_PW='password', LANGUAGE='invalid'))
            self.assertEqual(network.read_text(), '{"Operator":1}')
            put(root, 'Configs/Localization.eco', '{"Language":"English","Language":"German"}')
            with self.assertRaises(ValueError):
                adapter.configure(root, 'eco', env(SLG_USER='account', SLG_PW='password'))
            self.assertEqual(network.read_text(), '{"Operator":1}')

    def test_foundry_all_settings_properties_wine_path_and_large_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = put(root, 'App.cfg', '# retain comment\noperator_field=yes\nmap_seed=1\n')
            args, secrets = adapter.configure(root, 'foundry', env(SERVER_NAME='Foundry spaces', SRV_PW='literal; "pass"', WORLD_NAME='Factory 2', SAVE_PATH='/home/container/custom saves', MAP_SEED='18446744073709551615', PAUSE_SERVER='false', PUBLIC_SERVER='false', MAX_PLAYERS='8', AUTOSAVE_INTERVAL='120'))
            result = config.read_text()
            self.assertIn('# retain comment\noperator_field=yes', result)
            self.assertIn('mapseed=18446744073709551615', result)
            self.assertIn('map_seed=18446744073709551615', result)
            self.assertIn('pause_server_when_empty=false', result)
            self.assertIn('server_max_players=8', result)
            self.assertIn('server_query_port=28021', result)
            self.assertIn('server_persistent_data_override_folder=Z:', result)
            self.assertIn('custom saves', result)
            self.assertEqual(args, ['xvfb-run', '-a', 'wine', str(root / 'FoundryDedicatedServer.exe'), '-log'])
            self.assertEqual(secrets, ['literal; "pass"'])

    def test_foundry_path_and_wine_verb_rejections_before_config_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = put(root, 'App.cfg', 'operator=yes\n')
            for values in ({'SAVE_PATH': '/etc'}, {'SAVE_PATH': '../outside'}, {'WINETRICKS_RUN': 'mono; touch /tmp/no'}, {'XVFB': '0'}, {'MAP_SEED': '-1'}):
                with self.subTest(values=values), self.assertRaises(ValueError):
                    adapter.configure(root, 'foundry', env(**values))
                self.assertEqual(config.read_text(), 'operator=yes\n')

    def test_fortress_original_world_difficulty_ini_and_argv(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = put(root, 'Default/firstrun.ini', '; operator comment\n[config]\nUnknown = keep\nName = old\n')
            override = put(root, 'Default/serveroverrides.ini', '[config]\nOther = keep\n')
            args, secrets = adapter.configure(root, 'fortress', env(SERVER_NAME='literal -- world', WORLDNAME='Factory World', G_RESOURCE='greg', G_CONVEYOR='fast', G_POWER='plentiful', G_DAY='night', G_CAREPACKAGE='true', G_FLATLAND='true', G_RushMode='true', PUBLIC='true', AUTO_PAUSE='false', MAX_PLAYERS='10', RCON_PASSWORD='literal;pass'))
            self.assertIn('; operator comment', first.read_text())
            for value in ('Unknown = keep', 'Name = literal -- world', 'Resources = greg', 'RushMode = true', 'FlatLand = true'):
                self.assertIn(value, first.read_text())
            self.assertIn('RCONPort = 28021', override.read_text())
            self.assertIn('AutoPause = false', override.read_text())
            self.assertEqual(args[-2:], ['-logFile', str(root / 'unity.log')])
            self.assertEqual(secrets, ['literal;pass'])

    def test_allocations_reject_collisions_unallocated_and_symlink_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            put(root, 'Default/firstrun.ini', '[config]\n')
            target = put(root, 'Default/serveroverrides.ini', '[config]\n')
            for value in ('28020', '9999'):
                with self.assertRaises(ValueError):
                    adapter.configure(root, 'fortress', env(RCON_PORT=value))
            target.unlink(); target.symlink_to('/tmp/foreign-automation.ini')
            with self.assertRaises(ValueError):
                adapter.configure(root, 'fortress', env())

    def test_private_steam_and_arbitrary_flags_fail_before_downloading(self):
        for game in adapter.GAMES:
            for values in ({'STEAM_USER': 'owner', 'STEAM_PASS': 'private'}, {'STEAM_AUTH': '12345'}, {'SRCDS_BETAPASS': 'private'}, {'INSTALL_FLAGS': '+quit'}):
                with mock.patch.object(adapter.steam, 'update') as update, self.assertRaises(ValueError):
                    adapter.install(Path('/nonexistent'), game, values)
                update.assert_not_called()
        with self.assertRaises(ValueError):
            adapter.options('foundry', {'WINDOWS_INSTALL': '0'})
        with self.assertRaises(ValueError):
            adapter.options('fortress', {'SRCDS_APPID': '739590'})

    def test_install_only_seeds_missing_examples_and_preserves_existing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            put(root, 'Default/Example Server Ini files/firstrun.ini', '-- publisher note\n[config]\nName = example -- comment\n')
            put(root, 'Default/Example Server Ini files/serveroverrides.ini', '[config]\nServerPort=27015\n')
            with mock.patch.object(adapter.steam, 'update'):
                adapter.install(root, 'fortress', {})
            first = root / 'Default/firstrun.ini'
            self.assertNotIn('--', first.read_text())
            first.write_text('[config]\nName=operator -- literal\n')
            with mock.patch.object(adapter.steam, 'update'):
                adapter.install(root, 'fortress', {})
            self.assertEqual(first.read_text(), '[config]\nName=operator -- literal\n')

    def test_foundry_sdk_platform_order_and_operator_cfg_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = put(root, 'App.cfg', 'operator=yes\n')
            with mock.patch.object(adapter.steam, 'update') as update, mock.patch.object(adapter.shared.release, 'download') as download:
                adapter.install(root, 'foundry', {'WINDOWS_INSTALL': '1'})
                self.assertEqual([call.args[1] for call in update.call_args_list], [1007, 2915550])
                self.assertTrue(all(call.kwargs['platform'] == 'windows' for call in update.call_args_list))
                download.assert_not_called()
            self.assertEqual(config.read_text(), 'operator=yes\n')

    def test_supervisor_uses_derived_auto_update_and_original_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            console = mock.Mock(); console.run.return_value = 0
            with mock.patch.object(adapter, 'install') as install, mock.patch.object(adapter, 'configure', return_value=(['./EcoServer'], ['license-secret'])), mock.patch.object(adapter, 'helper', return_value=console):
                self.assertEqual(adapter.run(root, 'eco', {'AUTO_UPDATE': '0', 'VOLTRA_STEAM_AUTO_UPDATE': '1'}), 0)
                install.assert_called_once()
                self.assertEqual(console.run.call_args.args[3], 'exit')
                self.assertTrue(console.run.call_args.kwargs['terminal_input'])

    def test_unity_log_bridge_retains_unicode_redacts_and_drains_final_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            log = put(Path(directory), 'unity.log', 'Filename: noisy\nHeadless server active 日本語\nsecret=secret-password\nfinal save complete\n')
            finished = threading.Event(); finished.set()
            output = io.StringIO()
            with mock.patch.object(adapter.sys, 'stdout', output):
                adapter.follow_unity(log, finished, ['secret-password'])
            self.assertIn('日本語', output.getvalue())
            self.assertIn('final save complete', output.getvalue())
            self.assertIn('[redacted]', output.getvalue())
            self.assertNotIn('secret-password', output.getvalue())
            self.assertNotIn('Filename:', output.getvalue())

    def test_fortress_bridge_only_other_family_stop_kwargs_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            console = mock.Mock(); console.run.return_value = 42
            bridge = mock.Mock(); bridge.supervise.return_value = -2
            def helper(name):
                return bridge if name == 'automation-fortress-console' else console
            with mock.patch.object(adapter, 'configure', return_value=(['/owned/native'], ['secret'])), mock.patch.object(adapter, 'helper', side_effect=helper):
                self.assertEqual(adapter.run(root, 'fortress', env(AUTO_UPDATE='0')), 130)
                self.assertEqual(bridge.supervise.call_args.args[-1], 28021)
                console.run.assert_not_called()
                for game, stop in [('eco', 'exit'), ('foundry', '\x03')]:
                    self.assertEqual(adapter.run(root, game, env(AUTO_UPDATE='0')), 42)
                    self.assertEqual(console.run.call_args.args[3], stop)
                    self.assertEqual(console.run.call_args.kwargs, {'terminal_input': True})


if __name__ == '__main__':
    unittest.main()
