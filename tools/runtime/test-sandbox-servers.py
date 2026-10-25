"""Offline source fixtures only. No Steam, game or Wine process is run."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import signal
import selectors
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

BASE = Path('/scripts')
def load(name, source):
    spec = importlib.util.spec_from_file_location(name, BASE / source)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module
    spec.loader.exec_module(module); return module
steam = load('steam_template', 'steam-template.py')
load('native_config', 'native-config.py'); load('native_console', 'native-console.py')
runtime = load('fantasy_worlds_runtime', 'fantasy-worlds-runtime.py')
load('fantasy_worlds_install', 'fantasy-worlds-install.py')
load('fantasy_worlds_wine_build', 'fantasy-worlds-wine-build.py')
load('fantasy_worlds_wine', 'fantasy-worlds-wine.py')
release = load('sandbox_servers_release', 'sandbox-servers-release.py')
app = load('sandbox_servers', 'sandbox-servers.py')
DEFAULTS = json.loads((BASE / 'sandbox-servers-defaults.json').read_text())
app.defaults = lambda: copy.deepcopy(DEFAULTS)


class Fixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.env = {'SERVER_PORT': '28015', 'VOLTRA_ALLOCATED_PORTS': '28015,27015,28016', 'SERVER_NAME': 'MonRP', 'SERVER_LIST_NAME': 'My "RP" $server', 'HOSTNAME': '遊' * 32}
    def tearDown(self): self.temp.cleanup()
    def write(self, relative, data, mode=0o640):
        path = self.root / relative; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data.encode() if isinstance(data, str) else data); path.chmod(mode); return path
    def json(self, relative, data): return self.write(relative, json.dumps(data))
    def archive(self, kind='zip', entries=None):
        entries = entries or {'BeamMP-Server.exe': b'fake, non-executable fixture', 'default.txt': b'original'}
        archive = self.root / ('publisher.' + kind)
        if kind == 'zip':
            with zipfile.ZipFile(archive, 'w') as out:
                for name, data in entries.items(): out.writestr(name, data)
        else:
            with tarfile.open(archive, 'w:gz' if kind == 'gz' else 'w:xz') as out:
                for name, data in entries.items():
                    item = tarfile.TarInfo(name); item.size = len(data); item.mode = 0o750; out.addfile(item, io.BytesIO(data))
        return archive

    def test_nova_preserves_admin_whitelist_shop_map_save_unknown(self):
        config = copy.deepcopy(DEFAULTS['nova'])
        config.update(isPublicServer=True, useAdminPinAuth=True, adminPin='private', whitelist={'intro': 'custom', 'questions': ['q'], 'date': 'today'}, hasShop=True, mapId=7, autoSaveIntervalSeconds=17, disconnectClientsBeforeStop=False, future={'enabled': True})
        path = self.json('Servers/MonRP/Config/server.json', config)
        world = self.write('Servers/MonRP/life.db', b'operator database')
        argv, env, secrets, ready = app.configure(self.root, 'nova', self.env)
        value = json.loads(path.read_text())
        self.assertEqual(value, {**config, 'serverName': 'MonRP', 'serverListName': self.env['SERVER_LIST_NAME'], 'serverSlot': 25, 'serverPort': 28015})
        self.assertEqual(world.read_bytes(), b'operator database')
        self.assertEqual(argv[-2:], ['-startServer', 'MonRP'])
        self.assertIn('private', secrets)
        self.assertNotIn('private', ' '.join(argv))
        self.assertEqual(ready, b'Server launched in ')
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_nova_profile_change_never_renames_or_deletes_old_profile(self):
        old = self.write('Servers/OldProfile/life.db', 'old')
        app.configure(self.root, 'nova', {**self.env, 'SERVER_NAME': 'NewProfile'})
        self.assertEqual(old.read_text(), 'old')
        self.assertTrue((self.root / 'Servers/NewProfile/Config/server.json').is_file())

    def test_nova_unicode_alpha_dash_and_numeric_integral_slots(self):
        _, argv, _, _ = app.nova(self.root, {**self.env, 'SERVER_NAME': 'École_遊-1', 'SERVER_SLOTS': '2.5e1'})
        self.assertEqual(argv[-1], 'École_遊-1')
        app.nova(self.root, {**self.env, 'SERVER_SLOTS': '25.0'})
        for change in ({'SERVER_NAME': '../other'}, {'SERVER_NAME': 'space name'}, {'SERVER_NAME': ''}, {'SERVER_SLOTS': '1.5'}, {'SERVER_LIST_NAME': 'x\ny'}):
            with self.assertRaises(ValueError): app.nova(self.root, {**self.env, **change})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_nova_existing_or_explicit_extra_listeners_require_allocations(self):
        value = {**DEFAULTS['nova'], 'queryPort': 27015, 'steamPort': 28016}
        self.json('Servers/MonRP/Config/server.json', value)
        updates, _, _, _ = app.nova(self.root, self.env)
        self.assertEqual(updates[0][1]['queryPort'], 27015)
        with self.assertRaises(ValueError): app.nova(self.root, {**self.env, 'STEAM_PORT': '28015'})
        with self.assertRaises(ValueError): app.nova(self.root, {**self.env, 'QUERY_PORT': '9999'})

    def test_nova_seed_does_not_invent_new_listeners(self):
        updates, _, _, _ = app.nova(self.root, self.env)
        self.assertNotIn('queryPort', updates[0][1]); self.assertNotIn('steamPort', updates[0][1])

    def test_modiverse_preserves_pin_rcon_mapcycle_ugc_and_literal_hostname(self):
        value = copy.deepcopy(DEFAULTS['modiverse']); value.update(pin='1234', rconPassword='private RCON', future={'admin': ['a']})
        path = self.json(app.MOD_CONFIG, value)
        mod = self.write('KJMod/Binaries/Linux/ServerData/Mods/example.dat', b'mod')
        argv, _, secrets, ready = app.configure(self.root, 'modiverse', self.env)
        self.assertEqual(json.loads(path.read_text()), value)
        self.assertIn('-SteamServerName=' + '遊' * 32, argv)
        self.assertIn('-KJModBaseUGCFolder=ServerData', argv)
        self.assertIn('-DoNotRestartOnEmpty', argv); self.assertIn('-InitUGCs', argv)
        self.assertIn('-maxplayers=128', argv); self.assertIn('-queryport=27015', argv)
        self.assertIn('private RCON', secrets); self.assertEqual(mod.read_bytes(), b'mod')
        self.assertEqual(ready, b'listening on port')

    def test_modiverse_locked_query_and_slot_bounds(self):
        for change in ({'VOLTRA_ALLOCATED_PORTS': '28015,28016'}, {'QUERY_PORT': '28015'}, {'MAX_PLAYERS': '1'}, {'MAX_PLAYERS': '129'}):
            with self.assertRaises(ValueError): app.modiverse(self.root, {**self.env, **change})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_steam_private_credentials_invalid_app_flags_gate_before_writes(self):
        for game in ('nova', 'modiverse'):
            for change in ({'STEAM_PASS': 'secret'}, {'STEAM_USER': 'owner'}, {'SRCDS_APPID': '123'}, {'EXTRA_FLAGS': '+quit'}):
                with patch.object(steam, 'update', side_effect=AssertionError('no Steam process')):
                    with self.assertRaises(ValueError): app.install(self.root, game, {**self.env, **change})
            self.assertEqual(list(self.root.iterdir()), [])

    def test_steam_failure_restores_nova_database_and_plugin(self):
        db = self.write('Servers/MonRP/life.db', 'original', 0o660)
        plugin = self.write('Plugins/custom.dll', b'plugin')
        def update(*args, **kwargs):
            db.write_text('overwritten'); plugin.unlink(); raise RuntimeError('synthetic publisher failure')
        with patch.object(steam, 'update', side_effect=update):
            with self.assertRaises(RuntimeError): app.install(self.root, 'nova', self.env)
        self.assertEqual(db.read_text(), 'original'); self.assertEqual(plugin.read_bytes(), b'plugin')
        self.assertEqual(db.stat().st_mode & 0o777, 0o660)

    def test_successful_modiverse_update_retains_config_and_both_ugc_paths(self):
        config = self.json(app.MOD_CONFIG, {**DEFAULTS['modiverse'], 'rconPassword': 'operator'})
        first = self.write('ServerData/saves.dat', b'first')
        second = self.write('KJMod/Binaries/Linux/ServerData/mods.dat', b'second')
        def update(*args, **kwargs):
            config.write_text('{}'); first.unlink(); second.write_bytes(b'overwritten'); return {'source': 'fixture'}
        with patch.object(steam, 'update', side_effect=update): app.install(self.root, 'modiverse', self.env)
        self.assertEqual(json.loads(config.read_text())['rconPassword'], 'operator')
        self.assertEqual(first.read_bytes(), b'first'); self.assertEqual(second.read_bytes(), b'second')

    def test_generic_literal_executable_and_json_argv_no_shell(self):
        value = 'server folder/$()[];&name.exe'
        _, argv, secrets, ready = app.generic(self.root, {'SERVER_EXECUTABLE': value, 'SERVER_ARGUMENTS': '["name with spaces","$(touch nope)","--port=28015"]', 'CONSOLE_SECRETS': '["private"]'})
        self.assertEqual(argv, ['wine', str(self.root / value), 'name with spaces', '$(touch nope)', '--port=28015'])
        self.assertEqual(secrets, ['private']); self.assertIsNone(ready)
        self.assertFalse((self.root / 'nope').exists())

    def test_generic_install_directory_does_not_change_runtime_cwd_semantics(self):
        archive = self.archive(entries={'bin/server.exe': b'fixture'})
        env = {'INSTALL_SOURCE': 'uploaded', 'UPLOAD_ARCHIVE': archive.name, 'INSTALL_DIR': 'server/', 'SERVER_EXECUTABLE': './server/bin/server.exe'}
        app.install_generic(self.root, env)
        self.assertEqual((self.root / 'server/bin/server.exe').read_bytes(), b'fixture')
        self.assertEqual(app.generic(self.root, env)[1][1], str(self.root / 'server/bin/server.exe'))

    def test_generic_original_three_archive_formats(self):
        for kind in ('zip', 'gz', 'xz'):
            archive = self.archive(kind)
            env = {'INSTALL_SOURCE': 'uploaded', 'UPLOAD_ARCHIVE': archive.name}
            result = app.install_generic(self.root, env)
            self.assertEqual(result['source'], 'uploaded')
            self.assertTrue((self.root / 'BeamMP-Server.exe').is_file())
            receipt = json.loads((self.root / '.voltra/sandbox-servers/generic-files.json').read_text())
            self.assertEqual(receipt['archive']['sha256'], release.digest(archive))

    def test_generic_uploaded_existing_legal_files_need_no_download(self):
        self.write('BeamMP-Server.exe', b'not executable fixture')
        with patch.object(release, 'download', side_effect=AssertionError('no network')):
            result = app.install_generic(self.root, {'INSTALL_SOURCE': 'uploaded'})
        self.assertEqual(result['source'], 'uploaded-files')

    def test_generic_download_hash_gate_before_network_or_writes(self):
        with patch.object(release, 'download', side_effect=AssertionError('no network')):
            with self.assertRaises(ValueError): app.install_generic(self.root, {'DOWNLOAD_URL': 'https://example.test/file.zip'})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_generic_checksum_verified_https_url_kept_as_data(self):
        archive = self.archive()
        data, digest = archive.read_bytes(), release.digest(archive)
        class Response(io.BytesIO):
            headers = {}
            def geturl(self): return 'https://example.test/file.zip?name=$(literal)'
        class Opener:
            def open(self, value, timeout):
                self.value = value; return Response(data)
        opener = Opener(); target = self.root / 'download'
        with patch.object(release.urllib.request, 'build_opener', return_value=opener):
            release.download('https://example.test/file.zip?name=$(literal)', digest, target)
        self.assertEqual(target.read_bytes(), data)
        self.assertIn('$(literal)', opener.value)
        self.assertFalse((self.root / 'literal').exists())

    def test_generic_checksum_mismatch_and_https_redirect_policy(self):
        class Response(io.BytesIO):
            headers = {}
            def geturl(self): return 'https://example.test/archive'
        class Opener:
            def open(self, *args, **kwargs): return Response(b'wrong')
        with patch.object(release.urllib.request, 'build_opener', return_value=Opener()):
            with self.assertRaises(ValueError): release.download('https://example.test/archive', 'a' * 64, self.root / 'download')
        for value in ('http://example.test/file', 'https://user:secret@example.test/file', 'https://example.test/file#fragment'):
            with self.assertRaises(ValueError): release.url(value)

    def test_generic_archive_traversal_symlink_special_duplicates_casefold(self):
        cases = [
            {'BeamMP-Server.exe': b'x', '../escape': b'x'},
            {'BeamMP-Server.exe': b'x', 'A.dll': b'x', 'a.DLL': b'x'},
            {'BeamMP-Server.exe': b'x', 'A/a.dll': b'x', 'a/b.dll': b'x'},
            {'BeamMP-Server.exe': b'x', '.voltra/sandbox_servers.py': b'x'},
        ]
        for index, entries in enumerate(cases):
            archive = self.archive(entries=entries); target = self.root / ('target' + str(index)); target.mkdir()
            with self.assertRaises(ValueError): release.extract(archive, target)
        archive = self.root / 'link.gz'
        with tarfile.open(archive, 'w:gz') as out:
            member = tarfile.TarInfo('link'); member.type = tarfile.SYMTYPE; member.linkname = '../outside'; out.addfile(member)
        target = self.root / 'special'; target.mkdir()
        with self.assertRaises(ValueError): release.extract(archive, target)

    def test_generic_preserves_config_world_mod_paths(self):
        existing = self.write('ServerConfig.toml', 'operator key = secret')
        world = self.write('Worlds/old.sav', 'world')
        archive = self.archive(entries={'BeamMP-Server.exe': b'fake', 'ServerConfig.toml': b'default', 'Worlds/old.sav': b'overwritten'})
        app.install_generic(self.root, {'INSTALL_SOURCE': 'uploaded', 'UPLOAD_ARCHIVE': archive.name})
        self.assertEqual(existing.read_text(), 'operator key = secret'); self.assertEqual(world.read_text(), 'world')

    def test_generic_staging_and_rollback_use_server_disk(self):
        archive = self.archive()
        temporary_directory = tempfile.TemporaryDirectory
        locations = []
        def disk_only(*args, **kwargs):
            location = Path(kwargs['dir']).resolve()
            self.assertTrue(location.is_relative_to(self.root))
            locations.append(location)
            return temporary_directory(*args, **kwargs)
        with patch.object(tempfile, 'TemporaryDirectory', side_effect=disk_only):
            app.install_generic(self.root, {'INSTALL_SOURCE': 'uploaded', 'UPLOAD_ARCHIVE': archive.name})
        self.assertGreaterEqual(len(locations), 2)
        self.assertTrue((self.root / 'BeamMP-Server.exe').is_file())
        self.assertEqual(list(self.root.glob('.voltra-generic-*')), [])

    def test_generic_modified_program_collision_preserves_operator_file(self):
        program = self.write('BeamMP-Server.exe', b'operator modified')
        archive = self.archive()
        with self.assertRaises(ValueError): app.install_generic(self.root, {'INSTALL_SOURCE': 'uploaded', 'UPLOAD_ARCHIVE': archive.name})
        self.assertEqual(program.read_bytes(), b'operator modified')

    def test_generic_missing_archive_executable_fails_before_publication(self):
        archive = self.archive(entries={'different.exe': b'fixture'})
        with self.assertRaises(ValueError): app.install_generic(self.root, {'INSTALL_SOURCE': 'uploaded', 'UPLOAD_ARCHIVE': archive.name})
        self.assertFalse((self.root / 'different.exe').exists()); self.assertFalse((self.root / '.voltra').exists())

    def test_generic_publication_failure_after_rename_rolls_back_receipt_and_files(self):
        archive = self.archive(); env = {'INSTALL_SOURCE': 'uploaded', 'UPLOAD_ARCHIVE': archive.name}
        app.install_generic(self.root, env)
        receipt = self.root / '.voltra/sandbox-servers/generic-files.json'; previous = receipt.read_bytes()
        self.archive(entries={'BeamMP-Server.exe': b'new', 'new.dll': b'added'})
        original, injected = steam._publish, []
        def fail(root, relative, writer, **kwargs):
            result = original(root, relative, writer, **kwargs)
            if relative.endswith('generic-files.json') and not injected:
                injected.append(True); raise RuntimeError('synthetic post-rename failure')
            return result
        with patch.object(steam, '_publish', side_effect=fail):
            with self.assertRaises(RuntimeError): app.install_generic(self.root, env)
        self.assertEqual((self.root / 'BeamMP-Server.exe').read_bytes(), b'fake, non-executable fixture')
        self.assertFalse((self.root / 'new.dll').exists()); self.assertEqual(receipt.read_bytes(), previous)

    def test_generic_empty_directory_archive_support(self):
        archive = self.archive()
        with zipfile.ZipFile(archive, 'a') as out: out.writestr('required-empty/', b'')
        app.install_generic(self.root, {'INSTALL_SOURCE': 'uploaded', 'UPLOAD_ARCHIVE': archive.name})
        self.assertTrue((self.root / 'required-empty').is_dir())

    def test_generic_paths_aliases_and_escape_guards(self):
        self.assertEqual(app.volume_path(self.root, '/home/container/bin/../server.exe'), self.root / 'server.exe')
        self.assertEqual(app.volume_path(self.root, '/mnt/server/a b'), self.root / 'a b')
        for value in ('../escape', '/etc/passwd', 'C:/Windows/server.exe', 'x\\y'):
            with self.assertRaises(ValueError): app.volume_path(self.root, value)
        with self.assertRaises(ValueError): app.install_generic(self.root, {'INSTALL_DIR': '.voltra'})

    def test_generic_untrusted_json_arguments_reject_but_valid_literal_values_stay(self):
        for value in ('[1]', '{"arg":"value"}', '"--x"', '["bad\\nline"]'):
            with self.assertRaises(ValueError): app.string_list(value)
        self.assertEqual(app.string_list('["--x","", "\\\"quoted\\\""]'), ['--x', '', '"quoted"'])

    def test_native_environment_removes_private_credentials_and_preserves_readiness(self):
        argv, environment, credentials, marker = app.configure(self.root, 'generic', {'STEAM_PASS': 'secret', 'STEAM_USER': 'owner', 'CONSOLE_SECRETS': '["secret"]', 'READINESS_MARKER': 'actual startup'})
        self.assertNotIn('STEAM_PASS', environment); self.assertNotIn('CONSOLE_SECRETS', environment)
        self.assertEqual(credentials, ['secret']); self.assertEqual(marker, b'actual startup')
        self.assertEqual(environment['WINEPREFIX'], str(self.root / '.wine'))

    def test_runtime_auto_update_disabled_preserves_native_exit_and_stop(self):
        self.write('nova-life.x86_64', b'not executable fixture')
        with patch.object(sys, 'argv', ['runtime', 'nova', 'run']), patch.dict(os.environ, {**self.env, 'AUTO_UPDATE': '1', 'VOLTRA_STEAM_AUTO_UPDATE': '0'}, clear=True), patch.object(Path, 'cwd', return_value=self.root), patch.object(app, 'install', side_effect=AssertionError('update disabled')), patch.object(app.native_console, 'run', return_value=7) as native:
            self.assertEqual(app.main(), 7)
        self.assertEqual(native.call_args.args[3], '\x03')
        self.assertTrue(native.call_args.kwargs['terminal_input'])
        self.assertEqual(native.call_args.kwargs['stop_signal'], signal.SIGINT)

    def test_generic_runtime_owns_display_and_only_observed_marker_emits_ready(self):
        self.write('BeamMP-Server.exe', b'not executable fixture')
        class Display:
            terminated = False
            def poll(self): return None
            def terminate(self): self.terminated = True
            def wait(self, timeout): return 0
        screen = Display()
        def native(root, argv, environment, stop, **kwargs):
            kwargs['output_observer'](b'Listening ')
            kwargs['output_observer'](b'on 28015\n')
            return 4
        with patch.object(sys, 'argv', ['runtime', 'generic', 'run']), patch.dict(os.environ, {'READINESS_MARKER': 'Listening on'}, clear=True), patch.object(Path, 'cwd', return_value=self.root), patch.object(app, 'display', return_value=(screen, {})), patch.object(app.native_console, 'run', side_effect=native), patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(app.main(), 4)
            self.assertEqual(output.getvalue(), 'VOLTRA_GENERIC_READY\n')
        self.assertTrue(screen.terminated)

    def test_generic_runtime_blank_marker_makes_no_ready_claim(self):
        self.write('BeamMP-Server.exe', b'not executable fixture')
        class Display:
            def poll(self): return 0
        def native(root, argv, environment, stop, **kwargs):
            kwargs['output_observer'](b'change me Listening on random status\n')
            return 0
        with patch.object(sys, 'argv', ['runtime', 'generic', 'run']), patch.dict(os.environ, {}, clear=True), patch.object(Path, 'cwd', return_value=self.root), patch.object(app, 'display', return_value=(Display(), {})), patch.object(app.native_console, 'run', side_effect=native), patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(app.main(), 0)
            self.assertEqual(output.getvalue(), '')

    def test_actual_utility_child_receives_sigint_and_raw_exit_is_preserved(self):
        child = self.write('signal_child.py', "import os,signal,sys\ndef stop(*_):\n os.write(1,b'FIXTURE_GOT_SIGINT\\n');sys.exit(7)\nsignal.signal(signal.SIGINT,stop)\nos.write(1,b'FIXTURE_READY\\n')\nsignal.pause()\n")
        supervisor = self.write('signal_supervisor.py', "import importlib.util,os,signal,sys\nfrom pathlib import Path\nfor name,file in [('steam_template','steam-template.py'),('native_console','native-console.py')]:\n spec=importlib.util.spec_from_file_location(name,Path('/scripts')/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)\nsys.exit(module.run(Path.cwd(),[sys.executable,sys.argv[1]],dict(os.environ),'\\x03',terminal_input=True,ready_marker=b'FIXTURE_READY',stop_signal=signal.SIGINT,stop_signal_timeout=3))\n")
        process = subprocess.Popen([sys.executable, str(supervisor), str(child)], cwd=self.root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
        output = b''
        try:
            while b'FIXTURE_READY' not in output:
                self.assertTrue(selector.select(timeout=5), 'utility readiness timed out')
                chunk = os.read(process.stdout.fileno(), 4096)
                self.assertTrue(chunk, 'utility exited before ready'); output += chunk
            process.send_signal(signal.SIGTERM)
            tail, _ = process.communicate(timeout=5); output += tail
            self.assertEqual(process.returncode, 7)
            self.assertIn(b'FIXTURE_GOT_SIGINT', output)
        finally:
            selector.close()
            if process.poll() is None: process.kill(); process.communicate(timeout=3)


if __name__ == '__main__': unittest.main(verbosity=2)
