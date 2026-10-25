"""Offline typed adapter fixtures; these do not establish native game compatibility."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

source = Path('internal/panel/game_library/scripts/vr-tower-ohd.py').resolve()
spec = importlib.util.spec_from_file_location('vr_games', source)
games = importlib.util.module_from_spec(spec);spec.loader.exec_module(games)


def env(game, **values):
    base = {'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28400,27015,27005,7779,8188',
            'STEAM_LOGIN_TOKEN':'operator-token-fixture','STEAM_ADMIN_ID':'76561198000000001',
            'API_KEY':'operator-api-fixture','RCON_PASSWORD':'operator-password'}
    return {**base, **values}


class NativeAdapterTests(unittest.TestCase):
    def test_ohd_panel_readiness_matches_native_map_initialization(self):
        marker = 'LogGameMode: Display: Match State Changed from EnteringMap to WaitingToStart'
        profiles = json.loads(Path('internal/panel/game_library/overrides.json').read_text())
        egg = profiles['operation_harsh_doorstop/egg-operation-harsh-doorstop.json']['egg']
        self.assertEqual(json.loads(egg['config']['startup']), {'done': marker})
        native_line = '[2026.10.24-02.48.37:242][  0]' + marker
        self.assertIn(marker, native_line)
        self.assertNotIn(marker, 'LogNet: IpNetDriver listening on port 28000')
        with tempfile.TemporaryDirectory() as directory:
            selected = games.plan(Path(directory), 'ohd', env('ohd'))
            self.assertEqual(selected['ready'], b'LogRCON: RCON server listening on')

    def test_ohd_live_log_flags_preserve_original_arguments_and_controls(self):
        with tempfile.TemporaryDirectory() as directory:
            values = env('ohd', MAX_PLAYERS='32', SERVER_NAME='literal $() title',
                         RCON_MAX_AUTH_ATTEMPTS='7', RCON_MAX_CONNECTIONS='9')
            selected = games.plan(Path(directory), 'ohd', values)
            self.assertEqual(selected['args'], [
                'HarshDoorstop', 'AAS-TestMap?MaxPlayers=32',
                '-SteamServerName="literal $() title"', '-Port=28000', '-MULTIHOME=0.0.0.0',
                '-QueryPort=27005', '-RCONPort=7779', '-EnableRCON', '-RCONMaxAuthAttempts=7',
                '-RCONPassword="operator-password"', '-RCONMaxActiveConnections=9',
                '-stdout', '-forcelogflush'])
            sections = selected['configs']['HarshDoorstop/Saved/Config/LinuxServer/Game.ini']
            self.assertEqual(sections['/Script/RCON.RCONServerSystem'], {
                'bEnabled': 'True', 'ListenPort': '7779', 'Password': '"operator-password"',
                'MaxActiveConnections': '9', 'MaxAuthAttempts': '7'})
            self.assertEqual(selected['ready'], b'LogRCON: RCON server listening on')
            for game in ('tower', 'pavlov'):
                args = games.plan(Path(directory), game, env(game))['args']
                self.assertNotIn('-stdout', args)
                self.assertNotIn('-forcelogflush', args)

    def test_tower_original_hidden_defaults_literal_title_and_custom_path(self):
        with tempfile.TemporaryDirectory() as directory:
            selected = games.plan(Path(directory),'tower',env('tower',SERVER_TITLE='literal $() + title'))
            self.assertIn('-TowerServerINI=../../Saved/Config/TowerServer.ini',selected['args'])
            options=selected['configs']['Tower/Saved/Config/TowerServer.ini'][games.TOWER_SECTION]
            self.assertEqual(options['MaxPlayers'],'40')
            self.assertEqual(options['ServerTitle'],'literal $() + title')
            self.assertNotIn('-nosteamclient',selected['args'])

    def test_real_inputs_and_original_placeholder_fail_before_update(self):
        with tempfile.TemporaryDirectory() as directory:
            for game,key,value in [('tower','STEAM_LOGIN_TOKEN',''),('tower','STEAM_ADMIN_ID','1'),
                                   ('pavlov','API_KEY',''),('pavlov','RCON_PASSWORD','CHANGE_ME'),('ohd','RCON_PASSWORD','')]:
                with self.subTest(game=game,key=key),self.assertRaises(ValueError):
                    games.plan(Path(directory),game,env(game,**{key:value}))

    def test_ports_offset_roles_and_overflow(self):
        for game,values in [('pavlov',{'VOLTRA_ALLOCATED_PORTS':'28000,28001,8188'}),
                            ('tower',{'QUERY_PORT':'28001'}),('ohd',{'RCON_PORT':'27005'}),
                            ('pavlov',{'SERVER_PORT':'65500','VOLTRA_ALLOCATED_PORTS':'65500,8188'})]:
            with self.subTest(game=game,values=values),self.assertRaises(ValueError):games.ports(env(game,**values),game)
        self.assertEqual(games.ports(env('pavlov'),'pavlov')['RCON_PORT'],8188)

    def test_condo_needs_own_map_and_both_tokens_retains_native_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);values=env('tower',TOWER_MODE='condo',TOWER_LOGIN_TOKEN='tower-fixture-token')
            with self.assertRaises(ValueError):games.plan(root,'tower',values)
            target=root/'Tower/Condos/C_Condo/Operator.map';target.parent.mkdir(parents=True);target.write_bytes(b'operator-world')
            ini=root/'Tower/Saved/Config/TowerServer.ini';ini.parent.mkdir(parents=True)
            ini.write_text('[DedicatedCondoOptions]\nCondoFile=Operator\n')
            selected=games.configure(root,'tower',values)
            self.assertEqual(selected['args'][0],'/Game/Maps/C_Condo');self.assertIn('-nosteamclient',selected['args'])
            self.assertRegex(ini.read_text(),r'CondoFile\s*=\s*Operator');self.assertEqual(target.read_bytes(),b'operator-world')
            with self.assertRaises(ValueError):games.plan(root,'tower',{**values,'TOWER_LOGIN_TOKEN':''})

    def test_repeated_tower_admins_and_unterminated_comment_retained(self):
        before='[Administration]\nAdminSteamID=first\nAdminSteamID=second\n; operator comment'
        after=games.tower_admin(before,'new')
        self.assertIn('AdminSteamID=new\nAdminSteamID=second',after)
        self.assertIn('; operator comment',after)
        self.assertEqual(games.tower_admin('[Administration]\n; comment','new'),'[Administration]\n; comment\nAdminSteamID=new\n')

    def test_pavlov_repeated_rotations_mods_visibility_and_private_rcon(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'Pavlov/Saved/Config/LinuxServer/Game.ini';path.parent.mkdir(parents=True)
            path.write_text('[/script/pavlov.dedicatedserver]\nMapRotation=one\nMapRotation=two\nAdditionalMods=operator\nbWhitelist=true\nApiKey="old-key"\n')
            selected=games.configure(root,'pavlov',env('pavlov'))
            self.assertIn('old-key',selected['credentials'])
            for value in ['MapRotation=one','MapRotation=two','AdditionalMods=operator','bWhitelist=true']:self.assertIn(value,path.read_text())
            rcon=root/'Pavlov/Saved/Config/RconSettings.txt'
            self.assertEqual(rcon.read_text(),'Password=operator-password\nPort=8188\n')
            self.assertEqual(rcon.stat().st_mode & 0o777,0o600)

    def test_ohd_every_original_control_and_operator_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'HarshDoorstop/Saved/Config/LinuxServer/Game.ini';path.parent.mkdir(parents=True)
            path.write_text('[/Script/Engine.GameSession]\nPassword=operator-join\n[Custom]\nMod=keep\n')
            result=games.configure(root,'ohd',env('ohd',MAX_PLAYERS='48',SERVER_NAME='literal $ +',RCON_MAX_AUTH_ATTEMPTS='9',RCON_MAX_CONNECTIONS='12'))
            for arg in ['HarshDoorstop','AAS-TestMap?MaxPlayers=48','-SteamServerName="literal $ +"','-EnableRCON','-RCONMaxAuthAttempts=9','-RCONMaxActiveConnections=12','-RCONPort=7779','-QueryPort=27005']:
                self.assertIn(arg,result['args'])
            self.assertIn('Password=operator-join',path.read_text());self.assertIn('Mod=keep',path.read_text())
            self.assertNotIn('cookies',path.read_text());self.assertNotIn('LetMeIn',path.read_text())

    def test_failed_update_restores_exact_config_metadata_and_preserves_world(self):
        for game,folder in [('tower','Tower'),('pavlov','Pavlov'),('ohd','HarshDoorstop')]:
            with self.subTest(game=game),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);path=root/folder/'Saved/Config/operator.ini';path.parent.mkdir(parents=True)
                path.write_bytes(b'operator\r\n');path.chmod(0o640);os.utime(path,ns=(1700000000000000000,1700000000000000000))
                world=path.parent/'world.bin';world.write_bytes(b'world')
                def fail(*args,**kwargs):path.write_bytes(b'overwritten');raise ValueError('fixture failed update')
                with patch.object(games.steam,'update',side_effect=fail),self.assertRaisesRegex(ValueError,'fixture failed'):
                    games.install(root,game,env(game))
                self.assertEqual(path.read_bytes(),b'operator\r\n');self.assertEqual(path.stat().st_mode & 0o777,0o640)
                self.assertEqual(path.stat().st_mtime_ns,1700000000000000000);self.assertEqual(world.read_bytes(),b'world')

    def test_platform_branch_private_transport_and_install_flags_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            for values in [{'WINDOWS_INSTALL':'1'},{'SRCDS_APPID':'1'},{'SRCDS_BETAID':'other'},{'INSTALL_FLAGS':'; touch outside'},{'STEAM_USER':'private-user','STEAM_PASS':'private-secret'}]:
                with self.subTest(values=values),self.assertRaises(ValueError):games.steam_options(Path(directory),'pavlov',env('pavlov',**values))

    def test_duplicate_managed_sections_and_path_escape_rejected(self):
        with self.assertRaises(ValueError):games.canonical_sections('[A]\nx=1\n[a]\nx=2\n',{'A':{}})
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);outside=root/'outside';outside.mkdir();(root/'Tower').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):games.plan(root,'tower',env('tower'))

    def test_private_library_abi_and_receipt_fail_closed(self):
        original=Path.read_text
        def debian(path,*args,**kwargs):
            return '12.14' if str(path)=='/etc/debian_version' else original(path,*args,**kwargs)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(Path,'read_text',debian),self.assertRaisesRegex(ValueError,'Install the private'):
                games.pavlov_libraries(root)
            with patch.object(Path,'read_text',return_value='13.1'),self.assertRaisesRegex(ValueError,'Debian12'):
                games.pavlov_libraries(root)

    def test_seed_does_not_replace_existing_operator_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for relative in ['Pavlov/Saved/Config/LinuxServer/Game.ini','Pavlov/Saved/Config/RconSettings.txt']:
                path=root/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'operator-owned')
            with patch.object(games.urllib.request,'urlopen',side_effect=AssertionError('no download')):
                games.seed_pavlov(root)


if __name__=='__main__':unittest.main()
