import importlib.util
import json
import os
from pathlib import Path
import signal
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('frontier',Path('internal/panel/game_library/scripts/frontier-native.py'));f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

class Frontier(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','ECHO_PORT':'28002','CLUSTER_MAIN_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003','RCON_PASSWORD':'private-rcon'}
    def tearDown(self):self.temp.cleanup()
    def binary(self,game):
        path=self.root/f.GAMES[game][1];path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture, never executed');return path
    def eos(self,engine=None):
        path=self.root/'TheIsle/Saved/Config/LinuxServer/Engine.ini';path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(engine or '[EpicOnlineServices]\nDedicatedServerClientId=fixture-id\nDedicatedServerClientSecret=fixture-private-secret\n');return path
    def test_vein_original_and_current_advertisement_admin_and_unknowns(self):
        self.binary('vein');path=self.root/'Vein/Saved/Config/LinuxServer/Game.ini';path.parent.mkdir(parents=True);path.write_text('; keep\n[/Script/Vein.VeinGameSession]\nAdminSteamIDs=operator1\nAdminSteamIDs=operator2\nServerDescription=unknown\n[ConsoleVariables]\nvein.Operator=42\n');path.chmod(0o640)
        argv,secrets=f.configure(self.root,'vein',{**self.env,'PUBLIC_SERVER':'False','SERVER_NAME':'Literal $ + &','SERVER_PASSWORD':'secret-pass'});value=path.read_text()
        for token in ['; keep','AdminSteamIDs=operator1\nAdminSteamIDs=operator2','ServerDescription=unknown','vein.Operator=42','bShouldAdvertise = False','bPublic = False','ServerName = Literal $ + &']:self.assertIn(token,value)
        self.assertIn('-QueryPort=28001',argv);self.assertEqual(secrets,('secret-pass',));self.assertEqual(path.stat().st_mode&0o777,0o640)
    def test_evrima_disabled_roles_and_collision_before_writes(self):
        self.eos();env={**self.env,'RCON':'false','ENABLE_QUEUE':'true','QUEUE_PORT':'28001','RCON_PORT':'28001'}
        f.plan(self.root,'evrima',env)
        before={str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        with self.assertRaisesRegex(ValueError,'distinct assigned'):f.configure(self.root,'evrima',{**env,'RCON':'true'})
        self.assertEqual(before,{str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
    def test_evrima_all_controls_lists_map_and_eos_stay_operator_owned(self):
        self.binary('evrima');engine=self.eos('[Core.System]\nPaths=operator\n[EpicOnlineServices]\nDedicatedServerClientId=operator-id\nDedicatedServerClientSecret=operator-secret\n');before=engine.read_bytes()
        path=engine.with_name('Game.ini');path.write_text('[/Script/TheIsle.TIGameSession]\nMapName=OperatorMap\nCustom=1\n[/Script/TheIsle.TIGameStateBase]\nAdminsSteamIDs=111\nAdminsSteamIDs=222\nAllowedClasses=A\nAllowedClasses=B\n')
        argv,secrets=f.configure(self.root,'evrima',{**self.env,'RCON':'true','RCON_PORT':'28001','ENABLE_QUEUE':'true','QUEUE_PORT':'28002','PLAYER_COUNT':'80','SERVER_PASSWORD_ENABLED':'true','SERVER_PASSWORD':'join-private','HUMANS':'true','ALLOW_REPLAY':'true','DYNAMIC_WEATHER':'false','DISCORD':'operator'})
        value=path.read_text()
        for token in ['MapName=OperatorMap','Custom=1','AdminsSteamIDs=111\nAdminsSteamIDs=222','AllowedClasses=A\nAllowedClasses=B','MaxPlayerCount = 80','bEnableHumans = true','bAllowReplay = true','bServerDynamicWeather = false','discord = operator']:self.assertIn(token,value)
        self.assertEqual(engine.read_bytes(),before);self.assertNotIn('operator-secret',str(argv));self.assertIn('operator-secret',secrets)
    def test_evrima_exact_source_seed_only_when_missing(self):
        directory=self.root/'.voltra';directory.mkdir();(directory/'frontier-seeds.json').write_text(json.dumps({'evrima_engine':'[EpicOnlineServices]\nDedicatedServerClientId=fixture-id\nDedicatedServerClientSecret=fixture-secret\n'}))
        f.configure(self.root,'evrima',{**self.env,'QUEUE_PORT':'28001'});self.assertIn('fixture-id',(self.root/'TheIsle/Saved/Config/LinuxServer/Engine.ini').read_text())
    def test_missing_eos_no_acquisition_or_writes(self):
        with mock.patch.object(f.steam,'update') as update:
            with self.assertRaisesRegex(ValueError,'EOS configuration'):f.install(self.root,'evrima',{**self.env,'QUEUE_PORT':'28001'})
            update.assert_not_called();self.assertEqual(list(self.root.iterdir()),[])
    def test_soulmask_legacy_exact_controls_json_retention_and_password_redaction(self):
        path=self.root/'WS/Saved/GameplaySettings/GameXishu.json';path.parent.mkdir(parents=True);path.write_text('{"0":{"KaiQiKuaFu":0,"Operator":42},"1":{"Other":true},"custom":{"x":1}}')
        argv,secrets=f.configure(self.root,'soulmask',{**self.env,'SERVER_ID':'7','MAP':'DLC_Level01_Main','MOD_ID':'123,456','SERVER_PASSWORD':'join-private','ADMIN_PASSWORD':'admin-private','ENABLE_CROSS_SERVER':'1','SAVE_TIME':'600','BACKUP_TIME':'960','region':'3'})
        for item in ['WS','DLC_Level01_Main','-serverid=7','-mainserverport=28003','-clientserverconnect=127.0.0.1:28003','-mod=123,456','-gamedistindex=3','-saving=600','-backup=960']:self.assertIn(item,argv)
        value=json.loads(path.read_text());self.assertEqual(value['0']['Operator'],42);self.assertTrue(value['1']['Other']);self.assertEqual(value['custom'],{'x':1});self.assertTrue(all(value[k]['KaiQiKuaFu']==1 for k in ('0','1','2')));self.assertEqual(secrets,('join-private','admin-private'))
    def test_explicit_soulmask_modes_no_silent_save_topology_change(self):
        for mode,main,client in [('legacy',True,True),('standalone',False,False),('main',True,False),('client',False,True)]:
            argv,_,_=f.plan(self.root,'soulmask',{**self.env,'CLUSTER_MODE':mode,'CLUSTER_MAIN_IP':'10.0.0.2'})
            self.assertEqual(any(x.startswith('-mainserverport=') for x in argv),main);self.assertEqual(any(x.startswith('-clientserverconnect=') for x in argv),client)
    def test_all_managed_failures_happen_before_config_writes(self):
        self.eos();before={str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        for game,patch in [('vein',{'SERVER_NAME':'unsafe\nAdmins=x'}),('vein',{'QUERY_PORT':'28000'}),('evrima',{'SRCDS_BETAID':'legacy'}),('soulmask',{'MOD_ID':'123;touch'}),('soulmask',{'CLUSTER_MAIN_IP':'1.2.3.4;bad'}),('soulmask',{'MAP':'../../bad'}),('soulmask',{'ENABLE_CROSS_SERVER':'bad'})]:
            with self.subTest(game=game,patch=patch):
                with self.assertRaises(ValueError):f.configure(self.root,game,{**self.env,**patch})
                self.assertEqual(before,{str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
    def test_invalid_json_duplicates_and_modes_no_overwrite(self):
        path=self.root/'WS/Saved/GameplaySettings/GameXishu.json';path.parent.mkdir(parents=True)
        for content in ['[]','{"0":1}','{"0":{},"0":{"Operator":1}}','invalid']:
            path.write_text(content)
            with self.assertRaises(ValueError):f.configure(self.root,'soulmask',self.env)
            self.assertEqual(path.read_text(),content)
    def test_private_steam_rejected_before_acquisition_or_write(self):
        with mock.patch.object(f.steam,'update') as update:
            for game in f.GAMES:
                with self.assertRaisesRegex(ValueError,'Private Steam'):f.install(self.root,game,{**self.env,'STEAM_USER':'account','STEAM_PASS':'private'})
            update.assert_not_called();self.assertEqual(list(self.root.iterdir()),[])
    def test_failed_update_restores_world_mod_admin_and_metadata(self):
        binary=self.binary('vein');paths=[self.root/'Vein/Saved/SaveGames/world.vns',self.root/'Vein/Saved/Config/LinuxServer/Engine.ini',self.root/'Mods/operator.bin']
        for i,path in enumerate(paths):path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(('owned'+str(i)).encode());path.chmod(0o640)
        def fail(*args,**kwargs):
            for path in paths:path.write_bytes(b'publisher')
            raise RuntimeError('synthetic failure')
        with mock.patch.object(f.steam,'update',side_effect=fail):
            with self.assertRaises(RuntimeError):f.install(self.root,'vein',self.env)
        for i,path in enumerate(paths):self.assertEqual(path.read_bytes(),('owned'+str(i)).encode());self.assertEqual(path.stat().st_mode&0o777,0o640)
    def test_soulmask_original_sdk_acquisition_preserves_state(self):
        binary=self.binary('soulmask');calls=[]
        def update(root,app,env,**kwargs):
            calls.append(app);self.assertEqual(kwargs['platform'],'linux');(root/'.voltra').mkdir(exist_ok=True);(root/'.voltra/steam-template-release.json').write_text(json.dumps({'appid':str(app),'buildid':'fixture'}));return {'buildid':'fixture'}
        with mock.patch.object(f.steam,'update',side_effect=update):f.install(self.root,'soulmask',self.env)
        self.assertEqual(calls,[3017300,1007]);self.assertTrue(binary.stat().st_mode&0o100);self.assertEqual(json.loads((self.root/'.voltra/steam-template-release.json').read_text())['appid'],'3017300');self.assertEqual(json.loads((self.root/'.voltra/frontier-receipts/sdk.json').read_text())['appid'],'1007')
    def test_vein_publisher_sdk_layout_and_operator_world_retention(self):
        self.binary('vein');save=self.root/'Vein/Saved/SaveGames/Server.vns';save.parent.mkdir(parents=True);save.write_bytes(b'operator-world')
        def update(root,*args,**kwargs):
            sdk=root/'.steam/sdk64/steamclient.so';sdk.parent.mkdir(parents=True);sdk.write_bytes(b'synthetic-SDK');save.write_bytes(b'publisher-overwrite');return {'buildid':'fixture'}
        with mock.patch.object(f.steam,'update',side_effect=update):f.install(self.root,'vein',self.env)
        self.assertEqual(save.read_bytes(),b'operator-world');self.assertEqual((self.root/'Vein/Binaries/Linux/steamclient.so').read_bytes(),b'synthetic-SDK')
    def test_soulmask_sdk_failure_retains_game_receipt_and_operator_data(self):
        self.binary('soulmask');save=self.root/'WS/Saved/world.db';save.parent.mkdir(parents=True,exist_ok=True);save.write_bytes(b'owned')
        def update(root,app,env,**kwargs):
            (root/'.voltra').mkdir(exist_ok=True);(root/'.voltra/steam-template-release.json').write_text(json.dumps({'appid':app}));save.write_bytes(b'publisher-overwrite')
            if app==1007:raise RuntimeError('synthetic SDK failure')
            return {'appid':app}
        with mock.patch.object(f.steam,'update',side_effect=update):
            with self.assertRaises(RuntimeError):f.install(self.root,'soulmask',self.env)
        self.assertEqual(save.read_bytes(),b'owned');self.assertEqual(json.loads((self.root/'.voltra/steam-template-release.json').read_text())['appid'],3017300)
    def test_all_games_request_actual_sigint_keep_raw_exit_and_strip_secret_env(self):
        self.eos()
        for game in f.GAMES:
            console=type('Console',(),{'run':mock.Mock(return_value=23)})();original=f.helper
            with mock.patch.object(f,'helper',side_effect=lambda name:console if name=='native-console' else original(name)):
                self.assertEqual(f.run(self.root,game,{**self.env,'QUEUE_PORT':'28001','SERVER_PASSWORD':'private-password'}),23)
            args,kwargs=console.run.call_args;self.assertEqual(kwargs['stop_signal'],signal.SIGINT);self.assertTrue(kwargs['terminal_input']);self.assertNotIn('SERVER_PASSWORD',args[2]);self.assertNotIn('RCON_PASSWORD',args[2])
    def test_symlink_and_special_configuration_rejected(self):
        outside=self.root/'outside';outside.mkdir();(self.root/'Vein').symlink_to(outside,target_is_directory=True)
        with self.assertRaises(ValueError):f.configure(self.root,'vein',self.env)
        (self.root/'Vein').unlink();path=self.root/'Vein/Saved/Config/LinuxServer/Game.ini';path.parent.mkdir(parents=True);os.mkfifo(path)
        with self.assertRaisesRegex(ValueError,'regular file'):f.configure(self.root,'vein',self.env)

unittest.main()
