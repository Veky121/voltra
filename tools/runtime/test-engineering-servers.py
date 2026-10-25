import importlib.util
import io
import json
from pathlib import Path
import shutil
import struct
import tempfile
import unittest
from unittest import mock
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'internal/panel/game_library/scripts'
spec = importlib.util.spec_from_file_location('engineering_servers', SCRIPTS / 'engineering-servers.py')
adapter = importlib.util.module_from_spec(spec); spec.loader.exec_module(adapter)


def put(root, name, content):
    path = root / name; path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8'); return path


def pe(machine=0x8664):
    data = bytearray(256); data[:2] = b'MZ'; struct.pack_into('<I', data, 60, 128)
    data[128:132] = b'PE\0\0'; struct.pack_into('<H', data, 132, machine); return data


def elf():
    data = bytearray(64); data[:6] = b'\x7fELF\x02\x01'; struct.pack_into('<H', data, 18, 62); return data


def env(**values):
    return {'SERVER_PORT':'28020','VOLTRA_ALLOCATED_PORTS':'28020,28021,28022','STEAM_PORT':'28021','REMOTEAPI_PORT':'28022',**values}


class EngineeringTests(unittest.TestCase):
    def test_space_all_original_controls_and_selected_world(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            checkpoint = put(root,'config/Saves/Other World/Sandbox.sbc','<MyObjectBuilder_Checkpoint><Settings><EnableSaving>false</EnableSaving></Settings><Mods><item>keep mod</item></Mods></MyObjectBuilder_Checkpoint>')
            other = put(root,'config/Saves/World/Sandbox.sbc','untouched other world')
            values = env(WORLD_NAME='Other World', SERVER_NAME='literal <name> ??', SERVER_DESC='a & b', SERVER_MODE='Creative', MAX_PLAYERS='22', SAVE_INTERVAL='0', SAVE_ENABLED='true', EXPERIMENTAL_ENABLED='true', INGAMESCRIPTS_ENABLED='true', REMOTEAPI_ENABLE='true')
            argv, secrets = adapter.configure(root,'space',values)
            doc = ET.parse(root/'config/SpaceEngineers-Dedicated.cfg').getroot()
            self.assertEqual(doc.findtext('ServerName'),'literal <name> ??')
            for field, value in [('GameMode','Creative'),('MaxPlayers','22'),('AutoSaveInMinutes','0'),('EnableSaving','true'),('ExperimentalMode','true'),('EnableIngameScripts','true')]:
                self.assertEqual(doc.findtext('SessionSettings/'+field), value)
                self.assertEqual(ET.parse(checkpoint).findtext('Settings/'+field), value)
            self.assertEqual(doc.findtext('RemoteApiPort'),'28022')
            self.assertEqual(doc.findtext('SteamPort'),'28021')
            self.assertEqual(doc.findtext('RemoteApiEnabled'),'true')
            self.assertIn('Other World',doc.findtext('LoadWorld'))
            self.assertEqual(ET.parse(checkpoint).findtext('Mods/item'),'keep mod')
            self.assertEqual(other.read_text(),'untouched other world')
            self.assertEqual(argv[-2:],['-console','-ignorelastsession'])
            self.assertEqual(secrets,[])

    def test_space_admin_plugins_unknown_settings_and_api_key_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            put(root,'Instance/SpaceEngineers-Dedicated.cfg','<MyConfigDedicated><SessionSettings><ExperimentalMode>true</ExperimentalMode><ModCustom>retained</ModCustom></SessionSettings><RemoteSecurityKey>operator key</RemoteSecurityKey><Administrators><unsignedLong>123</unsignedLong></Administrators><Banned><unsignedLong>456</unsignedLong></Banned></MyConfigDedicated>')
            plugin=put(root,'Plugins/operator/plugin.dll','plugin fixture')
            torch=put(root,'Torch.cfg','operator Torch plugin configuration')
            argv,_=adapter.configure(root,'torch',env())
            doc=ET.parse(root/'Instance/SpaceEngineers-Dedicated.cfg').getroot()
            self.assertEqual(doc.findtext('RemoteSecurityKey'),'operator key')
            self.assertEqual(doc.findtext('SessionSettings/ExperimentalMode'),'true')
            self.assertEqual(doc.findtext('Administrators/unsignedLong'),'123')
            self.assertEqual(doc.findtext('Banned/unsignedLong'),'456')
            self.assertEqual(doc.findtext('SessionSettings/ModCustom'),'retained')
            self.assertIn('-noupdate',argv);self.assertIn('-nogui',argv);self.assertIn('-instancepath',argv)
            self.assertEqual(plugin.read_text(),'plugin fixture');self.assertEqual(torch.read_text(),'operator Torch plugin configuration')

    def test_invalid_config_is_rejected_before_publishing(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            path=put(root,'config/SpaceEngineers-Dedicated.cfg','<MyConfigDedicated><ServerName>old</ServerName></MyConfigDedicated>')
            original=path.read_bytes()
            for values in ({'SERVER_MODE':'shell'}, {'SAVE_ENABLED':'1'}, {'WORLD_NAME':'../world'}, {'MAX_PLAYERS':'-1'}, {'STEAM_PORT':'28020'}, {'REMOTEAPI_PORT':'9999'}):
                with self.assertRaises(ValueError): adapter.configure(root,'space',env(**values))
                self.assertEqual(path.read_bytes(),original)
            put(root,'config/Saves/World/Sandbox.sbc','<!DOCTYPE a [<!ENTITY e SYSTEM "file:///secret">]><MyObjectBuilder_Checkpoint/>')
            with self.assertRaises(ValueError):adapter.configure(root,'space',env())
            self.assertEqual(path.read_bytes(),original)

    def test_nitrox_all_controls_selected_save_and_unknown_fields(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            config=put(root,'NitroxData/saves/own_save/server.cfg','# retain comment\nSeed=operatorseed\nPostSaveCommandPath=/operator/hook\nLocalhostIsAdmin=False\nServerPort=1\n')
            world=put(root,'NitroxData/saves/own_save/world.json','operatorworld')
            argv, secrets=adapter.configure(root,'nitrox',env(SAVE_NAME='own_save', SAVE_INTERVAL='300000', SAVE_DISABLE='True', SUBNAUTICA_PASSWORD='password; literal', SUBNAUTICA_ADMIN_PASSWORD='admin literal', SERVER_MODE='HARDCORE', PORTFORWARD_ENABLE='False', SERIALIZER_MODE='PROTOBUF', MAX_CONNECTIONS='20', DEFAULT_PERMISSION='MODERATOR', DISABLE_CONSOLE='True'))
            text=config.read_text()
            for line in ['# retain comment','Seed=operatorseed','PostSaveCommandPath=/operator/hook','LocalhostIsAdmin=False','ServerPort=28020','SaveInterval=300000','DisableAutoSave=True','GameMode=HARDCORE','SerializerMode=PROTOBUF','DefaultPlayerPerm=MODERATOR','DisableConsole=True','MaxConnections=20','AdminPassword=admin literal']:
                self.assertIn(line,text)
            self.assertEqual(argv[1:3],['--save','own_save']);self.assertEqual(argv[-1],str(root/'NitroxData'))
            self.assertEqual(world.read_text(),'operatorworld');self.assertEqual(secrets,['password; literal','admin literal'])

    def test_nitrox_invalid_typed_values_and_injection(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for values in ({'SAVE_NAME':'../../escape'},{'SERIALIZER_MODE':'XML'},{'DEFAULT_PERMISSION':'ROOT'},{'DISABLE_CONSOLE':'false'},{'MAX_CONNECTIONS':'201'},{'SUBNAUTICA_PASSWORD':'x\nAdminPassword=injected'}):
                with self.assertRaises(ValueError):adapter.configure(root,'nitrox',env(**values))
            self.assertFalse((root/'NitroxData').exists())

    def test_private_steam_never_runs_or_falls_back(self):
        with tempfile.TemporaryDirectory() as folder:
            with mock.patch.object(adapter.steam,'update') as update,self.assertRaises(ValueError):
                adapter.install(Path(folder),'nitrox',{'STEAM_USERNAME':'owner','STEAM_PASSWORD':'secret','STEAM_GUARDCODE':'12345'})
            update.assert_not_called()

    def test_operator_base_game_validation_keeps_files_and_separate_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for name in ('subnautica/Subnautica.exe','subnautica/Subnautica_Data/Managed/Assembly-CSharp.dll'):
                put(root,name,'').write_bytes(pe())
            original=put(root,'subnautica/Subnautica_Data/StreamingAssets/world','licensed supplied fixture')
            with mock.patch.object(adapter,'install_nitrox') as public, mock.patch.object(adapter.steam,'update') as update:
                adapter.install(root,'nitrox',{'INSTALL_MODE':'operator_files'})
            public.assert_called_once();update.assert_not_called()
            receipt=json.loads((root/'.voltra/engineering/operator-files.json').read_text())
            self.assertFalse(receipt['runtime_verified']);self.assertFalse(receipt['publisher_authenticity_verified']);self.assertEqual(len(receipt['files']),2)
            self.assertEqual(original.read_text(),'licensed supplied fixture')
            original.unlink()
            with self.assertRaises(ValueError):adapter.operator_files(root,'nitrox',False)

    def test_nitrox_exact_version_identity_no_fallback(self):
        self.assertEqual(adapter.nitrox_release({'NITROX_VERSION':'latest'})['version'],'1.8.1.0')
        response=mock.MagicMock();response.__enter__.return_value.read.return_value=json.dumps({'tag_name':'1.8.0.1','assets':[]}).encode()
        with mock.patch.object(adapter.urllib.request,'urlopen',return_value=response),self.assertRaises(ValueError):
            adapter.nitrox_release({'NITROX_VERSION':'1.8.0.1'})
        with self.assertRaises(ValueError):adapter.nitrox_release({'NITROX_VERSION':'../../evil'})

    def test_zip_prevalidation_traversal_duplicate_symlink_and_special_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for bad in ('../escape','/absolute','drive:C','back\\slash'):
                archive=root/'bad.zip'
                with zipfile.ZipFile(archive,'w')as out:
                    out.writestr('safe','not published');out.writestr(bad,'bad')
                stage=root/'stage';stage.mkdir(exist_ok=True)
                with self.assertRaises(ValueError):adapter.extract_zip(archive,stage)
                self.assertEqual(list(stage.iterdir()),[])
            for mode in (0o120777,0o020666):
                with zipfile.ZipFile(root/'bad.zip','w')as out:
                    item=zipfile.ZipInfo('link');item.external_attr=mode<<16;out.writestr(item,'target')
                with self.assertRaises(ValueError):adapter.extract_zip(root/'bad.zip',stage)

    def test_program_update_retains_unknown_and_modified_files_and_correct_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);archive=root/'test.zip'
            with zipfile.ZipFile(archive,'w')as out:
                out.writestr('Torch.Server.exe','program');out.writestr('Torch.cfg','publisherconfig');out.writestr('Plugins/plugin.dll','newplugin')
            operator=put(root,'Torch.cfg','operatorconfig');plugin=put(root,'Plugins/plugin.dll','operatorplugin')
            pin={'version':'fixture','url':'https://publisher.invalid/fixture','sha256':'0'*64}
            def download(pin,target):shutil.copyfile(archive,target)
            with mock.patch.object(adapter.release,'download',side_effect=download):adapter.install_zip(root,pin,'.','fixture','Torch.Server.exe')
            receipt=json.loads((root/'.voltra/engineering/fixture/release.json').read_text())
            self.assertEqual(operator.read_text(),'operatorconfig');self.assertEqual(plugin.read_text(),'operatorplugin')
            self.assertEqual(list(receipt['files']),['Torch.Server.exe'])
            (root/'Torch.Server.exe').write_text('operator edited program')
            with mock.patch.object(adapter.release,'download',side_effect=download),self.assertRaises(ValueError):adapter.install_zip(root,pin,'.','fixture','Torch.Server.exe')
            self.assertEqual((root/'Torch.Server.exe').read_text(),'operator edited program')

    def test_program_publication_failure_rolls_back_without_losing_original(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);archive=root/'test.zip'
            first=put(root,'first.dll','old');put(root,'second.dll','old2')
            state=put(root,'.voltra/engineering/fixture/release.json',json.dumps({'files':{'first.dll':adapter.release.sha256(first),'second.dll':adapter.release.sha256(root/'second.dll')}}))
            oldreceipt=state.read_bytes()
            with zipfile.ZipFile(archive,'w')as out:out.writestr('first.dll','new');out.writestr('second.dll','new2')
            original=adapter.steam._publish;calls=0
            def publish(*args,**kwargs):
                nonlocal calls
                calls+=1
                if calls==2:raise OSError('fixture disk failure')
                return original(*args,**kwargs)
            with mock.patch.object(adapter.release,'download',side_effect=lambda pin,target:shutil.copyfile(archive,target)),mock.patch.object(adapter.steam,'_publish',side_effect=publish),self.assertRaises(OSError):
                adapter.install_zip(root,{'version':'fixture'},'.','fixture')
            self.assertEqual(first.read_text(),'old');self.assertEqual((root/'second.dll').read_text(),'old2');self.assertEqual(state.read_bytes(),oldreceipt)

    def test_wine_prerequisite_license_injection_and_prefix_architecture_gates(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for values in ({},{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINETRICKS_RUN':'dotnet48;evil'},{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINEPREFIX':'/tmp/outside'},{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINEARCH':'win32'}):
                with mock.patch.object(adapter.subprocess,'run')as run,self.assertRaises(ValueError):adapter.prepare_wine(root,'torch',values)
                run.assert_not_called()
            put(root,'.wine/system.reg','#arch=win32\n')
            with self.assertRaises(ValueError):adapter.prepare_wine(root,'torch',{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true'})

    def test_wine_derived_controls_install_once_and_no_secret_environment(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            values={'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','WINETRICKS_RUN':'','VOLTRA_WINETRICKS_RUN':'vcrun2022 corefonts dotnet48'}
            with mock.patch.object(adapter.subprocess,'run')as run:
                result=adapter.prepare_wine(root,'torch',values)
                self.assertEqual(run.call_count,4)
                self.assertEqual(run.call_args.args[0],['xvfb-run','-a','winetricks','-q','dotnet48'])
                run.reset_mock();adapter.prepare_wine(root,'torch',values);run.assert_not_called()
            self.assertEqual(result['WINEPREFIX'],str(root/'.wine'));self.assertEqual(result['WINEARCH'],'win64')
            self.assertEqual(result['WINEDLLOVERRIDES'],'mscoree=n,b;mshtml=n,b')

    def test_mono_uses_exact_upstream_checksum_and_success_receipt_only(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            values={'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','VOLTRA_WINETRICKS_RUN':'mono'}
            with mock.patch.object(adapter.release,'download')as download,mock.patch.object(adapter.subprocess,'run')as run:
                adapter.prepare_wine(root,'space',values)
                self.assertEqual(download.call_args.args[0]['sha256'],'8a0a1e6837b494df49927e5d759b1c6908e89b8a2f8e3ad025e1c2881882476e')
                self.assertIn('msiexec',run.call_args.args[0])

    def test_sdk_isolated_all_six_architectures_and_existing_operator_dlls(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for arch in ('32','64'):put(root,'.voltra/steamcmd/linux'+arch+'/steamclient.so','original client '+arch)
            original=put(root,'DedicatedServer64/steamclient64.dll','operator replacement retained')
            def update(stage,app,env,**options):
                self.assertEqual(app,1007);self.assertEqual(options['platform'],'windows')
                self.assertTrue(stage.is_relative_to(root/'.voltra/engineering/sdk'))
                for name in ('steamclient.dll','steamclient64.dll','tier0_s.dll','tier0_s64.dll','vstdlib_s.dll','vstdlib_s64.dll'):
                    (stage/name).write_bytes(pe(0x8664 if '64' in name else 0x14c))
                put(stage,'steamapps/appmanifest_1007.acf','SDK fixture')
            with mock.patch.object(adapter.steam,'update',side_effect=update):adapter.steam_sdk(root)
            self.assertEqual(original.read_text(),'operator replacement retained')
            self.assertEqual((root/'.steam/sdk64/steamclient.so').read_text(),'original client 64')
            self.assertFalse((root/'steamapps/appmanifest_1007.acf').exists())
            self.assertEqual(list((root/'.voltra/engineering/sdk').iterdir()),[])

    def test_native_console_original_nitrox_argv_and_secret_environment(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);console=mock.Mock();console.run.return_value=0
            with mock.patch.object(adapter,'operator_files'),mock.patch.object(adapter,'helper',return_value=console):
                with mock.patch.dict(adapter.os.environ,{'STEAM_PASSWORD':'private','PYTHONHOME':'private helper'}):
                    self.assertEqual(adapter.run(root,'nitrox',env(INSTALL_MODE='operator_files',SAVE_NAME='own_world')),0)
            argv=console.run.call_args.args[1];environment=console.run.call_args.args[2]
            self.assertEqual(argv[1:3],['--save','own_world'])
            self.assertEqual(environment['SUBNAUTICA_INSTALLATION_PATH'],str(root/'subnautica'))
            self.assertNotIn('STEAM_PASSWORD',environment);self.assertNotIn('PYTHONHOME',environment)
            self.assertEqual(console.run.call_args.args[3],'\x03')


if __name__=='__main__':unittest.main()
