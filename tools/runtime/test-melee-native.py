import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('melee',Path('internal/panel/game_library/scripts/melee-native.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Melee(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','SERVER_NAME':'Name $ + & literal','ADMIN_PASSWORD':'admin-private','GAME_PASSWORD':'join-private'}
    def tearDown(self):self.tmp.cleanup()
    def native(self,game):
        p=self.root/m.GAMES[game][2];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'fixture native placeholder, never executed');return p
    def config(self,platform='LinuxServer'):
        p=self.root/'Mordhau/Saved/Config'/platform/'Game.ini';p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(';keep comment\n[/Script/Mordhau.MordhauGameSession]\nServerName=before\nMods=111\nMods=222\nAdmins=operator\nBannedPlayers=()\nServerModAuthToken=private-modio\n[/Script/Mordhau.MordhauGameMode]\nMapRotation=FFA_a\nMapRotation=TDM_b\nSpawnServerActorsOnMapLoad=/Game/Actor\n');p.chmod(0o640);return p
    def test_linux_typed_config_preserves_mods_admin_and_rotation(self):
        self.native('mordhau');p=self.config();cwd,argv,secrets=m.configure(self.root,'mordhau',self.env);content=p.read_text()
        for token in [';keep comment','Mods=111\nMods=222','Admins=operator','BannedPlayers=()','ServerModAuthToken=private-modio','MapRotation=FFA_a\nMapRotation=TDM_b','SpawnServerActorsOnMapLoad=/Game/Actor','ServerName= Name $ + & literal']:self.assertIn(token,content)
        self.assertEqual(p.stat().st_mode&0o777,0o640);self.assertEqual(argv[1],'/Game/Mordhau/Maps/Grad/FL_Grad');self.assertIn('-MaxSlots=48',argv);self.assertIn('-QueryPort=28001',argv);self.assertIn('-Beaconport=28002',argv);self.assertNotIn('admin-private',str(argv));self.assertEqual(secrets,('join-private','admin-private','private-modio'))
        before=p.read_bytes();m.configure(self.root,'mordhau',self.env);self.assertEqual(before,p.read_bytes())
    def test_windows_original_literal_invocation(self):
        self.native('mordhau-wine');self.config('WindowsServer');env={**self.env,'WINDOWS_INSTALL':'1','WINETRICKS_RUN':'vcrun2022','MAX_PLAYERS':'24','DEFAULT_MAP':'/Game/Mordhau/Maps/Contraband/FFA_Contraband'}
        _,argv,_=m.configure(self.root,'mordhau-wine',env);self.assertEqual(argv[0],'wine');self.assertIn('MaxSlots=24',argv);self.assertIn('-log',argv);self.assertEqual(argv[2],env['DEFAULT_MAP'])
    def test_service_explicit_reservation_before_auto(self):
        ports=m.service_ports({**self.env,'BEACON_PORT':'28001'});self.assertEqual(ports['QUERY_PORT'],28002)
        for patch in [{'QUERY_PORT':'0'},{'QUERY_PORT':'28001','BEACON_PORT':'28001'},{'QUERY_PORT':'29000'},{'VOLTRA_ALLOCATED_PORTS':'28000,28001'}]:
            with self.assertRaises(ValueError):m.service_ports({**self.env,**patch})
    def test_invalid_map_or_config_injection_no_mutation(self):
        p=self.config();before=p.read_bytes()
        for patch in [{'DEFAULT_MAP':'Grad/FL;touch /tmp/no'},{'DEFAULT_MAP':'../escape'},{'SERVER_NAME':'safe\nAdmins=evil'},{'MAX_PLAYERS':'61'}]:
            with self.assertRaises(ValueError):m.configure(self.root,'mordhau',{**self.env,**patch})
            self.assertEqual(before,p.read_bytes())
    def test_bannerlord_real_token_and_config_gate(self):
        self.native('bannerlord');env={**self.env,'WINDOWS_INSTALL':'1','WINETRICKS_RUN':'vcrun2019 dotnet472'}
        with self.assertRaisesRegex(ValueError,'real in-game'):m.configure(self.root,'bannerlord',env)
        env['AUTH_TOKEN']='synthetic-unit-token'
        with self.assertRaisesRegex(ValueError,'old upstream paste'):m.configure(self.root,'bannerlord',env)
        p=self.root/'Modules/Native/tdm_config.txt';p.parent.mkdir(parents=True);p.write_text('ServerName Operator\nGameType TeamDeathmatch\nstart_game_and_mission\n');before=p.read_bytes()
        cwd,argv,secrets=m.configure(self.root,'bannerlord',env);self.assertEqual(cwd,self.root/'bin/Win64_Shipping_Server');self.assertIn('_MODULES_*Native*Multiplayer*_MODULES_',argv);self.assertIn('tdm_config.txt',argv);self.assertEqual(secrets,('synthetic-unit-token',));self.assertEqual(before,p.read_bytes())
        _,legacy,_=m.configure(self.root,'bannerlord',{**env,'SERVER_MODULES':'Native,Multiplayer,DedicatedCustomServerHelper'});self.assertIn('_MODULES_*Native*Multiplayer*DedicatedCustomServerHelper*_MODULES_',legacy)
        for patch in [{'SERVER_CONFIG':'../escape.txt'},{'SERVER_MODULES':'Native,../evil'},{'SERVER_MODULES':'Native,Native'}]:
            with self.assertRaises(ValueError):m.configure(self.root,'bannerlord',{**env,**patch})
    def test_private_steam_invalid_platform_and_runtime_gates_before_acquisition(self):
        for patch in [{'STEAM_USER':'real-user','STEAM_PASS':'private'},{'SRCDS_BETAPASS':'private'},{'INSTALL_FLAGS':'+quit'},{'WINDOWS_INSTALL':'1'},{'SRCDS_APPID':'629760'}]:
            with mock.patch.object(m.steam,'update') as update:
                with self.assertRaises(ValueError):m.install(self.root,'mordhau',{**self.env,**patch})
                update.assert_not_called();self.assertFalse((self.root/'.voltra').exists())
        for patch in [{'WINETRICKS_RUN':'arbitrary'},{'WINEARCH':'win32'}]:
            with self.assertRaises(ValueError):m.selection('mordhau-wine',{**self.env,'WINDOWS_INSTALL':'1',**patch})
    def test_reinstall_success_and_failure_retains_operator_files_metadata(self):
        for failure in (False,True):
            with self.subTest(failure=failure):
                self.native('mordhau');p=self.config();custom=self.root/'Modules/Custom/modified.bin';custom.parent.mkdir(parents=True,exist_ok=True);custom.write_bytes(b'operator module');custom.chmod(0o604)
                before={path:(path.read_bytes(),path.stat().st_mode&0o777,path.stat().st_uid,path.stat().st_gid) for path in (p,custom)}
                def update(root,app,env,**kwargs):
                    self.assertEqual(app,629800);self.assertEqual(kwargs['platform'],'linux');self.assertTrue(kwargs['force_platform']);p.write_bytes(b'publisher overwrite');custom.write_bytes(b'publisher overwrite')
                    if failure:raise RuntimeError('synthetic Steam failure')
                    return {'buildid':'synthetic'}
                with mock.patch.object(m.steam,'update',side_effect=update):
                    if failure:
                        with self.assertRaises(RuntimeError):m.install(self.root,'mordhau',self.env)
                    else:m.install(self.root,'mordhau',self.env)
                for path,expected in before.items():self.assertEqual((path.read_bytes(),path.stat().st_mode&0o777,path.stat().st_uid,path.stat().st_gid),expected)
    def test_symlink_configuration_and_preservation_rejected(self):
        outside=self.root/'outside';outside.mkdir();(self.root/'Mordhau').symlink_to(outside,target_is_directory=True)
        with self.assertRaises(ValueError):m.configure(self.root,'mordhau',self.env)
        with mock.patch.object(m.steam,'update') as update:
            (outside/'operator.txt').write_text('private')
            # Direct config confinement is authoritative even if pathlib rglob
            # skips symlinked directory content on this Python version.
            with self.assertRaises(ValueError):m.confined(self.root,self.root/'Mordhau/Saved/Config')
            update.assert_not_called()
    def test_native_child_env_redaction_and_stop_contract(self):
        self.native('mordhau');fake=type('Console',(),{})();fake.run=mock.Mock(return_value=19);original=m.helper
        with mock.patch.object(m,'helper',side_effect=lambda name:fake if name=='native-console' else original(name)):
            self.assertEqual(m.run(self.root,'mordhau',self.env),19)
        args,kwargs=fake.run.call_args;self.assertNotIn('ADMIN_PASSWORD',args[2]);self.assertNotIn('GAME_PASSWORD',args[2]);self.assertEqual(args[3],'\x03');self.assertTrue(kwargs['terminal_input']);self.assertEqual(args[4],('join-private','admin-private'))
    def test_configured_rcon_and_modio_tokens_enter_output_redaction(self):
        self.native('mordhau');p=self.config();p.write_text(p.read_text().replace('Admins=operator','Admins=operator\nRconPassword=private-rcon'))
        _,_,secrets=m.configure(self.root,'mordhau',self.env);self.assertIn('private-rcon',secrets);self.assertIn('private-modio',secrets)
    def test_preserve_unknown_module_and_native_binary_update_baseline(self):
        binary=self.native('mordhau');operator=self.root/'Modules/custom.bin';operator.parent.mkdir();operator.write_bytes(b'owned')
        with m.preserve(self.root):binary.write_bytes(b'publisher-v1')
        # First unknown files are retained; establish a normal clean publisher
        # baseline for the next fixture without pretending it is a real build.
        baseline=self.root/'.voltra/melee-preserve/publisher.json'
        values=__import__('json').loads(baseline.read_text());values[binary.relative_to(self.root).as_posix()]=m.digest(binary);baseline.write_text(__import__('json').dumps(values))
        operator.write_bytes(b'operator-edited')
        with m.preserve(self.root):binary.write_bytes(b'publisher-v2');operator.write_bytes(b'publisher-overwrite')
        self.assertEqual(binary.read_bytes(),b'publisher-v2');self.assertEqual(operator.read_bytes(),b'operator-edited')

unittest.main()
