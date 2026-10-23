import io
import os
import sys
import types
import tempfile
import threading
import tarfile
from pathlib import Path
import unittest
from unittest import mock
for name, source in SOURCES:
    module = types.ModuleType(name); exec(source, module.__dict__); sys.modules[name] = module
runtime = sys.modules['source_third_runtime']; install = sys.modules['source_third_install']
shared = sys.modules['source_install']


class SourceThirdTests(unittest.TestCase):
    def fixture(self, root, kind, **extra):
        app, game, binary = install.RECIPES[kind]
        executable = root / binary; executable.parent.mkdir(parents=True, exist_ok=True); executable.write_bytes(b'publisher')
        return {'VOLTRA_SOURCE_THIRD': kind, 'SRCDS_APPID': str(app), 'SERVER_PORT': '28010', 'VOLTRA_ALLOCATED_PORTS': '28010,28011', **extra}

    def test_cs2_all_original_launch_controls_and_private_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); token = 'a' * 32
            env = self.fixture(root, 'cs2', VAC_ENABLED='0', RCON_ENABLED='1', TV_PORT='28011', GAME_MODE='2', GAME_TYPE='1', SRCDS_MAP='de_mirage', MAX_PLAYERS='24', SERVER_NAME="Literal $value 'name'", SERVER_PASSWORD='privatejoin', RCON_PASSWORD='privatercon', STEAM_GSLT=token)
            argv, environment, query = runtime.configure(root, env)
            for option, value in [('-tv_port', '28011'), ('-maxplayers', '24'), ('+game_mode', '2'), ('+game_type', '1'), ('+map', 'de_mirage')]: self.assertEqual(argv[argv.index(option) + 1], value)
            for option in ('-dedicated', '-insecure', '-usercon'): self.assertIn(option, argv)
            for secret in ('privatejoin', 'privatercon', token): self.assertNotIn(secret, ' '.join(argv))
            managed = root / 'game/csgo/cfg/voltra-managed.cfg'
            self.assertEqual(managed.stat().st_mode & 0o777, 0o600); self.assertIn(token, managed.read_text())
            self.assertEqual(query, (28010, "Literal $value 'name'", 'de_mirage', True))
            self.assertIn('linuxsteamrt64', environment['LD_LIBRARY_PATH'])

    def test_cs2_port_and_command_delimiters_fail_closed(self):
        for extra in ({'TV_PORT': '28010'}, {'TV_PORT': '29000'}, {'SERVER_NAME': 'unsafe;quit'}, {'SRCDS_MAP': '../escape'}, {'GAME_TYPE': '1 +quit'}, {'STEAM_GSLT': 'not-a-token'}, {'RCON_ENABLED': 'yes'}):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); env = self.fixture(root, 'cs2', **extra)
                with self.assertRaises(ValueError): runtime.configure(root, env)
                self.assertFalse((root / 'game/csgo/cfg/voltra-managed.cfg').exists())

    def test_sven_original_aliases_and_operator_file_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root, 'sven', SC_MAP='stadium4', SC_PLAYERS='32', SC_NAME='Sven literal', SC_PASSWORD='join', SC_REGION='3')
            cfg = root / 'svencoop/server.cfg'; cfg.parent.mkdir(); cfg.write_bytes(b'// operator\r\nmp_fraglimit 73\r\n'); cfg.chmod(0o640)
            before = (cfg.read_bytes(), cfg.stat().st_mode, cfg.stat().st_uid, cfg.stat().st_gid)
            argv, _, query = runtime.configure(root, env)
            self.assertTrue(argv[0].endswith('svends_run')); self.assertEqual(argv[argv.index('+maxplayers') + 1], '32')
            self.assertEqual(query, (28010, 'Sven literal', 'stadium4', True)); self.assertIn('sv_region 3', cfg.with_name('voltra-managed.cfg').read_text())
            self.assertEqual(before, (cfg.read_bytes(), cfg.stat().st_mode, cfg.stat().st_uid, cfg.stat().st_gid))

    def test_native_install_preserves_configuration_even_on_publisher_failure(self):
        for kind in ('cs2', 'sven'):
            for fail in (False, True):
                with self.subTest(kind=kind, fail=fail), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory); env = self.fixture(root, kind); app, game, binary = install.RECIPES[kind]
                    cfg = root / game / ('server.cfg' if kind == 'sven' else 'cfg/server.cfg'); cfg.parent.mkdir(parents=True, exist_ok=True); cfg.write_bytes(b'operator bytes\r\n'); cfg.chmod(0o640)
                    def update(*args, **kwargs):
                        self.assertEqual(kwargs['required'], (binary,)); cfg.write_bytes(b'publisher replacement')
                        if fail: raise RuntimeError('publisher failure')
                        return {'buildid': '123'}
                    with mock.patch.object(shared, 'steam_update', side_effect=update):
                        if fail:
                            with self.assertRaises(RuntimeError): install.install(root, env)
                        else: self.assertEqual(install.install(root, env)['buildid'], '123')
                    self.assertEqual(cfg.read_bytes(), b'operator bytes\r\n'); self.assertEqual(cfg.stat().st_mode & 0o777, 0o640)

    def test_legacy_tf2c_controls_preserved_no_classified_substitution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root, 'tf2classic', SRCDS_GAME='tf2classic', SRCDS_BETAID='previous2021', MAXPLAYERS='28', SRCDS_MAP='ctf_2fort')
            argv, _, _ = runtime.configure(root, env); self.assertEqual(argv[argv.index('-game') + 1], 'tf2classic'); self.assertEqual(argv[argv.index('+maxplayers') + 1], '28')
            self.assertEqual(install.asset_version({'GAMEVERSION': '2.1.3'}), 'https://wiki.tf2classic.com/kachemak/tf2classic-2.1.3.tar.zst')
            with self.assertRaises(ValueError): install.selection({**env, 'SRCDS_BETAID': 'public'})
            with self.assertRaises(ValueError): install.asset_version({'GAMEVERSION': '../latest'})

    def test_publisher_urls_reject_mirrors_commands_and_unsafe_redirects(self):
        for url in ('http://wiki.tf2classic.com/kachemak/versions.json', 'https://evil.test/kachemak/versions.json', 'https://wiki.tf2classic.com/kachemak/../x', 'https://wiki.tf2classic.com/kachemak/versions.json?token=secret', 'https://user@wiki.tf2classic.com/kachemak/versions.json'):
            with self.subTest(url=url), self.assertRaises(ValueError): install.publisher_url(url)

    def test_private_credentials_rejected_before_legacy_asset_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root, 'tf2classic', STEAM_USER='privateaccount', STEAM_PASS='privatevalue')
            with mock.patch.object(install, 'asset_version') as network:
                with self.assertRaises(ValueError) as error: install.install(root, env)
                network.assert_not_called(); self.assertNotIn('privatevalue', str(error.exception))

    def test_readiness_worker_cancelled_when_native_runner_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root, 'sven'); observed = threading.Event()
            def query(*args, **kwargs):
                cancel = args[-1]; cancel.wait(2)
                if cancel.is_set(): observed.set()
            def child(*args, **kwargs): kwargs['output_observer'](b'actual child output\n'); return 250
            with mock.patch.object(runtime.source_l4d, 'query_ready', side_effect=query), mock.patch.object(runtime, 'run', side_effect=child) as native:
                self.assertEqual(runtime.main(root, env), 250)
            self.assertTrue(observed.is_set()); self.assertTrue(native.call_args.kwargs['terminal_input'])

    def test_no_native_output_never_starts_query_observer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root, 'sven')
            with mock.patch.object(runtime.source_l4d, 'query_ready') as query, mock.patch.object(runtime, 'run', return_value=255):
                self.assertEqual(runtime.main(root, env), 255)
            query.assert_not_called()

    def test_legacy_archive_traversal_is_rejected_before_write(self):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w') as archive:
            member = tarfile.TarInfo('tf2classic/../../escape'); member.size = 1; archive.addfile(member, io.BytesIO(b'x'))
        data.seek(0); process = mock.Mock(stdout=data); process.poll.return_value = 0
        with tempfile.TemporaryDirectory() as directory, mock.patch('subprocess.Popen', return_value=process):
            root = Path(directory)
            with self.assertRaises(ValueError): install.unpack(root / 'unused', root)
            self.assertEqual(list(root.iterdir()), [])

    def test_confined_binary_and_cfg_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory); env = self.fixture(root, 'sven'); (root / 'svencoop').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError): runtime.configure(root, env)


unittest.main()
