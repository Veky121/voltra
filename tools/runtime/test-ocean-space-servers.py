"""Offline source fixtures, not publisher game acceptance."""
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import selectors
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, BASE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
load('steam_template', 'steam-template.py')
load('additional_survival_install', 'additional-survival-install.py')
game = load('ocean_space_servers', 'ocean-space-servers.py')


class OceanSpaceTests(unittest.TestCase):
    def windrose(self, root):
        path = root / 'R5/ServerDescription.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'Version': 1, 'DeploymentId': 'publisher-fixture', 'ServerDescription_Persistent': {'PersistentServerId': 'publisher-server-id', 'WorldIslandId': 'publisher-world-id', 'UserSelectedRegion': 'EU', 'UnknownNative': [1, 2]}}))
        return path

    def test_windrose_all_original_controls_typed_and_publisher_ids_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = self.windrose(root)
            path.chmod(0o640)
            game.configure(root, 'windrose', {'SERVER_NAME': 'A $ Pirate Server', 'SERVER_PASSWORD': 'quoted"$literal', 'SERVER_PASSWORD_PROTECTED': '1', 'MAX_PLAYERS': '8', 'INVITE_CODE': 'Abc123', 'USE_DIRECT_CONNECTION': '1', 'SERVER_IP': '192.168.1.50', 'SERVER_PORT': '28010'})
            obj = json.loads(path.read_text())
            data = obj['ServerDescription_Persistent']
            self.assertEqual(data['PersistentServerId'], 'publisher-server-id')
            self.assertEqual(data['WorldIslandId'], 'publisher-world-id')
            self.assertEqual(data['UnknownNative'], [1, 2])
            self.assertEqual(data['UserSelectedRegion'], 'EU')
            self.assertEqual(data['InviteCode'], 'Abc123')
            self.assertEqual(data['DirectConnectionServerAddress'], '192.168.1.50')
            self.assertEqual(data['DirectConnectionServerPort'], 28010)
            self.assertEqual(data['P2pProxyAddress'], '127.0.0.1')
            self.assertTrue(data['UseDirectConnection'])
            self.assertTrue(data['IsPasswordProtected'])
            self.assertEqual(data['Password'], 'quoted"$literal')
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_windrose_missing_config_never_bootstraps_unallocated_or_open_defaults(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game, 'install') as install, patch.object(game.console, 'run') as run:
            with self.assertRaises(ValueError): game.launch(Path(d), 'windrose', {'SERVER_PORT': '28010'})
            install.assert_not_called()
            run.assert_not_called()
            self.assertFalse((Path(d) / 'R5/ServerDescription.json').exists())

    def test_windrose_missing_identity_or_invalid_invite_reject(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = self.windrose(root)
            with self.assertRaises(ValueError): game.configure(root, 'windrose', {'INVITE_CODE': 'bad!code'})
            path.write_text('{"ServerDescription_Persistent":{}}')
            with self.assertRaises(ValueError): game.configure(root, 'windrose', {})

    def test_voyagers_original_ini_controls_and_unknown_gameplay_settings(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = root / 'BoatGame/Saved/PersistedData/CustomConfig/CustomHostServerUserSettings.ini'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'; publisher\r\n[/Script/BoatGame.BGCustomHostServerSettings]\r\nHostServerDisplayName=old\r\nUnknownNative=retained\r\n')
            path.chmod(0o640)
            game.configure(root, 'voyagers', {'SERVER_NAME': 'New Server', 'SERVER_PASSWORD': 'alpha_dash', 'MAX_PLAYERS': '7', 'AUTOSAVE_TIMER_SECONDS': '450'})
            data = path.read_bytes()
            for value in [b'HostServerDisplayName= New Server\r\n', b'HostServerPassword = alpha_dash\r\n', b'MaxPlayers = 7\r\n', b'AutosaveTimerSeconds = 450\r\n', b'UnknownNative=retained\r\n']: self.assertIn(value, data)
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_starrupture_original_string_json_fields_and_existing_passwords(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = root / 'DSSettings.txt'
            path.write_text('{"UnknownNative":{"kept":true}}')
            password = root / 'Password.json'
            password.write_text('{"password":"fixture-native-encrypted-value"}')
            before = password.read_bytes()
            game.configure(root, 'starrupture', {'SESSION_NAME': 'Session One', 'SAVEGAME_NAME': 'ManualSave.sav', 'SAVE_INTERVAL': '420', 'START_NEW': 'true', 'LOAD_SAVE': 'false', 'ADMIN_PASSWORD': 'ignored-existing-native'})
            data = json.loads(path.read_text())
            self.assertEqual(data['SaveGameInterval'], '420')
            self.assertEqual(data['StartNewGame'], 'true')
            self.assertEqual(data['LoadSavedGame'], 'false')
            self.assertEqual(data['SaveGameName'], 'ManualSave.sav')
            self.assertEqual(data['UnknownNative'], {'kept': True})
            self.assertEqual(password.read_bytes(), before)
            self.assertEqual((root / '.pteroignore').read_text(), game.IGNORE)

    def test_starrupture_exact_native_and_legacy_password_schemas_preserve_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = root / 'Password.json'
            for field in ('Password', 'password'):
                body = json.dumps({field: 'native-ciphertext', 'UnknownNative': True}).encode()
                path.write_bytes(body)
                game.password_prerequisites(root, {'ADMIN_PASSWORD': 'fixture-only'})
                self.assertEqual(path.read_bytes(), body)
            for value in ({'Password': 'one', 'password': 'two'}, {'PASSWORD': 'cipher'}, {'Password': ''}, {'Password': 1}, []):
                body = json.dumps(value).encode()
                path.write_bytes(body)
                with self.assertRaises(ValueError):
                    game.password_prerequisites(root, {'ADMIN_PASSWORD': 'fixture-only'})
                self.assertEqual(path.read_bytes(), body)

    def test_starrupture_missing_password_file_fails_before_any_network(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game, 'update') as update:
            for env in [{'ADMIN_PASSWORD': 'fixture-only'}, {'PLAYER_PASSWORD': 'fixture-only'}]:
                with self.assertRaises(ValueError): game.install(Path(d), 'starrupture', env)
            update.assert_not_called()
            self.assertFalse((Path(d) / 'Password.json').exists())

    def test_json_ambiguity_and_path_injection_reject(self):
        for value in ['{"a":1,"a":2}', '{"x":NaN}', '[]']:
            with self.assertRaises(ValueError): game.json_object(value)
        with tempfile.TemporaryDirectory() as d:
            for env in [{'SAVEGAME_NAME': '../escape.sav'}, {'SESSION_NAME': '../escape'}, {'SERVER_PORT': '28010', 'VOLTRA_ALLOCATED_PORTS': '28011'}]:
                with self.assertRaises(ValueError): game.configure(Path(d), 'starrupture', env)

    def test_original_launch_flags_and_signal_scope(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.assertEqual(game.command(root, 'windrose', {})[-1:], ['-log'])
            self.assertEqual(game.command(root, 'voyagers', {'SERVER_PORT': '28010'})[-3:], ['-Port=28010', '-log', '-LoggingInShippingEnabled=true'])
            self.assertEqual(game.command(root, 'starrupture', {'SERVER_PORT': '28012'})[-4:], ['-Log', '-Port=28012', '-RCWebControlDisable', '-RCWebInterfaceDisable'])

    def test_private_steam_gate_and_no_payload_substitution(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game, 'update') as update:
            for env in [{'STEAM_USER': 'private'}, {'STEAM_PASS': 'fixture'}, {'SRCDS_BETAPASS': 'fixture'}, {'INSTALL_FLAGS': '+other_command'}]:
                with self.assertRaises(ValueError): game.install(Path(d), 'voyagers', env)
            update.assert_not_called()
            with self.assertRaises(ValueError): game.install(Path(d), 'voyagers', {'WINDOWS_INSTALL': '0'})
            with self.assertRaises(ValueError): game.install(Path(d), 'voyagers', {'SRCDS_APPID': '123'})

    def test_exact_steam_app_windows_platform_and_public_branch(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game, 'update', return_value={'fixture_only': True}) as update:
            game.install(Path(d), 'voyagers', {'SRCDS_BETAID': 'testing'})
            self.assertEqual(update.call_args.args[1], 3937860)
            self.assertEqual(update.call_args.kwargs['platform'], 'windows')
            self.assertEqual(update.call_args.kwargs['required'], ('BoatGame/Binaries/Win64/BoatGameServer-Win64-Shipping.exe',))

    def preservation(self, failure, selection='voyagers'):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            names = {'voyagers': ['BoatGame/Saved/PersistedData/SaveData/operator.sav', 'BoatGame/Saved/PersistedData/CustomConfig/CustomGameUserSettings.ini', 'BoatGame/Content/Paks/~mods/operator.pak', 'BoatGame/Plugins/operator/config.json'], 'windrose': ['R5/ServerDescription.json', 'R5/Saved/SaveProfiles/Default/RocksDB_v2/fixture/db', 'R5/Saved/SaveProfiles/Default/RocksDB_v2_Backups/fixture/db', 'R5/Binaries/Win64/ue4ss/Mods/operator/main.lua'], 'starrupture': ['DSSettings.txt', 'Password.json', 'PlayerPassword.json', '.pteroignore', 'StarRupture/Saved/SaveGames/operator/ManualSave.sav', 'modloader/Plugins/operator/config.json']}[selection]
            paths = [root / name for name in names]
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'{"password":"fixture-encrypted"}' if path.name in ('Password.json', 'PlayerPassword.json') else b'operator\r\n' + path.name.encode())
                path.chmod(0o640)
                if os.getuid() == 0: os.chown(path, 988, 988)
            before = {path: (path.read_bytes(), path.stat().st_mode & 0o777, path.stat().st_uid, path.stat().st_gid) for path in paths}
            def publisher(*_, **__):
                for path in paths:
                    path.write_bytes(b'publisher overwrite')
                    path.chmod(0o644)
                if failure: raise RuntimeError('fixture acquisition failure')
                return {'fixture_only': True}
            with patch.object(game, 'update', side_effect=publisher):
                if failure:
                    with self.assertRaises(RuntimeError): game.install(root, selection, {})
                else: game.install(root, selection, {})
            for path, expected in before.items(): self.assertEqual((path.read_bytes(), path.stat().st_mode & 0o777, path.stat().st_uid, path.stat().st_gid), expected)

    def test_reinstall_success_preserves_save_mod_config_bytes_permissions_ownership(self): self.preservation(False)
    def test_reinstall_failure_preserves_save_mod_config_bytes_permissions_ownership(self): self.preservation(True)
    def test_starrupture_admin_password_save_backup_rules_and_mods_retained(self):
        self.preservation(False, 'starrupture')
        self.preservation(True, 'starrupture')
    def test_windrose_server_identity_world_databases_backups_and_mods_retained(self):
        self.preservation(False, 'windrose')
        self.preservation(True, 'windrose')

    def test_symlink_escape_before_steam_update(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as outside, patch.object(game, 'update') as update:
            root = Path(d)
            (root / 'BoatGame').mkdir()
            (root / 'BoatGame/Saved').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError): game.install(root, 'voyagers', {})
            update.assert_not_called()

    def test_empty_wine_verbs_no_runtime_download_and_private_paths_only(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            env = game.wine_environment(root, 'voyagers', {'STEAM_PASS': 'fixture', 'XVFB': '0'})
            self.assertEqual(env['WINEPREFIX'], str(root / '.wine'))
            self.assertEqual(env['XVFB'], '0')
            self.assertNotIn('STEAM_PASS', env)
            for values in [{'VOLTRA_WINETRICKS_RUN': 'arbitrary; command'}, {'WINEPREFIX': '/tmp/not-private'}, {'WINEPATH': '/tmp/not-private'}, {'WINEARCH': 'win32'}]:
                with self.assertRaises(ValueError): game.wine_environment(root, 'windrose', values)
            with self.assertRaises(ValueError): game.wine_environment(root, 'starrupture', {})

    def test_derived_auto_update_and_shared_sigint_keep_actual_exit(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game, 'install') as install, patch.object(game.console, 'run', return_value=37) as run:
            root = Path(d)
            self.assertEqual(game.launch(root, 'voyagers', {'VOLTRA_STEAM_AUTO_UPDATE': '1', 'AUTO_UPDATE': '0'}), 37)
            install.assert_called_once()
            install.reset_mock()
            self.assertEqual(run.call_args.kwargs['stop_signal'], signal.SIGINT)
            game.launch(root, 'voyagers', {'VOLTRA_STEAM_AUTO_UPDATE': '0', 'AUTO_UPDATE': '1'})
            install.assert_not_called()

    def test_actual_wrapper_sigint_targets_tiny_native_fixture_and_keeps_exit_code(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            native = root / 'fixture_native.py'
            native.write_text('import signal,sys,time\ndef stop(*_):\n print("fixture-native-SIGINT",flush=True)\n sys.exit(23)\nsignal.signal(signal.SIGINT,stop)\nprint("fixture-native-ready",flush=True)\nwhile True: time.sleep(.05)\n')
            wine = root / 'wine'
            wine.write_text('#!/bin/sh\nexec ' + sys.executable + ' ' + str(native) + '\n')
            wine.chmod(0o700)
            launcher = root / 'fixture_wrapper.py'
            # Import this test module under a normal module name, without executing unittest.main.
            launcher.write_text('import importlib.util,sys,os\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location("fixture_import",' + repr(str(Path(__file__))) + ')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nenv=dict(os.environ,AUTO_UPDATE="0",VOLTRA_STEAM_AUTO_UPDATE="0")\nsys.exit(m.game.launch(Path(' + repr(d) + '),"voyagers",env))\n')
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'])
            for key in ('WINEPREFIX', 'WINEARCH', 'WINEPATH', 'WINETRICKS_RUN', 'VOLTRA_WINETRICKS_RUN'): env.pop(key, None)
            child = subprocess.Popen([sys.executable, '-B', str(launcher)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
            output = b''
            try:
                selector = selectors.DefaultSelector()
                selector.register(child.stdout, selectors.EVENT_READ)
                deadline = time.monotonic() + 5
                while b'fixture-native-ready' not in output and time.monotonic() < deadline:
                    if selector.select(0.1): output += os.read(child.stdout.fileno(), 65536)
                    if child.poll() is not None: break
                selector.close()
                self.assertIn(b'fixture-native-ready', output)
                child.send_signal(signal.SIGINT)
                tail, _ = child.communicate(timeout=5)
                output += tail
                self.assertEqual(child.returncode, 23)
                self.assertIn(b'fixture-native-SIGINT', output)
            finally:
                if child.poll() is None:
                    child.terminate()
                    child.communicate(timeout=5)

    def test_log_tail_filter_rotation_and_password_redaction(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'game.log'
            path.write_bytes(b'old not forwarded\n')
            output, finished = io.BytesIO(), threading.Event()
            with patch.object(game.sys, 'stdout', SimpleNamespace(buffer=output)):
                worker = threading.Thread(target=game.follow_log, args=(path, finished, ('fixture-secret',), True))
                worker.start()
                try:
                    time.sleep(0.15)
                    with path.open('ab') as stream: stream.write(b'LogCore: Warning ignored\nnormal fixture-secret\n')
                    end = time.monotonic() + 2
                    while b'normal' not in output.getvalue() and time.monotonic() < end: time.sleep(0.01)
                    path.rename(path.with_suffix('.old'))
                    path.write_bytes(b'rotation fixture-secret\n')
                    end = time.monotonic() + 2
                    while b'rotation' not in output.getvalue() and time.monotonic() < end: time.sleep(0.01)
                finally:
                    finished.set()
                    worker.join(timeout=2)
            value = output.getvalue()
            self.assertFalse(worker.is_alive())
            self.assertIn(b'normal', value)
            self.assertIn(b'rotation', value)
            self.assertNotIn(b'old not forwarded', value)
            self.assertNotIn(b'LogCore: Warning', value)
            self.assertNotIn(b'fixture-secret', value)


if __name__ == '__main__': unittest.main()
