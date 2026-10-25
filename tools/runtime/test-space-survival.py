import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile
import tarfile
import threading
import time
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'internal/panel/game_library/scripts'
package=ROOT/'.local/space-survival/pyyaml.tar.gz'
expected=json.loads((BASE/'space-survival-pins.json').read_text())['pyyaml']['sha256']
if hashlib.sha256(package.read_bytes()).hexdigest()!=expected:raise ValueError('Fixture dependency checksum failed')
fixture_vendor=tempfile.TemporaryDirectory(prefix='space-fixture-yaml-')
tarfile.open(package).extractall(fixture_vendor.name,filter='data')
sys.path.insert(0,str(Path(fixture_vendor.name)/'pyyaml-6.0.3/lib'))
spec=importlib.util.spec_from_file_location('space_survival',BASE/'space-survival.py');adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
spec=importlib.util.spec_from_file_location('space_survival_console',BASE/'space-survival-console.py');console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)


def put(root,name,data):
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(data,encoding='utf-8');return path


def env(**values):return{'SERVER_PORT':'28020','VOLTRA_ALLOCATED_PORTS':'28020,28021,28022,28023,28024','QUERY_PORT':'28021',**values}


class SpaceSurvivalTests(unittest.TestCase):
    def test_astroneer_literal_config_ports_original_owner_controls(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            proton=mock.Mock();proton.location.return_value=root/'private-proton'
            with mock.patch.object(adapter,'helper',return_value=proton):argv,secrets,cwd,log=adapter.configure(root,'astroneer',env(PUBLIC_IP='203.0.113.20',OWNER_NAME='literal "name" ??',OWNER_GUID='76561198000000001',SERVER_PWD='owner-pass',SERVER_NAME='Server Name'))
            text=(root/'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini').read_text()
            self.assertIn('PublicIP = 203.0.113.20',text);self.assertIn('OwnerGuid = 76561198000000001',text)
            self.assertIn('PlayerFirstJoinName="literal \\"name\\" ??"',text)
            self.assertIn('ServerPassword = owner-pass',text)
            engine=(root/'Astro/Saved/Config/WindowsServer/Engine.ini').read_text()
            self.assertIn('Port = 28020',engine);self.assertIn('net.AllowEncryption = false',engine)
            self.assertEqual(argv[1],'run');self.assertEqual(cwd,root);self.assertIsNone(log);self.assertEqual(secrets,['owner-pass'])

    def test_astroneer_admin_replacement_retains_other_roles_saves_and_settings(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);path=put(root,'Astro/Saved/Config/WindowsServer/AstroServerSettings.ini','[/Script/Astro.AstroServerSettings]\n; keep comment\nDenyUnlistedPlayers=True\nActiveSaveFileDescriptiveName=OperatorWorld\nPlayerProperties=(PlayerGuid="999",PlayerCategory=Whitelisted)\n[Other]\nValue=keep\n')
            save=put(root,'Astro/Saved/SaveGames/operator.savegame','save bytes')
            with mock.patch.object(adapter,'helper')as helper:
                helper.return_value.location.return_value=root/'proton'
                adapter.configure(root,'astroneer',env(PUBLIC_IP='192.0.2.2',OWNER_NAME='Old',OWNER_GUID='123'))
                adapter.configure(root,'astroneer',env(PUBLIC_IP='192.0.2.2',OWNER_NAME='New',OWNER_GUID='456'))
            text=path.read_text();self.assertNotIn('PlayerGuid="123"',text);self.assertIn('PlayerGuid="456"',text)
            for value in('PlayerGuid="999"','DenyUnlistedPlayers=True','ActiveSaveFileDescriptiveName=OperatorWorld','; keep comment','[Other]','Value=keep'):self.assertIn(value,text)
            self.assertEqual(save.read_text(),'save bytes')

    def test_astroneer_bad_owner_ip_and_duplicate_managed_players_fail_before_writes(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            for values in({'PUBLIC_IP':'not an IP','OWNER_NAME':'name','OWNER_GUID':'123'},{'PUBLIC_IP':'192.0.2.2','OWNER_NAME':'name','OWNER_GUID':'x\nInjected'}):
                with self.assertRaises(ValueError):adapter.configure(root,'astroneer',env(**values))
            self.assertFalse((root/'Astro').exists())
            with self.assertRaises(ValueError):adapter.owner_players('[/Script/Astro.AstroServerSettings]\nPlayerProperties=(PlayerGuid="123")\nPlayerProperties=(PlayerGuid="123")\n','name','123','')

    def test_icarus_original_argv_query_userdir_and_legacy_admin_prospect_migration(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);legacy=put(root,'Icarus/Saved/Config/ServerSettings.ini','[/Script/Icarus.DedicatedServerSettings]\nAdminPassword=private-admin\nJoinPassword=private-join\nLoadProspect=OperatorProspect\nResumeProspect=True\n; comment\n')
            argv,secrets,cwd,log=adapter.configure(root,'icarus',env(SERVER_NAME='literal name; $(no shell)'))
            self.assertIn('-SteamServerName=literal name; $(no shell)',argv);self.assertIn('-PORT=28020',argv);self.assertIn('-QueryPort=28021',argv)
            self.assertIn('-UserDir=Z:'+str(root/'Icarus').replace('/','\\'),argv)
            target=root/'Icarus/Saved/Config/WindowsServer/ServerSettings.ini';self.assertEqual(target.read_bytes(),legacy.read_bytes())
            self.assertEqual(secrets,['private-admin','private-join']);self.assertEqual(log,root/'Icarus/Saved/Logs/Icarus.log')
            target.write_text('operator native config')
            adapter.configure(root,'icarus',env());self.assertEqual(target.read_text(),'operator native config')

    def test_icarus_default_publisher_config_and_invalid_query(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            with self.assertRaises(ValueError):adapter.configure(root,'icarus',env(QUERY_PORT='28020'))
            self.assertFalse((root/'Icarus').exists())
            adapter.configure(root,'icarus',env())
            self.assertEqual((root/'Icarus/Saved/Config/WindowsServer/ServerSettings.ini').read_text(),(BASE/'space-survival-icarus.ini').read_text())

    def test_empyrion_all_original_controls_preserve_native_custom_admin_scenario(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            path=put(root,'dedicated.yaml','# root comment\nServerConfig:\n  # retain\n  Tel_Pwd: operator-secret\n  Srv_Port: 1\n  SaveDirectory: CustomSaves\n  OperatorNested:\n    plugin: [one, two]\nGameConfig:\n  GameName: old\n  CustomMode: keep\n')
            admin=put(root,'Saves/adminconfig.yaml','operator admins');scenario=put(root,'Content/Scenarios/Custom/scenario.yaml','scenario')
            argv,secrets,cwd,log=adapter.configure(root,'empyrion',env(SERVER_NAME='literal name',SERVER_DESCRIPTION='a: b # literal ??',SERVER_PASSWORD='literal;pass',GAME_SEED='54321',MAX_PLAYERS='20',SERVER_PUBLIC='false',EAC_ACTIVE='false',MAX_ALLOWED_SIZE_CLASS='50',ALLOWED_BLUEPRINTS='StockOnly',SERVER_HEARTBEAT='0',TIMEOUT_BOOTING_PF_SERVER='600',GAME_NAME='OwnSave',GAME_MODE='Creative',CUSTOM_SCENARIO='Custom'))
            yaml=adapter.yaml_module(root);data=yaml.safe_load(path.read_text());s=data['ServerConfig'];g=data['GameConfig']
            for key,value in{'Srv_Port':28020,'Srv_Name':'literal name','Srv_Description':'a: b # literal ??','Srv_Password':'literal;pass','Srv_MaxPlayers':20,'Srv_Public':False,'EACActive':False,'MaxAllowedSizeClass':50,'AllowedBlueprints':'StockOnly','HeartbeatServer':0,'TimeoutBootingPfServer':600,'Tel_Port':1030,'Tel_Enabled':True,'Tel_Pwd':'operator-secret','SaveDirectory':'CustomSaves'}.items():self.assertEqual(s[key],value)
            for key,value in{'Seed':54321,'GameName':'OwnSave','Mode':'Creative','CustomScenario':'Custom','CustomMode':'keep'}.items():self.assertEqual(g[key],value)
            self.assertEqual(s['OperatorNested']['plugin'],['one','two']);self.assertIn('# retain',path.read_text());self.assertEqual(admin.read_text(),'operator admins');self.assertEqual(scenario.read_text(),'scenario')
            self.assertIn('-dedicated',argv);self.assertEqual(cwd,root/'DedicatedServer');self.assertEqual(secrets,['literal;pass','operator-secret'])

    def test_empyrion_generated_private_password_stable_and_telnet_unallocated(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            first=adapter.configure(root,'empyrion',env())[1][1];second=adapter.configure(root,'empyrion',env())[1][1]
            self.assertTrue(len(first)>20);self.assertEqual(first,second)
            with self.assertRaises(ValueError):adapter.configure(root,'empyrion',env(TELNET_PORT='28022'))
            with self.assertRaises(ValueError):adapter.configure(root,'empyrion',env(VOLTRA_ALLOCATED_PORTS='28020,28021'))

    def test_yaml_duplicate_and_unsafe_constructor_rejected_unknown_flow_preserved(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            for source in('ServerConfig:\n  Srv_Name: one\n  Srv_Name: two\n','ServerConfig: !!python/object/apply:os.system [evil]'):
                with self.assertRaises((ValueError,adapter.yaml_module(root).YAMLError)):adapter.patch_yaml(root,source,{'ServerConfig':{'Srv_Name':'new'}})
            updated=adapter.patch_yaml(root,'ServerConfig: {Srv_Name: old, Unknown: yes}\nGameConfig:\n  GameName: save\n',{'ServerConfig':{'Srv_Name':'new'}})
            self.assertEqual(adapter.yaml_module(root).safe_load(updated)['ServerConfig'],{'Srv_Name':'new','Unknown':True})

    def test_empyrion_invalid_typed_config_and_traversal_preserves_file(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);path=put(root,'dedicated.yaml','ServerConfig:\n  Srv_Port: 30000\nGameConfig:\n  GameName: old\n');old=path.read_bytes()
            for values in({'GAME_NAME':'../save'},{'CUSTOM_SCENARIO':'../custom'},{'SERVER_PUBLIC':'1'},{'GAME_SEED':'0'},{'SERVER_HEARTBEAT':'181'},{'ALLOWED_BLUEPRINTS':'shell'}):
                with self.assertRaises(ValueError):adapter.configure(root,'empyrion',env(**values))
                self.assertEqual(path.read_bytes(),old)

    def test_private_steam_rejected_before_game_yaml_or_proton_acquisition(self):
        with tempfile.TemporaryDirectory()as folder:
            for game in('astroneer','icarus','empyrion'):
                with mock.patch.object(adapter.steam,'update')as update,mock.patch.object(adapter,'install_yaml')as yaml,mock.patch.object(adapter,'helper')as helper,self.assertRaises(ValueError):adapter.install(Path(folder),game,{'STEAM_USER':'owner','STEAM_PASS':'private'})
                update.assert_not_called();yaml.assert_not_called();helper.assert_not_called()

    def test_public_original_windows_app_and_branch_passed_to_typed_transport(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            with mock.patch.object(adapter.steam,'update')as update,mock.patch.object(adapter,'install_yaml')as yaml:
                adapter.install(root,'empyrion',{'SRCDS_BETAID':'publicbranch'})
            self.assertEqual(update.call_args.args[1],530870);self.assertEqual(update.call_args.args[2]['SRCDS_BETAID'],'publicbranch');self.assertEqual(update.call_args.kwargs['platform'],'windows');yaml.assert_called_once()
            with self.assertRaises(ValueError):adapter.install(root,'icarus',{'SRCDS_APPID':'1'})

    def test_icarus_reuses_common_wine_with_all_original_runtime_controls(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);prerequisites=mock.Mock();prerequisites.prepare.return_value={};native=mock.Mock();native.run.return_value=0
            values=env(AUTO_UPDATE='0',WINETRICKS_RUN='',VOLTRA_WINETRICKS_RUN='vcrun2022 corefonts',WINEDEBUG='-all',WINEARCH='win64',WINEPATH=str(root),ACCEPT_WINDOWS_RUNTIME_LICENSES='true')
            with mock.patch.object(adapter,'helper',side_effect=lambda name:prerequisites if name=='private-wine-prerequisites'else native):
                self.assertEqual(adapter.run(root,'icarus',values),0)
            args=prerequisites.prepare.call_args.args
            self.assertEqual(args[1],values);self.assertEqual(args[2],'vcrun2022 corefonts');self.assertEqual(args[4],('vcrun2022','corefonts'))
            self.assertEqual(native.run.call_args.args[3],'\x03')

    def test_pinned_yaml_installer_retains_unknown_code_and_uses_public_cache(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);cache=root/'.voltra/public-cache';cache.mkdir(parents=True)
            shutil.copyfile(ROOT/'.local/space-survival/pyyaml.tar.gz',cache/adapter.PINS['pyyaml']['sha256'])
            adapter.install_yaml(root)
            self.assertTrue((root/'.voltra/python-packages/yaml/__init__.py').is_file())
            marker=put(root,'.voltra/python-packages/yaml/__init__.py','operator modified parser')
            with self.assertRaises(ValueError):adapter.install_yaml(root)
            self.assertEqual(marker.read_text(),'operator modified parser')

    def test_log_tail_rotation_unicode_redaction_final_drain(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);path=root/'server.log';finished=threading.Event();output=io.StringIO()
            with mock.patch.object(adapter.sys,'stdout',output):
                thread=threading.Thread(target=adapter.follow_log,args=(path,finished,['privatepass']));thread.start()
                path.write_bytes('first ?? privatepass\n'.encode());time.sleep(.2)
                path.rename(root/'previous.log');path.write_text('rotated final\n');time.sleep(.2);finished.set();thread.join(timeout=2)
            self.assertFalse(thread.is_alive());self.assertIn('??',output.getvalue());self.assertIn('rotated final',output.getvalue());self.assertNotIn('privatepass',output.getvalue())

    def test_empyrion_real_fixture_tcp_auth_and_original_saveandexit(self):
        # Tiny local Python fixture, not a game server or publisher acceptance.
        with socket.socket()as reservation:reservation.bind(('127.0.0.1',0));port=reservation.getsockname()[1]
        child='import socket,sys\ns=socket.socket();s.bind(("127.0.0.1",int(sys.argv[1])));s.listen();c,_=s.accept();c.sendall(b"Please enter password:");f=c.makefile("rb");assert f.readline()==b"fixture-secret\\r\\n";assert f.readline()==b"help\\r\\n";assert f.readline()==b"saveandexit 0\\r\\n";c.sendall(b"fixture shutdown");c.close();s.close()'
        stdin=type('Input',(),{'buffer':io.BytesIO(b'help\nsaveandexit 0\n')})()
        stdout=type('Output',(),{'buffer':io.BytesIO()})()
        with mock.patch.object(console.sys,'stdin',stdin),mock.patch.object(console.sys,'stdout',stdout):
            result=console.run(port,[sys.executable,'-c',child,str(port)],{**os.environ,'VOLTRA_EMPYRION_PASSWORD':'fixture-secret'})
        self.assertEqual(result,0)


if __name__=='__main__':unittest.main()

