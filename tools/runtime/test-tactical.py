import os
import io
import sys
import types
import tempfile
from pathlib import Path
import unittest
from unittest import mock
for name, source in SOURCES:
    module = types.ModuleType(name); exec(source, module.__dict__); sys.modules[name] = module
runtime = sys.modules['tactical_runtime']; installer = sys.modules['tactical_install']


class TacticalTests(unittest.TestCase):
    def fixture(self, root, kind, **extra):
        app, game, executable = installer.GAMES[kind]; binary = root / executable
        binary.parent.mkdir(parents=True, exist_ok=True); binary.write_bytes(b'publisher native fixture')
        return {'VOLTRA_TACTICAL':kind, 'SRCDS_APPID':str(app), 'SERVER_PORT':'28010', 'VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013,28014,28015', **extra}

    def test_sandstorm_all_original_flags_literal_and_redacted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root, 'sandstorm', HOSTNAME="Literal $value 'name'", MAP_NAME='Canyon', SCENARIO='Scenario_Crossing_Checkpoint_Insurgents', MAX_PLAYERS='28', QUERY_PORT='28011', GSLTT='a'*32, GST='statstoken', ADDSWITCHES='-Mods -ModList=Mods -Mutators=ISMC -Rcon -RconListenPort=28015 -RconPassword=private123')
            argv, child, secrets, ready = runtime.configure(root, env)
            self.assertIn('-hostname=Literal $value \'name\'', argv); self.assertIn('-Mods', argv); self.assertIn('-ModList=Mods', argv); self.assertIn('-Mutators=ISMC', argv)
            self.assertIn('Canyon?Scenario=Scenario_Crossing_Checkpoint_Insurgents?MaxPlayers=28', argv)
            self.assertIn('statstoken', secrets); self.assertIn('private123', secrets); self.assertIn('a'*32, secrets)
            self.assertIn(b'LoadingAssets to WaitingToStart', ready)

    def test_squad_all_original_aliases_unknown_cfg_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root, 'squad', servername="Literal $name 'squad'", maxplayers='80', reservedslots='4', allowteamchange='false', advertise='false', ptciu='true', teambal='false', recorddemos='false', QUERY_PORT='28012', BEACON_PORT='28014', RCON_PORT='28015')
            cfg = root / 'SquadGame/ServerConfig/Server.cfg'; cfg.parent.mkdir(); cfg.write_bytes(b'// keep operator\r\nCustomNative=73\r\nServerName="Old"\r\n'); cfg.chmod(0o640)
            argv, _, _, _ = runtime.configure(root, env); content = cfg.read_bytes()
            self.assertIn(b'// keep operator\r\nCustomNative=73\r\n', content); self.assertIn(b'AllowTeamChanges=false\r\n', content); self.assertIn(b'RecordDemos=false\r\n', content)
            self.assertEqual(cfg.stat().st_mode & 0o777, 0o640); self.assertIn('-beaconport=28014', argv); self.assertIn('RCONPORT=28015', argv)
            self.assertEqual(len(list((root / '.voltra/tactical/config-backups').iterdir())), 1)
            runtime.configure(root, env); self.assertEqual(cfg.read_bytes(), content); self.assertEqual(len(list((root / '.voltra/tactical/config-backups').iterdir())), 1)

    def test_postscriptum_original_cfg_rcon_and_interrupt_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root, 'postscriptum', hostname='PS literal', maxplayers='80', reservedslots='2', allowteamchange='false', advertise='true', team_change='false', teambalance='true', demo_recording='false', RCON_PASSWORD='private123', RCON_PORT='28012', QUERY_PORT='28011', AUTO_UPDATE='0', LD_LIBRARY_PATH='.')
            argv, child, secrets, _ = runtime.configure(root, env); self.assertIn('-RCONPASSWORD=private123', argv); self.assertIn('private123', secrets); self.assertIn('-fullcrashdump', argv)
            content = (root / 'PostScriptum/ServerConfig/Server.cfg').read_text(); self.assertIn('PreventTeamChangeIfUnbalanced=false', content); self.assertIn('RecordDemos=false', content)
            with mock.patch.object(runtime, 'run', return_value=250) as native: self.assertEqual(runtime.main(root, env), 250)
            self.assertEqual(native.call_args.args[3], '\x03'); self.assertTrue(native.call_args.kwargs['terminal_input'])

    def test_native_role_collisions_missing_pairs_and_bad_settings_refused(self):
        cases = [('squad', {'VOLTRA_ALLOCATED_PORTS':'28010,28012,28013,28014,28015,28016'}), ('squad', {'QUERY_PORT':'28015'}), ('squad', {'reservedslots':'81'}), ('squad', {'allowteamchange':'yes'}), ('sandstorm', {'ADDSWITCHES':'-Port=29000'}), ('sandstorm', {'ADDSWITCHES':'-Rcon'}), ('sandstorm', {'ADDSWITCHES':'-Rcon -RconListenPort=29000'}), ('sandstorm', {'MAP_NAME':'../escape'}), ('sandstorm', {'ADDSWITCHES':'-Mods; shutdown'}), ('postscriptum', {'QUERY_PORT':'28010'})]
        for kind, extra in cases:
            with self.subTest(kind=kind, extra=extra), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); env = self.fixture(root, kind, **extra)
                with self.assertRaises(ValueError): runtime.configure(root, env)

    def test_native_install_restores_admin_license_saved_and_mod_cfg_on_failure(self):
        for kind in installer.GAMES:
            for failure in (False, True):
                with self.subTest(kind=kind, failure=failure), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory); env = self.fixture(root, kind); game = installer.GAMES[kind][1]
                    names = [game+'/ServerConfig/Admins.cfg',game+'/ServerConfig/License.cfg',game+'/Saved/Config/LinuxServer/GameUserSettings.ini',game+'/Saved/SaveGames/operator.sav',game+'/Plugins/Mods/custom/Config/user.ini']; paths=[]
                    for name in names:
                        path=root/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(b'private operator\r\n'); path.chmod(0o640); paths.append(path)
                    def publisher(*args, **kwargs):
                        for path in paths: path.write_bytes(b'publisher overwrite')
                        if failure: raise RuntimeError('publisher failure')
                        return {'buildid':'123'}
                    with mock.patch.object(installer, 'update', side_effect=publisher):
                        if failure:
                            with self.assertRaises(RuntimeError): installer.install(root, env)
                        else: self.assertEqual(installer.install(root, env)['buildid'], '123')
                    for path in paths: self.assertEqual(path.read_bytes(), b'private operator\r\n'); self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_private_steam_and_workshop_injection_refused_before_publisher(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); env = self.fixture(root, 'squad', STEAM_USER='privateaccount', STEAM_PASS='privatepassword', WORKSHOP_ITEMS='123')
            with mock.patch.object(installer, 'update') as publisher, self.assertRaises(ValueError) as error: installer.install(root, env)
            publisher.assert_not_called(); self.assertNotIn('privatepassword', str(error.exception))
        for value in ('1,+quit', '1;quit', '../123', '1,1', '1, 2'):
            with self.subTest(value=value), self.assertRaises(ValueError): installer.workshop_ids(value)

    def test_duplicate_managed_cfg_and_external_symlinks_refused(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory); env = self.fixture(root, 'squad'); cfg=root/'SquadGame/ServerConfig/Server.cfg'; cfg.parent.mkdir(); cfg.write_text('MaxPlayers=80\nMaxPlayers=90\n')
            with self.assertRaises(ValueError): runtime.configure(root, env)
            cfg.unlink(); cfg.parent.rmdir(); cfg.parent.symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError): runtime.configure(root, env)

    def test_sandstorm_empty_app_disables_auto_update_without_changing_install_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); env=self.fixture(root,'sandstorm',SRCDS_APPID='',AUTO_UPDATE='1')
            with mock.patch.object(runtime,'install') as publisher, mock.patch.object(runtime,'run',return_value=0): self.assertEqual(runtime.main(root,env),0)
            publisher.assert_not_called()

    def test_squad_workshop_structured_commands_and_operator_mod_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); env=self.fixture(root,'squad'); source=root/'steamapps/workshop/content/393380/123'
            class Capture:
                buffer=io.BytesIO()
            commands=[]
            def publisher(argv, **kwargs):
                commands.append(argv); process=mock.Mock(stdout=io.BytesIO(b'Success. Downloaded item 123\n')); process.wait.return_value=0; process.poll.return_value=0; return process
            for version in (b'publisher1',b'publisher2'):
                source.mkdir(parents=True,exist_ok=True); (source/'mod.pak').write_bytes(version); (source/'user.ini').write_bytes(b'publisher defaults')
                with mock.patch.object(installer.subprocess,'Popen',side_effect=publisher),mock.patch.object(installer.sys,'stdout',Capture()): installer.workshops(root,env,['123'])
                target=root/'SquadGame/Plugins/Mods/123'; self.assertEqual((target/'mod.pak').read_bytes(),version)
                if version==b'publisher1': (target/'user.ini').write_bytes(b'operator custom'); (target/'custom.map').write_bytes(b'operator content')
            self.assertEqual((target/'user.ini').read_bytes(),b'operator custom'); self.assertEqual((target/'custom.map').read_bytes(),b'operator content')
            self.assertNotIn('+app_update',commands[0]); self.assertIn('+workshop_download_item',commands[0]); self.assertEqual(commands[0][-5:],['+workshop_download_item','393380','123','validate','+quit'])

    def test_workshop_no_current_success_cannot_reuse_stale_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); env=self.fixture(root,'squad'); source=root/'steamapps/workshop/content/393380/123'; source.mkdir(parents=True); (source/'stale.pak').write_bytes(b'stale')
            process=mock.Mock(stdout=io.BytesIO(b'Access Denied\n')); process.wait.return_value=0; process.poll.return_value=0
            class Capture:
                buffer=io.BytesIO()
            with mock.patch.object(installer.subprocess,'Popen',return_value=process),mock.patch.object(installer.sys,'stdout',Capture()),self.assertRaises(RuntimeError): installer.workshops(root,env,['123'])
            self.assertFalse((root/'SquadGame/Plugins/Mods/123').exists())

    def test_sparse_blank_service_groups_choose_complete_pairs(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); env=self.fixture(root,'squad',VOLTRA_ALLOCATED_PORTS='28010,28011,28020,28021,28030,28031',QUERY_PORT='',BEACON_PORT='',RCON_PORT='')
            main,services,roles,_=runtime.service_ports(env,'squad')
            self.assertEqual(services,{'QUERY_PORT':28020,'BEACON_PORT':28030,'RCON_PORT':28031})
            self.assertEqual(roles,{28010,28011,28020,28021,28030,28031})
            argv,_,_,_=runtime.configure(root,env);self.assertIn('QueryPort=28020',argv);self.assertIn('-beaconport=28030',argv);self.assertIn('RCONPORT=28031',argv)

    def test_explicit_later_roles_reserve_before_automatic_query(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); env=self.fixture(root,'squad',VOLTRA_ALLOCATED_PORTS='28010,28011,28020,28021,28030,28031',QUERY_PORT='',BEACON_PORT='28020',RCON_PORT='')
            _,services,_,_=runtime.service_ports(env,'squad')
            self.assertEqual(services,{'BEACON_PORT':28020,'QUERY_PORT':28030,'RCON_PORT':28021})
            env.update(QUERY_PORT='28030',BEACON_PORT='',RCON_PORT='28020')
            _,services,_,_=runtime.service_ports(env,'squad')
            self.assertEqual(services,{'QUERY_PORT':28030,'RCON_PORT':28020,'BEACON_PORT':28021})
            self.assertEqual(env['RCON_PORT'],'28020')

    def test_mandatory_zero_ports_missing_companions_and_collisions_reject(self):
        cases=[{'QUERY_PORT':'0'},{'BEACON_PORT':'0'},{'RCON_PORT':'0'},{'QUERY_PORT':'028020'},{'QUERY_PORT':'28020','RCON_PORT':'28021'},{'QUERY_PORT':'28011'},{'QUERY_PORT':'65535','VOLTRA_ALLOCATED_PORTS':'28010,28011,28020,28021,28030,65535'},{'VOLTRA_ALLOCATED_PORTS':'28010,28011,28020,28022,28024,28026'}]
        for extra in cases:
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=self.fixture(root,'squad',**extra)
                with self.assertRaises(ValueError):runtime.configure(root,env)
                self.assertFalse((root/'SquadGame/ServerConfig/Server.cfg').exists())

    def test_other_tactical_blank_roles_auto_but_zero_does_not_mean_auto(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for kind in ('sandstorm','postscriptum'):
                env=self.fixture(root,kind,QUERY_PORT='',RCON_PORT='')
                _,services,_,_=runtime.service_ports(env,kind);self.assertEqual(services['QUERY_PORT'],28011)
                if kind=='postscriptum':self.assertEqual(services['RCON_PORT'],28012)
                env['QUERY_PORT']='0'
                with self.assertRaises(ValueError):runtime.configure(root,env)


unittest.main()
