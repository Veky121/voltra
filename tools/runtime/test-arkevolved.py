import importlib.util
from pathlib import Path
import tempfile
import unittest
import os
import sys
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ase', 'internal/panel/game_library/scripts/arkevolved.py')
ase = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ase)


class Tests(unittest.TestCase):
    def test_operator_duplicates_comments_case_and_roundtrip(self):
        original = '; keep\r\n[ServerSettings]\r\nserverpve=True\r\nCustom=one\r\nCustom=two\r\n'
        seeded = ase.seed(original, ase.DEFAULTS['GameUserSettings.ini'])
        self.assertIn('serverpve=True', seeded)
        self.assertEqual(seeded.count('[ServerSettings]'), 1)
        self.assertIn('Custom=one\r\nCustom=two', seeded)
        self.assertEqual(ase.seed(seeded, ase.DEFAULTS['GameUserSettings.ini']), seeded)
        # Shared managed writer must still accept the seeded document next start.
        ase.ark.native.patch_ini(seeded, {'ServerSettings': {'RCONEnabled': 'True'}})

    def test_real_files_backup_and_operator_gameplay_authority(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'ShooterGame/Saved/Config/LinuxServer/Game.ini'
            path.parent.mkdir(parents=True)
            original = b'; operator\r\n[/Script/ShooterGame.ShooterGameMode]\r\nCustom=one\r\nCustom=two\r\n'
            path.write_bytes(original)
            ase.seed_files(root)
            backups = list((root / '.voltra/arkevolved/config-backups').glob('*'))
            self.assertEqual(backups[0].read_bytes(), original)
            path.write_text(path.read_text().replace('bUseSingleplayerSettings=False', 'bUseSingleplayerSettings=True'))
            before = path.read_bytes()
            ase.seed_files(root)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(len(list((root / '.voltra/arkevolved/config-backups').glob('*'))), 1)

    def env(self):
        return dict(ARK_ADMIN_PASSWORD='startup-admin', ARK_PASSWORD='startup-join',
                    SESSION_NAME='Startup name', SERVER_PORT='7777', QUERY_PORT='27015',
                    RCON_PORT='27020', VOLTRA_ALLOCATED_PORTS='7777,7778,27015,27020', AUTO_UPDATE='0')

    def native(self, root, text):
        path = root / ase.CONFIG
        path.parent.mkdir(parents=True)
        path.write_text(text)
        return path

    def test_repro_before_and_actual_shared_configure_after(self):
        content = ('; operator\n[serversettings]\nserveradminpassword=operator-admin\n'
                   'serverpassword=operator-join\nCustom=one\nCustom=two\n'
                   '[sessionsettings]\nsessionname=Operator name\n')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.native(root, content)
            # The old adapter's direct shared call demonstrably uses stale startup values.
            before = ase.ark.configure(root, 'evolved', self.env())
            self.assertEqual(before['password'], 'startup-admin')
            self.assertIn('ServerAdminPassword = startup-admin', path.read_text())
            path.write_text(content)
            for _ in range(2):
                env = ase.effective(root, self.env())
                plan = ase.configure(root, env)  # actual family writer, no mock
                self.assertEqual(plan['password'], 'operator-admin')
                self.assertIn('operator-join', plan['args'][0])
                self.assertIn('Operator name', plan['args'][0])
                self.assertEqual(plan['credentials'][:2], ['operator-admin', 'operator-join'])
                child = ase.ark.environment(root, 'evolved', env)
                self.assertNotIn('ARK_PASSWORD', child)
                self.assertNotIn('ARK_ADMIN_PASSWORD', child)
                self.assertIn('Custom=one\nCustom=two', path.read_text())
                self.assertNotIn('startup-', path.read_text())
                self.assertEqual(plan['ports']['Port'], 7777)
            text = path.read_bytes()
            ase.configure(root, self.env())
            self.assertEqual(path.read_bytes(), text)

    def test_fresh_seed_original_controls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = ase.configure(root, self.env())
            self.assertEqual(plan['password'], 'startup-admin')
            self.assertIn('Startup name', (root / ase.CONFIG).read_text())

    def test_ambiguity_fails_before_writes_or_acquisition(self):
        cases = [
            '[ServerSettings]\nServerPassword=a\nserverpassword=b\n',
            '[ServerSettings]\nRCONPort=27020\nrconport=27020\n',
            '[SessionSettings]\nSessionName=a\n[sessionSettings]\nOther=b\n',
            '[ServerSettings]\nServerPVE=True\nserverpve=False\n',
        ]
        for content in cases:
            for operation in ('install', 'run'):
                with self.subTest(content=content, operation=operation), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    self.native(root, content)
                    snapshot = {p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                    with patch.object(ase.Path, 'cwd', return_value=root), patch.dict(os.environ, self.env(), clear=True), patch.object(sys, 'argv', ['ase', operation]), patch.object(ase.ark, 'install') as install, patch.object(ase.ark, 'configure') as configure:
                        with self.assertRaises(ValueError):
                            ase.main()
                        install.assert_not_called()
                        configure.assert_not_called()
                    self.assertEqual(snapshot, {p.relative_to(root): p.read_bytes() for p in root.rglob('*') if p.is_file()})
                    self.assertFalse((root / '.voltra').exists())

    def test_main_routes_effective_values_to_install_and_run(self):
        for operation in ('install', 'run'):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.native(root, '[ServerSettings]\nServerAdminPassword=operator-admin\nServerPassword=operator-join\n[SessionSettings]\nSessionName=Operator name\n')
                env = self.env()
                env['AUTO_UPDATE'] = '1'
                with patch.object(ase.Path, 'cwd', return_value=root), patch.dict(os.environ, env, clear=True), patch.object(sys, 'argv', ['ase', operation]), patch.object(ase.ark, 'install') as install, patch.object(ase.ark, 'run', return_value=0) as run:
                    self.assertEqual(ase.main(), 0)
                    self.assertEqual(install.call_args.args[2]['ARK_ADMIN_PASSWORD'], 'operator-admin')
                    self.assertEqual(install.call_args.args[2]['ARK_PASSWORD'], 'operator-join')
                    if operation == 'run':
                        plan, child = run.call_args.args[2:]
                        self.assertEqual(plan['password'], 'operator-admin')
                        self.assertNotIn('ARK_ADMIN_PASSWORD', child)
                        self.assertNotIn('ARK_PASSWORD', child)
                    else:
                        run.assert_not_called()


    def test_boot_retains_bom_crlf_unknown_rows_and_exact_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.native(root, '')
            original = b'\xef\xbb\xbf; operator\r\n[ServerSettings]\r\nServerAdminPassword=operator-admin\r\nCustom=one\r\nCustom=two\r\n[SessionSettings]\r\nSessionName=Operator name\r\n'
            path.write_bytes(original)
            ase.configure(root, self.env())
            self.assertTrue(path.read_bytes().startswith(b'\xef\xbb\xbf'))
            self.assertIn(b'Custom=one\r\nCustom=two\r\n', path.read_bytes())
            backups = list((root / '.voltra/arkevolved/config-backups').glob('*'))
            self.assertEqual(backups[0].read_bytes(), original)
            ase.seed_files(root)
            self.assertTrue(path.read_bytes().startswith(b'\xef\xbb\xbf'))
            self.assertIn(b'Custom=one\r\nCustom=two\r\n', path.read_bytes())
            before = path.read_bytes()
            ase.configure(root, self.env())
            self.assertEqual(path.read_bytes(), before)

    def test_actual_update_restoration_success_and_failure(self):
        for fails in (False, True):
            with self.subTest(fails=fails), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = self.native(root, '')
                original = b'; keep\r\n[serversettings]\r\nserveradminpassword=operator-admin\r\nserverpassword=operator-join\r\n[sessionsettings]\r\nsessionname=Operator name\r\n'
                path.write_bytes(original)
                world = root / 'ShooterGame/Saved/world.ark'
                world.write_bytes(b'operator-world')
                mod = root / 'ShooterGame/Content/Mods/fixture.bin'
                mod.parent.mkdir(parents=True)
                mod.write_bytes(b'operator-mod')
                def update(*args, **kwargs):
                    path.write_bytes(b'updater replacement')
                    if fails:
                        raise RuntimeError('bounded simulated acquisition failure')
                with patch.object(ase.ark.steam, 'update', side_effect=update), patch.object(ase.ark, 'engine_steam'):
                    if fails:
                        with self.assertRaises(RuntimeError):
                            ase.ark.install(root, 'evolved', ase.effective(root, self.env()))
                    else:
                        ase.ark.install(root, 'evolved', ase.effective(root, self.env()))
                self.assertEqual(path.read_bytes(), original)
                plan = ase.configure(root, self.env())
                self.assertEqual(plan['password'], 'operator-admin')
                self.assertIn('Operator name', plan['args'][0])
                self.assertEqual(world.read_bytes(), b'operator-world')
                self.assertEqual(mod.read_bytes(), b'operator-mod')


unittest.main()

