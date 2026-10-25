"""Offline source fixtures. No publisher, Wine or Steam executables are run."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

BASE = Path(os.environ.get('FANTASY_SCRIPTS', '/scripts'))


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, BASE / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


steam = load('steam_template', 'steam-template.py')
load('native_config', 'native-config.py')
load('native_console', 'native-console.py')
runtime = load('fantasy_worlds_runtime', 'fantasy-worlds-runtime.py')
installer = load('fantasy_worlds_install', 'fantasy-worlds-install.py')
build = load('fantasy_worlds_wine_build', 'fantasy-worlds-wine-build.py')
wine = load('fantasy_worlds_wine', 'fantasy-worlds-wine.py')
DEFAULTS = json.loads((BASE / 'fantasy-worlds-defaults.json').read_text())
runtime.defaults = lambda: copy.deepcopy(DEFAULTS)


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='fantasy-fixture-')
        self.root = Path(self.temporary.name)
        self.env = {'SERVER_PORT': '28015', 'VOLTRA_ALLOCATED_PORTS': '28015,27015,28016', 'ADMIN_PASSWD': '秘密$"admin', 'PORTAL_INSTALL_MODE': 'uploaded'}

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, relative, value, mode=0o640):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value.encode() if isinstance(value, str) else value)
        target.chmod(mode)
        return target

    def json(self, relative, value):
        return self.write(relative, json.dumps(value))

    def archive(self, entries):
        with zipfile.ZipFile(self.root / 'dedicated_server.zip', 'w') as archive:
            for name, content in entries.items():
                archive.writestr(name, content)

    def test_citadel_original_world_tuple_and_password_scope(self):
        seed = DEFAULTS['citadel_game_ini'] + '\n[Other]\nPassword=untouched\nCustomKey=42\n'
        self.write('Config/Game.ini', seed)
        before = runtime.world_tuple(seed)
        cwd, argv, stop, secrets, ready = runtime.citadel(self.root, self.env)
        for path in ('Config/Game.ini', 'Citadel/Saved/Config/LinuxServer/Game.ini', 'Engine/Saved/Config/LinuxServer/Game.ini'):
            text = (self.root / path).read_text()
            self.assertEqual(runtime.world_tuple(text), before)
            self.assertIn('Password=untouched', text)
            self.assertRegex(text, r'ConnectionPort=\s*28015')
            self.assertRegex(text, r'QueryPort=\s*27015')
            self.assertEqual((self.root / path).stat().st_mode & 0o777, 0o600)
        self.assertIn(self.env['ADMIN_PASSWD'], secrets)
        self.assertIn('YourServerPassword', secrets)
        self.assertEqual(stop, '\x03')
        self.assertEqual(argv[0], '/bin/bash')
        self.assertEqual(ready, b'Steam Server initialized and registered with UWorks')
        self.assertRegex((self.root / 'Citadel/Saved/Config/LinuxServer/Engine.ini').read_text(), r'Port\s*=\s*28015')

    def test_citadel_legacy_links_and_native_unknowns(self):
        self.write('Config/Game.ini', DEFAULTS['citadel_game_ini'])
        for branch in ('Citadel', 'Engine'):
            link = self.root / branch / 'Saved/Config/LinuxServer'
            link.parent.mkdir(parents=True)
            link.symlink_to('../../../Config', target_is_directory=True)
        runtime.citadel(self.root, self.env)
        self.assertTrue((self.root / 'Citadel/Saved/Config/LinuxServer').is_symlink())
        self.assertEqual((self.root / 'Engine/Saved/Config/LinuxServer/Game.ini').read_bytes(), (self.root / 'Config/Game.ini').read_bytes())

    def test_citadel_native_directories_not_deleted(self):
        self.write('Citadel/Saved/Config/LinuxServer/Game.ini', DEFAULTS['citadel_game_ini'] + '\n[Custom]\n+Plugins=example\n')
        marker = self.write('Citadel/Saved/Config/LinuxServer/custom.dat', 'keep')
        runtime.citadel(self.root, self.env)
        self.assertEqual(marker.read_text(), 'keep')
        self.assertIn('+Plugins=example', marker.with_name('Game.ini').read_text())

    def test_unreal_casefold_managed_keys_and_duplicate_rejection(self):
        value = runtime.unreal_ini('[uworks]\nconnectionport=1\nOther=7\n', {'UWorks': {'ConnectionPort': '28015'}})
        self.assertRegex(value, r'connectionport=\s*28015')
        self.assertIn('Other=7', value)
        for content in ('[UWorks]\nConnectionPort=1\nconnectionport=2\n', '[UWorks]\n[uworks]\n'):
            with self.assertRaises(ValueError):
                runtime.unreal_ini(content, {'UWorks': {'ConnectionPort': '2'}})

    def test_invalid_ports_fail_before_config_writes(self):
        for changes in ({'VOLTRA_ALLOCATED_PORTS': '28015,28016'}, {'QPORT': '28015'}, {'QPORT': 'abc'}, {'SERVER_PORT': '65536'}):
            with self.assertRaises(ValueError):
                runtime.citadel(self.root, {**self.env, **changes})
            self.assertEqual(list(self.root.iterdir()), [])

    def test_portal_permissions_custom_fields_save_and_secrets(self):
        config = copy.deepcopy(DEFAULTS['portal'])
        config['users']['canKickPlayers'] = True
        config['guests']['canLogin'] = True
        config['admins']['futurePermission'] = {'allowed': ['x']}
        config['basicServerData']['saveFolderPath'] = './custom-worlds'
        self.json('dedicated_server/server_config.json', config)
        world = self.write('dedicated_server/custom-worlds/world.dat', b'world-data')
        env = {**self.env, 'ADMIN_PASS': 'secret\"$Ω', 'USER_PASS': '', 'GUEST_PASS': '客', 'SERVER_NAME': '島$server', 'GAMEMODE': 'Creative', 'UNIVERSE_SIZE': 'Large', 'STEAM_PASS': 'unused'}
        cwd, argv, environment, stop, secrets, ready = runtime.configure(self.root, 'portal', env)
        value = json.loads((self.root / 'dedicated_server/server_config.json').read_text())
        self.assertTrue(value['users']['canKickPlayers'])
        self.assertTrue(value['guests']['canLogin'])
        self.assertEqual(value['admins']['futurePermission'], {'allowed': ['x']})
        self.assertEqual(value['basicServerData']['saveFolderPath'], './custom-worlds')
        self.assertEqual(value['basicServerData']['port'], 28015)
        self.assertEqual(value['gameplayMode'], 'Creative')
        self.assertEqual(value['admins']['credentials']['password'], env['ADMIN_PASS'])
        self.assertFalse(value['hideConsoleWindow'])
        self.assertNotIn('STEAM_PASS', environment)
        self.assertNotIn('ADMIN_PASS', environment)
        self.assertNotIn(env['ADMIN_PASS'], ' '.join(argv))
        self.assertIn(env['ADMIN_PASS'], secrets)
        self.assertEqual(world.read_bytes(), b'world-data')
        self.assertEqual(ready, b'VOLTRA_PORTAL_READY')

    def test_portal_controls_reject_without_writes(self):
        for changes in ({'GAMEMODE': 'Adventure;exit'}, {'UNIVERSE_SIZE': 'Infinite'}, {'WINEARCH': 'arm64'}, {'SERVER_NAME': 'x\ny'}, {'ADMIN_PASS': 'a' * 65}, {'PORTAL_INSTALL_MODE': 'invalid'}, {'WINDOWS_INSTALL': '0'}):
            with self.assertRaises(ValueError):
                runtime.configure(self.root, 'portal', {**self.env, **changes})
            self.assertEqual(list(self.root.iterdir()), [])

    def test_portal_confined_custom_save_paths(self):
        for value in ('../outside', '/outside', 'C:/outside', 'a\\b', '', '../../outside'):
            with self.assertRaises(ValueError):
                runtime.portal_save_path(self.root, {'basicServerData': {'saveFolderPath': value}})

    def test_portal_steam_mode_private_credentials_gate_before_writes(self):
        for function in (installer.install, runtime.configure):
            with patch.object(steam, 'update', side_effect=AssertionError('must not call Steam')):
                with self.assertRaises(ValueError):
                    function(self.root, 'portal', {**self.env, 'PORTAL_INSTALL_MODE': 'steam', 'STEAM_USER': 'owner', 'STEAM_PASS': 'secret'})
            self.assertEqual(list(self.root.iterdir()), [])

    def test_solace_preserves_native_admin_world_and_unknown_settings(self):
        config = copy.deepcopy(DEFAULTS['solace'])
        config.update(name='custom', isPrivate=True, requireSteamID=False, allowAdmin=True, adminPassword='admin$秘密', allowModerator=True, moderatorPassword='mod', worldSaveToUse='CustomWorld', autoRestart=17, unknown={'x': True})
        self.json(runtime.SOLACE + '/servercfg.dat', config)
        world = self.write(runtime.SOLACE + '/Worlds/CustomWorld/save.dat', b'persist')
        cwd, argv, environment, stop, secrets, ready = runtime.configure(self.root, 'solace', self.env)
        value = json.loads((self.root / runtime.SOLACE / 'servercfg.dat').read_text())
        self.assertEqual(value, {**config, 'port': 28015, 'steamQueryPort': 27015})
        self.assertEqual(world.read_bytes(), b'persist')
        self.assertIn('admin$秘密', secrets)
        self.assertEqual(environment['XDG_CONFIG_HOME'], str(self.root / '.config'))
        self.assertTrue(argv[0].endswith('Solace Crafting.x86_64'))
        self.assertNotIn('admin$秘密', ' '.join(argv))
        self.assertEqual(ready, b' server started . (True)')

    def test_solace_invalid_native_access_types_fail_before_write(self):
        for key, value in (('allowAdmin', 'false'), ('maxPlayers', 0), ('worldSaveToUse', '../bad'), ('autoRestart', -1)):
            config = {**DEFAULTS['solace'], key: value}
            path = self.json(runtime.SOLACE + '/servercfg.dat', config)
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                runtime.solace(self.root, self.env)
            self.assertEqual(path.read_bytes(), before)

    def test_json_duplicates_and_nonfinite_fail(self):
        for value in ('{"admins":{},"admins":{}}', '{"port":NaN}', '[]'):
            path = self.write('test.json', value)
            with self.assertRaises(ValueError):
                runtime.read_json(path)

    def test_retention_restores_deleted_and_overwritten_state_metadata(self):
        config = self.write('Config/Game.ini', 'operator config', 0o640)
        world = self.write('Citadel/Saved/SaveGames/world.sav', 'world', 0o660)
        empty = self.root / 'Citadel/Saved/Empty'; empty.mkdir(mode=0o750)
        with tempfile.TemporaryDirectory() as backup:
            state = installer.Retention(self.root, 'citadel', backup)
            config.write_text('vendor default')
            shutil.rmtree(self.root / 'Citadel/Saved')
            state.restore()
        self.assertEqual(config.read_text(), 'operator config')
        self.assertEqual(world.read_text(), 'world')
        self.assertEqual(world.stat().st_mode & 0o777, 0o660)
        self.assertEqual(empty.stat().st_mode & 0o777, 0o750)

    def test_failed_steam_update_still_restores_world(self):
        world = self.write(runtime.SOLACE + '/Worlds/MultiplayerWorld/world.dat', 'old world')
        def overwrite(*args, **kwargs):
            world.write_text('publisher overwrite')
            raise RuntimeError('synthetic publisher update failure')
        with patch.object(steam, 'update', side_effect=overwrite):
            with self.assertRaises(RuntimeError):
                installer.install(self.root, 'solace', self.env)
        self.assertEqual(world.read_text(), 'old world')

    def test_retention_rejects_external_links(self):
        outside = self.root / 'outside'; outside.mkdir()
        (self.root / 'Config').symlink_to(outside)
        with tempfile.TemporaryDirectory() as backup:
            with self.assertRaises(ValueError):
                installer.Retention(self.root, 'citadel', backup)

    def test_steam_options_gate_before_preservation_and_processes(self):
        for changes in ({'STEAM_PASS': 'secret'}, {'EXTRA_FLAGS': '+quit'}, {'SRCDS_APPID': '123'}, {'INSTALL_FLAGS': '+quit'}):
            with patch.object(steam, 'update', side_effect=AssertionError('Steam must not run')):
                with self.assertRaises(ValueError):
                    installer.install(self.root, 'solace', {**self.env, **changes})
            self.assertEqual(list(self.root.iterdir()), [])

    def test_citadel_sdk_legacy_link_and_unexpected_link(self):
        self.write('.steam/sdk64/steamclient.so', b'official SDK fixture')
        self.write('linux64/steamclient.so', b'legacy SDK fixture')
        target = self.root / 'Citadel/Plugins/UWorks/Source/ThirdParty/Linux/steamclient.so'
        target.parent.mkdir(parents=True)
        target.symlink_to('../../../../../../linux64/steamclient.so')
        installer.install_sdk(self.root)
        self.assertFalse(target.is_symlink())
        self.assertEqual(target.read_bytes(), b'official SDK fixture')
        target.unlink(); target.symlink_to(self.root / 'outside')
        with self.assertRaises(ValueError):
            installer.install_sdk(self.root)

    def test_portal_archive_skips_all_operator_paths_case_insensitively(self):
        config = copy.deepcopy(DEFAULTS['portal']); config['basicServerData']['saveFolderPath'] = './custom-world'
        path = self.json('dedicated_server/server_config.json', config)
        world = self.write('dedicated_server/custom-world/world', 'keep')
        self.archive({'bundle/pk_dedicated_server.exe': b'publisher fixture', 'bundle/server_config.json': b'overwrite', 'bundle/Custom-World/world': b'overwrite', 'bundle/Savedata/new': b'not operator data'})
        installer.unpack_portal(self.root)
        self.assertEqual(json.loads(path.read_text()), config)
        self.assertEqual(world.read_text(), 'keep')
        self.assertFalse((self.root / 'dedicated_server/Savedata').exists())
        self.assertEqual((self.root / 'dedicated_server/pk_dedicated_server.exe').read_bytes(), b'publisher fixture')

    def test_portal_archive_traversal_duplicates_links_and_wrapper_reject(self):
        cases = [
            {'pk_dedicated_server.exe': b'x', '../escape': b'y'},
            {'pk_dedicated_server.exe': b'x', 'A.dll': b'a', 'a.DLL': b'b'},
            {'bundle/pk_dedicated_server.exe': b'x', 'other/file': b'y'},
            {'pk_dedicated_server.exe': b'x', '/absolute': b'y'},
        ]
        for entries in cases:
            self.archive(entries)
            with self.assertRaises(ValueError):
                installer.unpack_portal(self.root)
            self.assertFalse((self.root / 'dedicated_server/pk_dedicated_server.exe').exists())
        with zipfile.ZipFile(self.root / 'dedicated_server.zip', 'w') as archive:
            archive.writestr('pk_dedicated_server.exe', b'x')
            entry = zipfile.ZipInfo('link'); entry.create_system = 3; entry.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(entry, '../outside')
        with self.assertRaises(ValueError):
            installer.unpack_portal(self.root)

    def test_portal_program_collisions_preserved(self):
        program = self.write('dedicated_server/pk_dedicated_server.exe', 'operator modified')
        self.archive({'pk_dedicated_server.exe': b'new publisher'})
        with self.assertRaises(ValueError):
            installer.unpack_portal(self.root)
        self.assertEqual(program.read_text(), 'operator modified')

    def test_portal_late_publish_failure_rolls_back_exact_inode(self):
        self.archive({'pk_dedicated_server.exe': b'first', 'game.dll': b'old'})
        installer.unpack_portal(self.root)
        self.archive({'pk_dedicated_server.exe': b'second', 'game.dll': b'new'})
        original = steam._publish
        def late(root, relative, writer, **kwargs):
            result = original(root, relative, writer, **kwargs)
            if relative.endswith('/game.dll'):
                raise RuntimeError('synthetic failure after atomic rename')
            return result
        with patch.object(steam, '_publish', side_effect=late):
            with self.assertRaises(RuntimeError):
                installer.unpack_portal(self.root)
        self.assertEqual((self.root / 'dedicated_server/pk_dedicated_server.exe').read_bytes(), b'first')
        self.assertEqual((self.root / 'dedicated_server/game.dll').read_bytes(), b'old')

    def test_portal_receipt_post_rename_failure_restores_old_generation(self):
        self.archive({'pk_dedicated_server.exe': b'old'})
        installer.unpack_portal(self.root)
        receipt = self.root / '.voltra/fantasy-worlds/portal-files.json'
        previous = receipt.read_bytes()
        self.archive({'pk_dedicated_server.exe': b'new', 'new.dll': b'added'})
        original, failed = steam._publish, []
        def late(root, relative, writer, **kwargs):
            result = original(root, relative, writer, **kwargs)
            if relative.endswith('portal-files.json') and not failed:
                failed.append(True)
                raise RuntimeError('synthetic receipt post-rename failure')
            return result
        with patch.object(steam, '_publish', side_effect=late):
            with self.assertRaises(RuntimeError):
                installer.unpack_portal(self.root)
        self.assertEqual((self.root / 'dedicated_server/pk_dedicated_server.exe').read_bytes(), b'old')
        self.assertFalse((self.root / 'dedicated_server/new.dll').exists())
        self.assertEqual(receipt.read_bytes(), previous)

    def test_runtime_auto_update_off_skips_installer(self):
        configured = (self.root, ['native-fixture'], {}, '\x03', [], b'ready')
        for value in ('0', 'false'):
            with patch.object(sys, 'argv', ['runtime', 'solace']), patch.dict(os.environ, {'AUTO_UPDATE': value}, clear=True), patch.object(Path, 'cwd', return_value=self.root), patch.object(installer, 'install', side_effect=AssertionError('must not update')), patch.object(runtime, 'configure', return_value=configured), patch.object(runtime, 'run', return_value=7):
                self.assertEqual(runtime.main(), 7)

    def test_wine_build_receipt_requires_source_and_binary_hash(self):
        self.write('.voltra/fantasy_worlds_wine_console.c', b'fixture source')
        self.write('.voltra/fantasy_worlds_wine_console.exe', b'MZinvalid')
        self.json('.voltra/fantasy_worlds_wine_console.json', {'schema_version': 1, 'source_sha256': 'bad', 'binary_sha256': 'bad'})
        self.assertIsNone(build.verified_build(self.root))

    def test_uploaded_payload_mode_no_steam_or_dummy_credentials(self):
        self.write('dedicated_server/pk_dedicated_server.exe', b'not an executable, only source fixture')
        with patch.object(steam, 'update', side_effect=AssertionError('Uploaded mode must not call Steam')), patch.object(build, 'ensure', return_value={'source': 'fixture'}) as ensure:
            result = installer.install(self.root, 'portal', {**self.env, 'STEAM_USER': '', 'STEAM_PASS': ''})
        self.assertEqual(result['source'], 'operator-uploaded')
        ensure.assert_called_once_with(self.root)

    def test_uploaded_mode_missing_payload_fails(self):
        with patch.object(steam, 'update', side_effect=AssertionError('no Steam')):
            with self.assertRaises(ValueError):
                installer.install(self.root, 'portal', self.env)

    def test_wine_pid_selection_is_exact_and_unambiguous(self):
        self.assertEqual(wine.windows_pid(b'"pk_dedicated_server.exe","123","Console"\n'), '123')
        for data in (b'"other.exe","123"', b'"pk_dedicated_server.exe","0"', b'"pk_dedicated_server.exe","123"\n"PK_DEDICATED_SERVER.EXE","124"', b'"pk_dedicated_server.exe","+123"'):
            with self.assertRaises(ValueError):
                wine.windows_pid(data)

    def test_wine_command_is_stdin_only_and_receipt_guarded(self):
        class Result:
            returncode = 0
            stdout = b'"pk_dedicated_server.exe","123"\n'
        with patch.object(wine, 'verified_build', return_value=True), patch.object(wine.subprocess, 'run', return_value=Result()) as run:
            wine.console(self.root, {}, 'secret command $Ω')
            self.assertEqual(run.call_args.kwargs['input'], 'secret command $Ω\n'.encode())
            self.assertNotIn('secret command', ' '.join(run.call_args.args[0]))
            self.assertEqual(run.call_args.args[0][-1], '123')
            wine.console(self.root, {}, '\x03')
            self.assertEqual(run.call_args.kwargs['input'], b'\x03\n')
        with patch.object(wine, 'verified_build', return_value=False), patch.object(wine.subprocess, 'run', side_effect=AssertionError('must not execute')):
            with self.assertRaises(ValueError):
                wine.console(self.root, {}, 'status')

    def test_wine_readiness_chunking_and_no_old_log_assumption(self):
        ready = wine.Readiness()
        self.assertFalse(ready.feed(b'Listen'))
        self.assertTrue(ready.feed(b'ing on 28015'))
        self.assertFalse(ready.feed(b'ReadyToServe'))
        self.assertFalse(wine.Readiness().ready)

    def test_wine_utf16_and_split_secret_redaction_before_stream_merge(self):
        for encoding in ('utf-8', 'utf-16'):
            channel = wine.PrivateStream(['secretΩ', 'Listening on'])
            raw = 'Listening on 28015 secretΩ\n'.encode(encoding)
            output = b''.join(channel.feed(raw[index:index + 3]) for index in range(0, len(raw), 3)) + channel.feed(b'', final=True)
            self.assertNotIn('secretΩ'.encode(), output)
            self.assertNotIn(b'Listening on', output)
            self.assertTrue(channel.readiness.ready)
            self.assertIn(b'[redacted]', output)

    def test_wine_invalid_log_encoding_never_forwards_raw_bytes(self):
        channel = wine.PrivateStream(['secret'])
        with self.assertRaises(UnicodeError):
            channel.feed(b'\xff\x00secret')

    def test_wine_prefix_architecture_preserved(self):
        path = self.write('.wine/system.reg', 'WINE REGISTRY Version 2\n#arch=win64\n')
        self.assertEqual(wine.private_prefix(self.root, {'WINEARCH': 'win64'})['WINEPREFIX'], str(self.root / '.wine'))
        with self.assertRaises(ValueError):
            wine.private_prefix(self.root, {'WINEARCH': 'win32'})
        self.assertIn('#arch=win64', path.read_text())

    def test_original_boolean_controls_typed(self):
        for value in ('0', 'false', False): self.assertFalse(runtime.boolean(value))
        for value in ('1', 'true', True): self.assertTrue(runtime.boolean(value))
        for value in ('yes', '1;echo', ''):
            with self.assertRaises(ValueError): runtime.boolean(value)

    def test_config_path_symlink_refused(self):
        outside = self.root / 'outside'; outside.mkdir()
        (self.root / 'dedicated_server').symlink_to(outside)
        with self.assertRaises(ValueError):
            runtime.portal(self.root, self.env)
        self.assertEqual(list(outside.iterdir()), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
