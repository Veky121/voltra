#!/usr/bin/env python3
"""MIT. Offline source/config/mod/lifecycle fixtures; no native game proof."""
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE=Path('internal/panel/game_library/scripts/conan-empires.py').resolve()
spec=importlib.util.spec_from_file_location('games',SOURCE)
games=importlib.util.module_from_spec(spec);spec.loader.exec_module(games)


def env(**values):
    return {'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003,28004',**values}


class ConanEmpiresTests(unittest.TestCase):
    def test_conan_original_argv_and_independent_admin_rcon_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            plan=games.configure_plan(root,'conan',env(SRV_NAME='Conan $ + server',SRV_PW='join-secret',ADMIN_PASSWORD='admin-secret',
                        RCON_ENABLED='1',RCON_PASSWORD='rcon-secret',RCON_PORT='28003',QUERY_PORT='28002'))
            for arg in ['-Port=28000','-QueryPort=28002','-RconPort=28003','-ServerName="Conan $ + server"','-ServerPassword="join-secret"','-console','-log']:
                self.assertIn(arg,plan['args'])
            self.assertTrue(plan['rcon_enabled']);self.assertEqual(plan['rcon_password'],'rcon-secret')
            self.assertIn('admin-secret',plan['credentials']);self.assertIn('join-secret',plan['credentials'])
            self.assertEqual(plan['configs']['ConanSandbox/Saved/Config/WindowsServer/ServerSettings.ini']['ServerSettings']['AdminPassword'],'admin-secret')
            self.assertEqual(plan['configs']['ConanSandbox/Saved/Config/WindowsServer/Game.ini']['RconPlugin']['RconPassword'],'rcon-secret')

    def test_enhanced_native_linux_and_optional_rcon(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            plan=games.configure_plan(root,'enhanced',env(SERVER_NAME='Enhanced',MAX_PLAYERS='45',RCON_ENABLED='0'))
            self.assertEqual(plan['binary'],root/games.GAMES['enhanced'][2])
            self.assertIn('-MaxPlayers=45',plan['args']);self.assertIn('-MultihomeHTTP=0.0.0.0',plan['args'])
            self.assertFalse(any(arg.startswith('-ServerPassword=')for arg in plan['args']))
            self.assertNotIn('RCON_PORT',plan['ports'])
            for values in [{'RCON_ENABLED':'1'}, {'RCON_ENABLED':'1','RCON_PASSWORD':'private','RCON_PORT':'28000'}, {'QUERY_PORT':'28001'}]:
                with self.subTest(values=values),self.assertRaises(ValueError):
                    games.configure_plan(root,'enhanced',env(**values))

    def test_empires_every_original_map_id_admin_shutdown_and_extra_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            data=env(MAP_NAME='LargeTerrain_Central2_Main',SERVER_NAME='MoE $ +',PVP='0',MAX_PLAYERS='75',SHUTDOWN_SERVICE='1',
                     RCON_PASSWORD='private-service-key',ADMIN_IDS='76561198000000001;76561198000000002',CLUSTER_ID='2',SERVER_ID='107',
                     OUT_ADDRESS='',SERVER_IP='192.0.2.10',EXTRA_FLAGS='-NoAsyncLoadingThread -ExampleAuthToken=private-token')
            plan=games.configure_plan(root,'empires',data)
            self.assertEqual(plan['args'][0],'LargeTerrain_Central2_Main')
            for value in ['-DataLocalFile','-NotCheckServerSteamAuth','-LOCALLOGTIMES','-PrivateServer','-UseACE','-EnableVACBan=1',
                          '-OutAddress=192.0.2.10','-SessionName="MoE $ +"','-GameServerPVPType=0','-MaxPlayers=75',
                          '-MapDifficultyRate=1','-ServerId=107','-ClusterId=2','-Port=28000','-QueryPort=28001',
                          '-bStartShutDownServiceInPrivateServer=1','-ShutDownServiceIP=127.0.0.1','-ShutDownServicePort=28002',
                          '-ShutDownServiceKey="private-service-key"','-ServerAdminAccounts="76561198000000001;76561198000000002"','-NoAsyncLoadingThread']:
                self.assertIn(value,plan['args'])
            self.assertFalse(plan['rcon_enabled'])
            self.assertIn('private-token',plan['credentials'])
            self.assertIsNone(plan['ready'].search(b'LogInit: Display: Starting Game.'))
            self.assertIsNone(plan['ready'].search(b'ServerId:100, ServerState:EGameServerState::SERVER_STATE_OPENED'))
            self.assertIsNotNone(plan['ready'].search(b'ServerId:107, ServerState:EGameServerState::SERVER_STATE_OPENED'))
            off=games.configure_plan(root,'empires',{**data,'SHUTDOWN_SERVICE':'0','RCON_PORT':''})
            self.assertNotIn('RCON_PORT',off['ports']);self.assertIn('-bStartShutDownServiceInPrivateServer=0',off['args'])

    def test_invalid_controls_paths_ports_and_native_syntax_fail(self):
        for game,values in [('conan',{'SRV_NAME':'bad"quote'}),('conan',{'QUERY_PORT':'28001'}),
                            ('enhanced',{'MAX_PLAYERS':'1.5'}),('empires',{'OUT_ADDRESS':'::1','RCON_PASSWORD':'valid-key'}),
                            ('empires',{'OUT_ADDRESS':'192.0.2.10','RCON_PASSWORD':'valid-key','ADMIN_IDS':'invented-name'}),
                            ('empires',{'OUT_ADDRESS':'192.0.2.10','RCON_PASSWORD':'valid-key','EXTRA_FLAGS':'-Port=12'}),
                            ('empires',{'OUT_ADDRESS':'192.0.2.10','RCON_PASSWORD':'valid-key','EXTRA_FLAGS':'-foo; touch /tmp/bad'})]:
            with self.subTest(game=game,values=values),tempfile.TemporaryDirectory() as directory,self.assertRaises(ValueError):
                games.configure_plan(Path(directory),game,env(**values))
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root=Path(directory);(root/'linked').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):games.confined(root,'linked/file')

    def test_native_ini_preservation_admin_settings_and_private_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);folder=root/'ConanSandbox/Saved/Config/LinuxServer';folder.mkdir(parents=True)
            path=folder/'ServerSettings.ini'
            path.write_text(';keep comment\n[ServerSettings]\nAdminPassword=old\nServerPassword=keep-native-password\nPVPEnabled=False\n[/Script/Mods.Example]\nRepeat=one\nRepeat=two\n')
            (folder/'Engine.ini').write_text('[OnlineSubsystem]\nServerPassword=keep-native-password\nbUseBuildIdOverride=True\nBuildIdOverride=operator-value\n')
            (root/'ConanSandbox/Saved/game.db').write_bytes(b'legacy-world')
            (root/'ConanSandbox/Saved/game_0.db').write_bytes(b'enhanced-world')
            plan=games.configure(root,'enhanced',env(ADMIN_PASSWORD='new-admin',RCON_ENABLED='1',RCON_PASSWORD='separate-private',MAX_PLAYERS='17'))
            self.assertIn('keep-native-password',plan['credentials'])
            self.assertIn('AdminPassword= new-admin',path.read_text())
            for value in [';keep comment','PVPEnabled=False','Repeat=one','Repeat=two']:
                self.assertIn(value,path.read_text())
            self.assertIn('BuildIdOverride=operator-value',(folder/'Engine.ini').read_text())
            self.assertIn('ServerPassword=keep-native-password',path.read_text())
            self.assertIn('ServerPassword=keep-native-password',(folder/'Engine.ini').read_text())
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertTrue(list((root/'.voltra/conan-empires/config-backups').glob('*')))
            self.assertEqual((root/'ConanSandbox/Saved/game.db').read_bytes(),b'legacy-world')
            self.assertEqual((root/'ConanSandbox/Saved/game_0.db').read_bytes(),b'enhanced-world')

    def workshop(self,root,identifier,name,data):
        path=root/'steamapps/workshop/content/440900'/identifier/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        return path

    def test_workshop_update_owned_retirement_and_original_pak_names(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.workshop(root,'123','ExactOriginalName.pak',b'version1')
            self.workshop(root,'123','ExactOriginalName.ucas',b'sidecar1')
            self.workshop(root,'456','Second.pak',b'second')
            games.sync_mods(root,{'MOD_IDS':'123, 456'})
            folder=root/'ConanSandbox/Mods';listing=folder/'modlist.txt'
            self.assertEqual(listing.read_text().splitlines(),['*123/ExactOriginalName.pak','*456/Second.pak'])
            listing.write_text('# operator ordering\n*456/Second.pak\n*123/ExactOriginalName.pak\n')
            self.workshop(root,'123','ExactOriginalName.pak',b'version2')
            games.sync_mods(root,{'MOD_IDS':'123,456'})
            self.assertEqual((folder/'123/ExactOriginalName.pak').read_bytes(),b'version2')
            self.assertTrue(listing.read_text().startswith('# operator ordering\n*456/Second.pak'))
            games.sync_mods(root,{'MOD_IDS':'123'})
            self.assertFalse((folder/'456/Second.pak').exists())
            self.assertNotIn('*456/Second.pak',listing.read_text())
            self.assertTrue(list((root/'.voltra/conan-empires/retired-mods').rglob('Second.pak')))
            self.assertTrue((root/'steamapps/workshop/content/440900/456/Second.pak').is_file())
            self.assertEqual((root/'.voltra/conan-empires/mods.json').stat().st_mode&0o777,0o600)

    def test_custom_unpacked_mods_and_operator_changed_pak_never_deleted(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.workshop(root,'123','Original.pak',b'upstream')
            folder=root/'ConanSandbox/Mods';(folder/'Custom').mkdir(parents=True)
            (folder/'Custom/MyCustom.pak').write_bytes(b'custom')
            games.sync_mods(root,{'MOD_IDS':'123'})
            (folder/'123/Original.pak').write_bytes(b'operator edit')
            with self.assertRaisesRegex(ValueError,'operator edit'):
                games.sync_mods(root,{'MOD_IDS':'123'})
            games.sync_mods(root,{'MOD_IDS':''})
            self.assertEqual((folder/'123/Original.pak').read_bytes(),b'operator edit')
            self.assertIn('*123/Original.pak',(folder/'modlist.txt').read_text())
            self.assertIn('*Custom/MyCustom.pak',(folder/'modlist.txt').read_text())
            self.assertEqual((folder/'Custom/MyCustom.pak').read_bytes(),b'custom')

    def test_preexisting_identical_unmanaged_mod_is_not_claimed_or_retired(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.workshop(root,'123','Same.pak',b'same')
            target=root/'ConanSandbox/Mods/123/Same.pak';target.parent.mkdir(parents=True);target.write_bytes(b'same')
            games.sync_mods(root,{'MOD_IDS':'123'});games.sync_mods(root,{'MOD_IDS':''})
            self.assertEqual(target.read_bytes(),b'same')
            self.assertIn('*123/Same.pak',(target.parent.parent/'modlist.txt').read_text())

    def test_removed_managed_mod_retires_only_unchanged_owned_extracted_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.workshop(root,'123','Original.pak',b'upstream')
            games.sync_mods(root,{'MOD_IDS':'123'})
            folder=root/'ConanSandbox/Saved/ExtractedMods';folder.mkdir(parents=True)
            (folder/'Original.operator').write_bytes(b'preexisting unknown cache')
            before=games.cache_snapshot(root)
            (folder/'Original.native').write_bytes(b'created during owned source fixture')
            (folder/'Original-changed').write_bytes(b'created then operator changed')
            games.record_mod_cache(root,before)
            (folder/'Original-changed').write_bytes(b'operator edit')
            games.sync_mods(root,{'MOD_IDS':''})
            self.assertFalse((folder/'Original.native').exists())
            self.assertEqual((folder/'Original.operator').read_bytes(),b'preexisting unknown cache')
            self.assertEqual((folder/'Original-changed').read_bytes(),b'operator edit')
            self.assertTrue(list((root/'.voltra/conan-empires/retired-mod-cache').rglob('Original.native')))

    def test_legacy_generated_link_is_adopted_only_when_confined(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root=Path(directory);source=self.workshop(root,'123','Name.pak',b'owned')
            folder=root/'ConanSandbox/Mods';folder.mkdir(parents=True)
            (folder/'123').symlink_to(source.parent,target_is_directory=True)
            games.sync_mods(root,{'MOD_IDS':'123'})
            self.assertFalse((folder/'123').is_symlink());self.assertEqual((folder/'123/Name.pak').read_bytes(),b'owned')
            self.workshop(root,'456','Other.pak',b'source')
            (folder/'456').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):games.sync_mods(root,{'MOD_IDS':'456'})

    def test_platform_and_private_transport_guard_before_any_update(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for game,(app,platform,binary)in games.GAMES.items():
                self.assertEqual(games.steam_options(root,game,{})[:3],(app,platform,binary))
            with patch.object(games.steam,'update',side_effect=AssertionError('no update')):
                for game,values in [('conan',{'STEAM_USER':'private-user','STEAM_PASS':'private-secret'}),
                                    ('enhanced',{'WINDOWS_INSTALL':'1'}),('empires',{'INSTALL_FLAGS':'+quit'}),
                                    ('conan',{'SRCDS_APPID':'1794810'})]:
                    with self.subTest(game=game,values=values),self.assertRaises(ValueError):games.install(root,game,values)

    def test_interrupted_update_preserves_exact_ini_metadata_and_worlds(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);folder=root/'ConanSandbox/Saved/Config/LinuxServer';folder.mkdir(parents=True)
            path=folder/'Game.ini';data=b'; bytes\r\n[RconPlugin]\r\nUnknown=preserved\r\n';path.write_bytes(data);path.chmod(0o640);before=path.stat()
            world=root/'ConanSandbox/Saved/game_0.db';world.write_bytes(b'operator sqlite world')
            def interrupt(*args,**kwargs):
                self.assertEqual(args[1],443030);self.assertEqual(kwargs['platform'],'linux')
                path.write_text('replaced sample');raise RuntimeError('fixture interruption')
            with patch.object(games.steam,'update',side_effect=interrupt):
                with self.assertRaises(RuntimeError):games.install(root,'enhanced',{})
            self.assertEqual(path.read_bytes(),data);self.assertEqual(path.stat().st_mode,before.st_mode)
            self.assertEqual(path.stat().st_mtime_ns,before.st_mtime_ns);self.assertEqual(world.read_bytes(),b'operator sqlite world')

    def test_private_wine_prerequisite_allowlist_and_actual_file_presence(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for values in [{},{'VOLTRA_WINETRICKS_RUN':'vcrun2022;touch'},{'VOLTRA_WINETRICKS_RUN':'vcrun2022 vcrun2022'},
                           {'WINE_PREREQUISITES_READY':'1'}]:
                with self.subTest(values=values),self.assertRaises(ValueError):games.environment(root,'conan',values)
            prefix=root/'.voltra/conan-empires/wine-prefix'
            for name in ['system.reg','drive_c/windows/system32/vcruntime140.dll','drive_c/windows/system32/msvcp140.dll','drive_c/windows/Fonts/arial.ttf']:
                path=prefix/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture-only')
            result=games.environment(root,'conan',{'VOLTRA_WINETRICKS_RUN':'vcrun2022 corefonts','WINE_PREREQUISITES_READY':'1','WINEDEBUG':'+timestamp','WINEPATH':'/home/container'})
            self.assertEqual(result['WINEPREFIX'],str(prefix));self.assertEqual(result['WINEDEBUG'],'+timestamp')
            native=games.environment(root,'empires',{})
            self.assertEqual(native['PROTON_USE_WINED3D'],'1');self.assertEqual(native['PROTON_NO_ESYNC'],'1')
            self.assertTrue(native['STEAM_COMPAT_DATA_PATH'].endswith('/1794810'))

    def test_real_tiny_linux_process_ctrl_c_and_current_log_readiness(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/games.GAMES['enhanced'][2];binary.parent.mkdir(parents=True)
            binary.write_text('#!'+sys.executable+'\nimport signal,sys,time\nfrom pathlib import Path\ndef stop(s,f):\n Path("fixture-stop").write_text("SIGINT")\n sys.exit(0)\nsignal.signal(signal.SIGINT,stop)\nprint("Started SourceServerQueries",flush=True)\nwhile True:time.sleep(.05)\n');binary.chmod(0o755)
            launcher=root/'fixture-supervisor.py'
            launcher.write_text('import importlib.util,os,sys\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location("games",'+repr(str(SOURCE))+')\ng=importlib.util.module_from_spec(s);s.loader.exec_module(g)\nr=Path.cwd()\np=g.configure_plan(r,"enhanced",'+repr(env())+')\nsys.exit(g.run(r,"enhanced",p,dict(os.environ)))\n')
            child=subprocess.Popen([sys.executable,'-B',str(launcher)],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                # A blocking pipe reader is contained in a daemon thread; bounded main wait.
                lines=[]
                import threading
                def read():
                    for line in iter(child.stdout.readline,b''):lines.append(line)
                reader=threading.Thread(target=read,daemon=True);reader.start()
                deadline=time.monotonic()+10
                while not any(b'VOLTRA_CONAN_EMPIRES_READY' in line for line in lines):
                    if time.monotonic()>deadline or child.poll()is not None:self.fail('Source process fixture not ready')
                    time.sleep(.05)
                child.send_signal(signal.SIGTERM);self.assertEqual(child.wait(timeout=15),0)
                reader.join(timeout=2);self.assertEqual((root/'fixture-stop').read_text(),'SIGINT')
            finally:
                if child.poll()is None:child.kill();child.wait()
                child.stdout.close();child.stderr.close()


unittest.main()
