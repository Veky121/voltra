"""Offline Windows-safe fixtures. Never invokes Docker, Steam or native binaries."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

BASE = Path('internal/panel/game_library/scripts')
for file in ('steam-template', 'native-console', 'source-install', 'source-runtime',
             'source-next-install', 'source-l4d', 'source-third-install', 'source-third-runtime', 'cs2-runtime'):
    name = file.replace('-', '_')
    spec = importlib.util.spec_from_file_location(name, BASE / (file + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
runtime = sys.modules['cs2_runtime']


class CS2Parity(unittest.TestCase):
    def test_invalid_native_destination_refuses_before_managed_writes(self):
        for name in ('voltra-native.cfg','server.cfg','voltra-managed.cfg','voltra-server.cfg'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); env=self.fixture(root)
                cfg=root/'game/csgo/cfg'; cfg.mkdir(parents=True)
                (cfg/name).mkdir()
                before={p.name:p.is_dir() for p in cfg.iterdir()}
                with self.assertRaises(ValueError): runtime.configure(root,env)
                self.assertEqual({p.name:p.is_dir() for p in cfg.iterdir()},before)

    def test_parent_file_refuses_before_automatic_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = self.fixture(root)
            (root / 'game/csgo').write_bytes(b'operator parent file')
            env['AUTO_UPDATE'] = '1'
            with patch.object(runtime.shared, 'install') as install:
                with self.assertRaises(ValueError):
                    runtime.main(root, env)
                install.assert_not_called()
            self.assertEqual((root / 'game/csgo').read_bytes(), b'operator parent file')

    def test_in_volume_directory_alias_refuses_without_touching_operator_files(self):
        # Windows directory junctions expose this same authority problem; use
        # lstat seam here so no elevated symlink privilege is needed on Windows.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root)
            cfg = root / 'game/csgo/cfg'; cfg.mkdir(parents=True)
            operator = cfg / 'server.cfg'; operator.write_bytes(b'// preserve me\n')
            original = Path.is_symlink
            def alias(path):
                return path == cfg or original(path)
            with patch.object(Path, 'is_symlink', alias):
                with self.assertRaises(ValueError): runtime.configure(root, env)
            self.assertEqual(operator.read_bytes(), b'// preserve me\n')
            self.assertEqual(list(cfg.iterdir()), [operator])

    def fixture(self, root):
        binary = root / 'game/bin/linuxsteamrt64/cs2'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b'fixture, not publisher executable')
        return dict(VOLTRA_SOURCE_THIRD='cs2', SRCDS_APPID='730', SERVER_PORT='28010',
                    VOLTRA_ALLOCATED_PORTS='28010,28011', SERVER_NAME='Fixture', AUTO_UPDATE='0')

    def test_persistent_settings_and_operator_bytes_survive_reconfigure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root)
            cfg = root / 'game/csgo/cfg/server.cfg'; cfg.parent.mkdir(parents=True)
            cfg.write_bytes(b'// operator\r\nunknown_setting 17\r\n')
            original = cfg.read_bytes()
            argv, _, query = runtime.configure(root, env)
            native = cfg.with_name(runtime.NATIVE)
            native.write_bytes(b'// custom\r\nmp_friendlyfire 1\r\nunknown_setting 8\r\n')
            content = native.read_bytes()
            runtime.configure(root, env)
            self.assertEqual(native.read_bytes(), content)
            self.assertEqual(cfg.read_bytes(), original)
            self.assertEqual(argv[argv.index('+map') - 2:argv.index('+map')], ['+exec', runtime.NATIVE])
            self.assertIn('exec ' + runtime.NATIVE, cfg.with_name('voltra-server.cfg').read_text())
            self.assertEqual(query, (28010, 'Fixture', 'de_dust2', False))
            selected = sys.modules['source_install'].protected_files(root, 'game/csgo')
            self.assertIn(native, selected)

    def test_invalid_settings_do_not_seed_native_file(self):
        for extra in ({'VOLTRA_SOURCE_THIRD': 'sven'}, {'STEAM_GSLT': 'secret-invalid'},
                      {'TV_PORT': '28010'}, {'SERVER_NAME': 'x;quit'}):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); env = self.fixture(root); env.update(extra)
                with self.assertRaises(ValueError): runtime.configure(root, env)
                self.assertFalse((root / 'game/csgo/cfg' / runtime.NATIVE).exists())

    def test_successful_and_failed_reinstall_restore_native_and_operator_bytes(self):
        shared_install = sys.modules['source_install']
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); env = self.fixture(root)
                runtime.configure(root, env)
                native = root / 'game/csgo/cfg' / runtime.NATIVE
                native.write_bytes(b'// operator bytes\r\nmp_friendlyfire 1\r\nunknown 9\r\n')
                original = native.read_bytes()
                def update(*args, **kwargs):
                    self.assertEqual(args[1], 730)
                    native.write_bytes(b'publisher replacement')
                    if fail: raise RuntimeError('fixture publisher failure')
                    return {'buildid': 'fixture-only'}
                # Windows lacks Unix fd ownership calls. Only byte restoration is
                # asserted here; Linux ownership/mode acceptance remains pending.
                with patch.object(shared_install, 'steam_update', side_effect=update), \
                     patch.object(os, 'fchmod', create=True), patch.object(os, 'fchown', create=True):
                    if fail:
                        with self.assertRaises(RuntimeError): runtime.shared.install(root, env)
                    else:
                        self.assertEqual(runtime.shared.install(root, env)['buildid'], 'fixture-only')
                self.assertEqual(native.read_bytes(), original)

    def test_native_exit_stop_redaction_and_observer_cancellation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root)
            env.update(SERVER_PASSWORD='privatejoin', RCON_PASSWORD='privateadmin', STEAM_GSLT='a'*32)
            cancelled = threading.Event()
            def query(*args, **kwargs):
                if args[-1].wait(2): cancelled.set()
            def child(*args, **kwargs):
                self.assertEqual(args[3], 'quit')
                self.assertTrue(kwargs['terminal_input'])
                for key in ('SERVER_PASSWORD', 'RCON_PASSWORD', 'STEAM_GSLT'):
                    self.assertIn(env[key], args[4]); self.assertNotIn(env[key], ' '.join(args[1]))
                kwargs['output_observer'](b'native fixture output\n')
                return 42
            with patch.object(runtime.shared.source_l4d, 'query_ready', side_effect=query), patch.object(runtime.shared, 'run', side_effect=child):
                self.assertEqual(runtime.main(root, env), 42)
            self.assertTrue(cancelled.is_set())

    def test_staged_profile_original_controls_and_no_fabricated_status(self):
        recipe = 'counter_strike/counter_strike_2/egg-counter--strike2.json'
        profile = json.loads(Path('artifacts/game-parity-20261029/cs2-authority-20261030/profile.pending.json').read_text())[recipe]
        imported = next(e for e in json.loads(Path('internal/panel/game_library/upstream/catalog.json').read_text())['entries'] if e['path'] == recipe)
        variables = {v['env_variable']: v for v in profile['egg']['variables']}
        self.assertTrue(set(v['env_variable'] for v in imported['egg']['variables']) <= variables.keys())
        self.assertEqual(profile['upstream_sha256'], imported['sha256'])
        self.assertEqual(profile['verification'], 'not_verified')
        self.assertEqual(variables['STEAM_GSLT']['field_type'], 'password')
        self.assertTrue(variables['STEAM_GSLT']['rules'].startswith('nullable|'))
        self.assertEqual(profile['egg']['scripts']['installation']['script'].count("<<'VOLTRA_CS2'"), 1)
        self.assertIn((BASE / 'cs2-runtime.py').read_text(), profile['egg']['scripts']['installation']['script'])


if __name__ == '__main__': unittest.main()
