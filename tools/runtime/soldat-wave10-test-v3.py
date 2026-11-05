"""Scoped Soldat classic authority tests; no publisher acquisition or process start."""
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'internal/panel/game_library/scripts'
CANDIDATE = Path(__file__).with_name('soldat-wave10-native.py.v3.pending')


class Authority(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'game'
        self.root.mkdir()
        folder = Path(self.temp.name) / 'helpers'
        folder.mkdir()
        for name in ('soldat-native.py', 'native-config.py', 'native-release.py'):
            shutil.copyfile(SCRIPTS / name, folder / name)
        target = folder / 'soldat-classic-native.py'
        target.write_bytes(CANDIDATE.read_bytes())
        spec = importlib.util.spec_from_file_location('soldat_classic_fixture', target)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        self.env = {'SERVER_PORT': '29120', 'VOLTRA_ALLOCATED_PORTS': '29120,29130', 'SRV_NAME': 'Seed $ literal', 'MAX_PLAYERS': '8', 'ADMIN_PASSWD': 'fixture-admin', 'SRV_PWD': 'fixture-join', 'PUBLIC_SERVER': '0'}
        self.chown = patch.object(self.mod.os, 'chown', create=True, side_effect=lambda *a: None)
        self.chown.start()

    def tearDown(self):
        self.chown.stop()
        self.temp.cleanup()

    def test_fresh_original_controls_seed_once_then_native_values_win(self):
        self.mod.configure(self.root, self.env)
        config = self.root / 'soldat.ini'
        text = config.read_text()
        for value in ('Port = 29120', 'Max_Players = 8', 'Admin_Password = fixture-admin', 'Game_Password = fixture-join', 'Server_Name = Seed $ literal', 'Lobby_Register = 0'):
            self.assertIn(value, text)
        config.write_bytes(text.replace('Seed $ literal', 'Operator native').replace('Max_Players = 8', 'Max_Players = 6').replace('fixture-admin', 'operator-admin').replace('fixture-join', 'operator-join').replace('Lobby_Register = 0', 'Lobby_Register = 1').encode())
        before = config.read_bytes()
        mode = config.stat().st_mode
        self.mod.configure(self.root, self.env)
        self.mod.configure(self.root, self.env)
        self.assertEqual(config.read_bytes(), before)
        self.assertEqual(config.stat().st_mode, mode)

    def test_first_install_seeds_fresh_publisher_sample_then_reinstall_retains_operator(self):
        config = self.root / 'soldat.ini'
        def publisher(*args):
            if not config.exists():
                config.write_text('[NETWORK]\nPort=23073\nMax_Players=32\nGame_Password=\nAdmin_Password=\nServer_Name=Publisher sample\nLobby_Register=1\nUnknown=keep\n')
        import os
        previous = Path.cwd()
        try:
            os.chdir(self.root)
            with patch.object(self.mod.sys, 'argv', ['wrapper', 'install']), patch.dict(self.mod.os.environ, self.env, clear=True), patch.object(self.mod.base, 'install_soldat', side_effect=publisher):
                self.assertEqual(self.mod.main(), 0)
                self.assertIn('Server_Name= Seed $ literal', config.read_text())
                self.assertIn('Max_Players= 8', config.read_text())
                self.assertIn('Admin_Password= fixture-admin', config.read_text())
                self.assertIn('Unknown=keep', config.read_text())
                config.write_bytes(config.read_bytes().replace(b'Seed $ literal', b'Operator native'))
                retained = config.read_bytes()
                self.assertEqual(self.mod.main(), 0)
                self.assertEqual(config.read_bytes(), retained)
        finally:
            os.chdir(previous)

    def test_mixed_case_native_and_unknown_bytes_preserved_while_port_reconciles(self):
        config = self.root / 'soldat.ini'
        before = b'; comment\r\n[network]\r\npOrT=23073\r\nmax_players=6\r\ngame_password=operator\r\nadmin_password=operator-admin\r\nserver_name=Operator\r\nlobby_register=0\r\nUnknown = retained ; unknown\r\n[GAME]\r\nGameStyle=3\r\n'
        config.write_bytes(before)
        config.chmod(0o640)
        self.mod.configure(self.root, self.env)
        self.assertEqual(config.read_bytes(), before.replace(b'pOrT=23073', b'pOrT= 29120'))
        if hasattr(self.mod.os, 'geteuid'):
            self.assertEqual(config.stat().st_mode & 0o777, 0o640)

    def test_invalid_config_and_duplicate_aliases_refuse_without_path_changes(self):
        for content in ('[NETWORK]\nPort=29120\nMax_Players=99\n', '[NETWORK]\nPort=29120\nport=29120\n', '[NETWORK]\nPort=29120\n[network]\nServer_Name=x\n', '[NETWORK]\nPort=29120\nAdmin_Password='+'x'*21+'\n'):
            with self.subTest(content=content):
                config = self.root / 'soldat.ini'
                config.write_text(content)
                paths = sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*'))
                with self.assertRaises(ValueError):
                    self.mod.configure(self.root, {**self.env, 'ADMIN_PASSWD': ''})
                self.assertEqual(config.read_text(), content)
                self.assertEqual(sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*')), paths)

    def test_bad_allocation_and_seed_injection_refuse_before_writes(self):
        for values in ({'VOLTRA_ALLOCATED_PORTS': '29120,29121'}, {'SERVER_PORT': '65530'}, {'SRV_NAME': 'bad\nPort=9'}, {'SRCDS_APPID': '638490'}, {'ADMIN_PASSWD': '   '}):
            with self.assertRaises(ValueError):
                self.mod.configure(self.root, {**self.env, **values})
            self.assertEqual(list(self.root.iterdir()), [])

    def test_missing_admin_credential_is_persistent_private_and_not_regenerated(self):
        self.mod.configure(self.root, {**self.env, 'ADMIN_PASSWD': ''})
        secret = self.root / '.voltra/soldat/admin-password'
        value = secret.read_bytes()
        self.assertEqual(len(value.strip()), 20)
        self.mod.configure(self.root, {**self.env, 'ADMIN_PASSWD': ''})
        self.assertEqual(secret.read_bytes(), value)
        self.assertIn(value.strip(), (self.root / 'soldat.ini').read_bytes())

    def test_empty_native_admin_or_fallback_refuses_instead_of_interactive_prompt(self):
        config = self.root / 'soldat.ini'
        config.write_text('[NETWORK]\nPort=29120\nAdmin_Password=\n')
        before = config.read_bytes()
        with self.assertRaises(ValueError):
            self.mod.configure(self.root, self.env)
        self.assertEqual(config.read_bytes(), before)
        self.assertFalse((self.root / '.voltra').exists())
        config.unlink()
        private = self.root / '.voltra/soldat/admin-password'
        private.parent.mkdir(parents=True)
        private.write_bytes(b'')
        with self.assertRaises(ValueError):
            self.mod.configure(self.root, {**self.env, 'ADMIN_PASSWD': ''})
        self.assertFalse(config.exists())
        self.assertEqual(private.read_bytes(), b'')

    def test_installer_preflight_allows_absent_runtime_allocation_without_writes(self):
        env = {key: value for key, value in self.env.items() if key not in ('SERVER_PORT', 'VOLTRA_ALLOCATED_PORTS')}
        self.mod.plan(self.root, env, require_ports=False)
        self.assertEqual(list(self.root.iterdir()), [])

    @unittest.skipUnless(hasattr(__import__('os'), 'geteuid'), 'Linux symlink semantics')
    def test_symlink_or_managed_directory_refused_with_operator_bytes_intact(self):
        external = Path(self.temp.name) / 'outside.ini'
        external.write_bytes(b'operator')
        (self.root / 'soldat.ini').symlink_to(external)
        with self.assertRaises(ValueError):
            self.mod.configure(self.root, self.env)
        self.assertEqual(external.read_bytes(), b'operator')
        (self.root / 'soldat.ini').unlink()
        (self.root / '.voltra').mkdir()
        (self.root / '.voltra/soldat').symlink_to(Path(self.temp.name), target_is_directory=True)
        with self.assertRaises(ValueError):
            self.mod.configure(self.root, self.env)


if __name__ == '__main__':
    unittest.main(verbosity=2)
