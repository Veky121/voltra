"""Offline fixtures only. No publisher payload, network or game lifecycle proof."""
import importlib.util
import json
import io
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, BASE / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
load('steam_template', 'steam-template.py')
load('additional_survival_install', 'additional-survival-install.py')
game = load('fantasy_survival_servers', 'fantasy-survival-servers.py')


class FantasyTests(unittest.TestCase):
    def test_smalland_single_typed_furl_preserves_spaces_and_literal_text_without_inner_quotes(self):
        values = {'SERVERNAME': 'My $() Server', 'WORLDNAME': 'Distinct $() World',
                  'PASSWORD': 'Private $() Phrase', 'PRIVATE': '1', 'SERVER_PORT': '28002'}
        with tempfile.TemporaryDirectory() as d:
            argv = game.command(Path(d), 'smalland', values)
            expected = ('/Game/Maps/WorldGame/WorldGame_Smalland?SERVERNAME=My $() Server'
                        '?WORLDNAME=Distinct $() World?PASSWORD=Private $() Phrase?PRIVATE'
                        '?lengthofdayseconds=1800?lengthofseasonseconds=10800'
                        '?creaturehealthmodifier=100?creaturedamagemodifier=100'
                        '?nourishmentlossmodifier=100?falldamagemodifier=')
            self.assertEqual(argv[2], expected)
            self.assertEqual(argv.count(expected), 1)
            self.assertNotIn('"', argv[2])
            self.assertEqual(argv[-5:], ['-port=28002', '-NOSTEAM', '-log', '-stdout', '-forcelogflush'])
            self.assertEqual(game.command(Path(d), 'smalland', {})[2].split('?')[:3],
                             ['/Game/Maps/WorldGame/WorldGame_Smalland', 'SERVERNAME=My Server', 'WORLDNAME=World'])

    def test_smalland_furl_delimiters_rejected_before_update_or_configuration_writes(self):
        for key in ('SERVERNAME', 'WORLDNAME', 'PASSWORD'):
            for bad in ('bad?option', 'bad"quote', 'bad\nline'):
                with self.subTest(key=key, bad=bad), tempfile.TemporaryDirectory() as d:
                    root = Path(d); sentinel = root / 'operator.cfg'; sentinel.write_bytes(b'preserved')
                    with patch.object(game, 'update') as update, patch.object(game, 'arguments') as arguments, patch.object(game.console, 'run') as run:
                        for operation in (game.command, game.configure, game.install, game.launch):
                            with self.assertRaises(ValueError): operation(root, 'smalland', {key: bad, 'AUTO_UPDATE': '1'})
                        update.assert_not_called(); arguments.assert_not_called(); run.assert_not_called()
                    self.assertEqual([p.name for p in root.iterdir()], ['operator.cfg'])
                    self.assertEqual(sentinel.read_bytes(), b'preserved')

    def test_smalland_live_stdout_flags_and_genuine_panel_map_marker(self):
        marker = 'LogGameMode: Display: Match State Changed from EnteringMap to WaitingToStart'
        profiles = json.loads((BASE.parent / 'overrides.json').read_text())
        egg = profiles['smalland_survive_the_wilds/egg-smalland--survive-the-wilds.json']['egg']
        self.assertEqual(json.loads(egg['config']['startup']), {'done': marker})
        self.assertIn(marker, '[2026.10.24-03.26.15:568][  0]' + marker)
        self.assertNotIn(marker, 'LogNet: IpNetDriver listening on port 28002')
        with tempfile.TemporaryDirectory() as d:
            for other in ('nightingale', 'moria'):
                argv = game.command(Path(d), other, {})
                self.assertNotIn('-stdout', argv); self.assertNotIn('-forcelogflush', argv)

    def test_smalland_eos_original_uppercase_and_identical_dual_have_same_nonempty_argv(self):
        original = {'SMALLAND_EOS_' + k: 'fixture-' + k for k in (
            'DeploymentId', 'DedicatedServerClientId', 'DedicatedServerClientSecret', 'DedicatedServerPrivateKey')}
        uppercase = {k.upper(): v for k, v in original.items()}
        self.assertTrue(set(original).isdisjoint(uppercase))  # Case-sensitive POSIX-shaped mapping, even on Windows.
        with tempfile.TemporaryDirectory() as d:
            expected = game.command(Path(d), 'smalland', original)
            for values in (uppercase, {**original, **uppercase}):
                self.assertEqual(game.command(Path(d), 'smalland', values), expected)
            for k, value in original.items():
                suffix = k[len('SMALLAND_EOS_'):]
                self.assertIn('-ini:Engine:[EpicOnlineServices]:' + suffix + '=' + value, expected)

    def test_smalland_conflicting_eos_aliases_fail_before_update_config_or_process(self):
        for suffix in ('DeploymentId', 'DedicatedServerClientId', 'DedicatedServerClientSecret', 'DedicatedServerPrivateKey'):
            key = 'SMALLAND_EOS_' + suffix
            values = {key: 'one', key.upper(): 'other', 'AUTO_UPDATE': '1'}
            with self.subTest(suffix=suffix), tempfile.TemporaryDirectory() as d:
                root = Path(d); sentinel = root / 'operator.cfg'; sentinel.write_bytes(b'preserved')
                with patch.object(game, 'update') as update, patch.object(game, 'arguments') as arguments, patch.object(game.console, 'run') as run:
                    for operation in (game.command, game.configure, game.install, game.launch):
                        with self.assertRaisesRegex(ValueError, 'Conflicting original and Wings variable'):
                            operation(root, 'smalland', values)
                    update.assert_not_called(); arguments.assert_not_called(); run.assert_not_called()
                self.assertEqual([p.name for p in root.iterdir()], ['operator.cfg'])
                self.assertEqual(sentinel.read_bytes(), b'preserved')

    def test_smalland_uppercase_client_secret_and_private_key_redacted_by_actual_redactor(self):
        values = {'AUTO_UPDATE': '0', 'SMALLAND_EOS_DEDICATEDSERVERCLIENTSECRET': 'fixture-client-secret',
                  'SMALLAND_EOS_DEDICATEDSERVERPRIVATEKEY': 'fixture-private-key'}
        def supervise(root, argv, child, stop, **options):
            self.assertIn('-ini:Engine:[EpicOnlineServices]:DedicatedServerClientSecret=fixture-client-secret', argv)
            self.assertIn('-ini:Engine:[EpicOnlineServices]:DedicatedServerPrivateKey=fixture-private-key', argv)
            redactor = game.console.Redactor(options['credentials'])
            body = b'client fixture-client-secret key fixture-private-key\n'
            actual = redactor.feed(body[:17]) + redactor.feed(body[17:], final=True)
            self.assertNotIn(b'fixture-client-secret', actual); self.assertNotIn(b'fixture-private-key', actual)
            self.assertIn(b'client ', actual); self.assertIn(b' key ', actual)
            return 0
        with tempfile.TemporaryDirectory() as d, patch.object(game.console, 'run', side_effect=supervise):
            self.assertEqual(game.launch(Path(d), 'smalland', values), 0)

    def test_nightingale_uses_actual_example_section_and_preserves_unknown_crlf(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = root / 'NWX/Config/ExampleServerSettings.ini'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'; publisher\r\n[/Script/NWX.NWXServerSettings]\r\nPassword=old\r\nUnknownNative=preserve\r\n')
            game.configure(root, 'nightingale', {'Difficulty': 'hard', 'PASSWORD': 'literal$word', 'ADMIN_PASSWORD': 'admin', 'SERVER_PORT': '28010'})
            body = path.with_name('ServerSettings.ini').read_bytes()
            self.assertIn(b'UnknownNative=preserve\r\n', body)
            self.assertIn(b'Password= literal$word\r\n', body)
            self.assertIn(b'StartingDifficulty = hard\r\n', body)
            path.with_name('ServerSettings.ini').chmod(0o640)
            game.configure(root, 'nightingale', {'SERVER_PORT': '28010'})
            self.assertEqual(path.with_name('ServerSettings.ini').stat().st_mode & 0o777, 0o640)

    def test_nightingale_does_not_invent_a_publisher_template(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError): game.configure(Path(d), 'nightingale', {})

    def test_nightingale_section_is_discovered_not_a_guessed_class_name(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            path = root / 'NWX/Config/ServerSettings.ini'
            path.parent.mkdir(parents=True)
            path.write_text('[Publisher.ActualSettings]\nPassword=old\nOther=retained\n')
            game.configure(root, 'nightingale', {})
            self.assertIn('Publisher.ActualSettings', path.read_text())
            self.assertNotIn('NWXServerSettings', path.read_text())
            path.write_text('[One]\nPassword=old\n[Two]\nAdminPassword=old\n')
            with self.assertRaises(ValueError): game.configure(root, 'nightingale', {})

    def test_nightingale_original_cheats_maxplayers_and_multihome(self):
        with tempfile.TemporaryDirectory() as d:
            args = game.command(Path(d), 'nightingale', {'SERVER_PORT': '28010', 'MAX_PLAYER': '9', 'CHEATS': '1'})
            self.assertIn('-EnableCheats', args)
            self.assertIn('-ini:Game:[/Script/Engine.GameSession]:MaxPlayers=9', args)
            self.assertEqual(args[-2:], ['-port=28010', '-multihome=0.0.0.0'])
            self.assertNotIn('-EnableCheats', game.command(Path(d), 'nightingale', {'CHEATS': '0'}))

    def test_moria_all_original_managed_values_and_operator_controls(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            p = root / 'MoriaServerConfig.ini'
            p.write_bytes(b'; operator\r\n[World]\r\nOptionalWorldFilename=MW_owned.sav\r\n[Performance]\r\nLoadedAreaLimit=16\r\n[World.Create]\r\nDifficulty.Custom.EnemyDamage=1.3\r\n')
            game.configure(root, 'moria', {'WORLD_NAME': 'A $ World', 'SERVER_PASSWORD': 'private', 'DIFFICULTY': 'hard', 'SERVER_PORT': '28012'})
            body = p.read_bytes()
            for value in [b'OptionalWorldFilename=MW_owned.sav', b'LoadedAreaLimit=16', b'Difficulty.Custom.EnemyDamage=1.3', b'Name = "A $ World"', b'Difficulty.Preset = hard', b'Enabled = false', b'ListenPort = 28012', b'OptionalPassword = private']:
                self.assertIn(value, body)
            self.assertIn(b'\r\n', body)
            args = game.command(root, 'moria', {})
            self.assertEqual(args, ['wine', str(root / game.GAMES['moria'][2])])
            self.assertNotIn('private', ' '.join(args))

    def test_smalland_every_furl_control_inverse_deterioration_and_original_flags(self):
        with tempfile.TemporaryDirectory() as d:
            env = {'SERVER_PORT': '28010', 'SERVERNAME': 'My $ Server', 'WORLDNAME': 'World', 'PASSWORD': 'secret', 'FRIENDLYFIRE': '1', 'PEACEFULMODE': '1', 'KEEPINVENTORY': '1', 'DETERIORATION': '0', 'PRIVATE': '1', 'LENGTHOFDAYSECONDS': '1900', 'LENGTHOFSEASONSECONDS': '12000', 'CREATUREHEALTHMODIFIER': '230', 'CREATUREDAMAGEMODIFIER': '180', 'NOURISHMENTLOSSMODIFIER': '40', 'FALLDAMAGEMODIFIER': '75', 'SMALLAND_EOS_DedicatedServerClientSecret': 'publisher-fixture'}
            args = game.command(Path(d), 'smalland', env)
            self.assertEqual(args[1], 'SMALLAND')
            for value in ['SERVERNAME=My $ Server', 'PASSWORD=secret', '?FRIENDLYFIRE', '?PEACEFULMODE', '?KEEPINVENTORY', '?NODETERIORATION', '?PRIVATE', '?lengthofdayseconds=1900', '?lengthofseasonseconds=12000', '?creaturehealthmodifier=230', '?creaturedamagemodifier=180', '?nourishmentlossmodifier=40', '?falldamagemodifier=75']:
                self.assertIn(value, args[2])
            self.assertEqual(args[-5:], ['-port=28010', '-NOSTEAM', '-log', '-stdout', '-forcelogflush'])
            self.assertIn('-ini:Engine:[EpicOnlineServices]:DedicatedServerClientSecret=publisher-fixture', args)
            defaults = game.command(Path(d), 'smalland', {})
            self.assertTrue(defaults[2].endswith('?falldamagemodifier='))
            self.assertNotIn('?NODETERIORATION', defaults[2])

    def test_native_delimiter_and_unallocated_port_injection_reject(self):
        with tempfile.TemporaryDirectory() as d:
            for env in [{'SERVERNAME': 'bad?PRIVATE'}, {'PASSWORD': 'bad"password'}, {'WORLDNAME': 'bad\nworld'}, {'SERVER_PORT': '28010', 'VOLTRA_ALLOCATED_PORTS': '28011'}]:
                with self.assertRaises(ValueError): game.command(Path(d), 'smalland', env)

    def test_private_steam_gates_before_acquisition(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game, 'update') as update:
            for env in [{'STEAM_USER': 'private'}, {'STEAM_PASS': 'private'}, {'STEAM_AUTH': '12345'}, {'SRCDS_BETAPASS': 'private'}, {'INSTALL_FLAGS': '+other_command'}]:
                with self.assertRaises(ValueError): game.install(Path(d), 'smalland', env)
            update.assert_not_called()

    def test_exact_original_app_platform_and_typed_branch(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game, 'update', return_value={'fixture': True}) as update:
            game.install(Path(d), 'moria', {'SRCDS_BETAID': 'public-test'})
            self.assertEqual(update.call_args.args[1], 3349480)
            self.assertEqual(update.call_args.kwargs['platform'], 'windows')
            self.assertEqual(update.call_args.kwargs['required'], ('Moria/Binaries/Win64/MoriaServer-Win64-Shipping.exe',))
            with self.assertRaises(ValueError): game.install(Path(d), 'moria', {'WINDOWS_INSTALL': '0'})
            with self.assertRaises(ValueError): game.install(Path(d), 'smalland', {'SRCDS_APPID': '123'})

    def preservation(self, failure):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            names = ['MoriaServerConfig.ini', 'MoriaServerPermissions.txt', 'MoriaServerRules.txt', 'Moria/Saved/SaveGamesDedicated/MW_fixture.sav', 'Moria/Content/Paks/~mods/operator.pak']
            files = [root / name for name in names]
            for p in files:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b'operator\r\n' + p.name.encode())
                p.chmod(0o640)
                if os.getuid() == 0: os.chown(p, 988, 988)
            before = {p: (p.read_bytes(), p.stat().st_mode & 0o777, p.stat().st_uid, p.stat().st_gid) for p in files}
            def publisher(*_, **__):
                for p in files:
                    p.write_bytes(b'overwritten')
                    p.chmod(0o644)
                if failure: raise RuntimeError('fixture update failure')
                return {'fixture': True}
            with patch.object(game, 'update', side_effect=publisher):
                if failure:
                    with self.assertRaises(RuntimeError): game.install(root, 'moria', {})
                else: game.install(root, 'moria', {})
            for p, expected in before.items():
                self.assertEqual((p.read_bytes(), p.stat().st_mode & 0o777, p.stat().st_uid, p.stat().st_gid), expected)

    def test_reinstall_success_restores_world_config_mod_admin_bytes_and_metadata(self): self.preservation(False)
    def test_reinstall_failure_restores_world_config_mod_admin_bytes_and_metadata(self): self.preservation(True)

    def test_reinstall_symlink_escape_reject_before_acquisition(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as outside, patch.object(game, 'update') as update:
            root = Path(d)
            (root / 'Moria').mkdir()
            (root / 'Moria/Saved').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError): game.install(root, 'moria', {})
            update.assert_not_called()

    def test_launch_uses_shared_console_redaction_and_no_shell(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game.console, 'run', return_value=0) as run:
            self.assertEqual(game.launch(Path(d), 'smalland', {'AUTO_UPDATE': '0', 'PASSWORD': 'fixture-secret', 'SMALLAND_EOS_DedicatedServerClientSecret': 'publisher-fixture', 'STEAM_PASS': 'private'}), 0)
            self.assertIn('fixture-secret', run.call_args.kwargs['credentials'])
            self.assertIn('publisher-fixture', run.call_args.kwargs['credentials'])
            self.assertNotIn('STEAM_PASS', run.call_args.args[2])
            self.assertEqual(run.call_args.kwargs['stop_signal'], game.signal.SIGINT)

    def test_derived_update_flag_overrides_stock_image_disabled_flag(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game, 'install') as install, patch.object(game.console, 'run', return_value=0):
            root = Path(d)
            game.launch(root, 'smalland', {'AUTO_UPDATE': '0', 'VOLTRA_STEAM_AUTO_UPDATE': '1'})
            install.assert_called_once()
            install.reset_mock()
            game.launch(root, 'smalland', {'AUTO_UPDATE': '1', 'VOLTRA_STEAM_AUTO_UPDATE': '0'})
            install.assert_not_called()

    def test_moria_typed_prerequisites_license_and_arbitrary_verb_rejection(self):
        prerequisites = game.load('fixture_fantasy_wine', 'private-wine-prerequisites.py')
        with tempfile.TemporaryDirectory() as d:
            for env in ({}, {'VOLTRA_WINETRICKS_RUN': 'vcrun2022; touch /tmp/unrelated', 'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true'}):
                with self.assertRaises(ValueError): prerequisites.prepare(Path(d), env, 'vcrun2022', {'mono': {'sha256': 'fixture'}, 'wine_runtime': 'fixture'}, ('vcrun2022',))

    def test_moria_log_tail_skips_old_bytes_and_redacts_append_and_rotation(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'Moria.log'
            path.write_bytes(b'old-line-not-forwarded\n')
            output, finished = io.BytesIO(), threading.Event()
            with patch.object(game.sys, 'stdout', SimpleNamespace(buffer=output)):
                worker = threading.Thread(target=game.tail_log, args=(path, finished, ('fixture-secret',)))
                worker.start()
                try:
                    time.sleep(0.15)
                    with path.open('ab') as stream: stream.write(b'new fixture-secret\n')
                    end = time.monotonic() + 2
                    while b'new' not in output.getvalue() and time.monotonic() < end: time.sleep(0.01)
                    path.rename(path.with_suffix('.old'))
                    path.write_bytes(b'rotated fixture-secret\n')
                    end = time.monotonic() + 2
                    while b'rotated' not in output.getvalue() and time.monotonic() < end: time.sleep(0.01)
                finally:
                    finished.set()
                    worker.join(timeout=2)
            self.assertFalse(worker.is_alive())
            result = output.getvalue()
            self.assertIn(b'new', result)
            self.assertIn(b'rotated', result)
            self.assertNotIn(b'fixture-secret', result)
            self.assertNotIn(b'old-line-not-forwarded', result)


if __name__ == '__main__': unittest.main()
