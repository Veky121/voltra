import os
import subprocess
from pathlib import Path
import sys
import tempfile
import types
import socket
import threading
import unittest
from unittest import mock

steam=types.ModuleType('steam_template');exec(STEAM_SOURCE,steam.__dict__);sys.modules['steam_template']=steam
installer=types.ModuleType('source_install');exec(INSTALL_SOURCE,installer.__dict__);sys.modules['source_install']=installer
console=types.ModuleType('native_console');exec(CONSOLE_SOURCE,console.__dict__);sys.modules['native_console']=console
runtime=types.ModuleType('source_runtime');exec(RUNTIME_SOURCE,runtime.__dict__)
sys.modules['source_runtime']=runtime
l4d=types.ModuleType('source_l4d');exec(L4D_SOURCE,l4d.__dict__);sys.modules['source_l4d']=l4d
variant=types.ModuleType('source_variant_runtime');exec(VARIANT_SOURCE,variant.__dict__)


def fixture(root, app='232330'):
    (root/('srcds_run_64' if app=='673990' else 'srcds_run')).write_bytes(b'publisher launcher')
    return {'SRCDS_APPID':app,'SERVER_PORT':'27015','VOLTRA_ALLOCATED_PORTS':'27015,27016,27017'}


class SourceTests(unittest.TestCase):
    def test_l4d2_invalid_platform_uses_one_windows_acquisition_then_explicit_linux_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cfg=root/'left4dead2/cfg/server.cfg';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'operator\xff\r\n');os.chown(cfg,345,678);cfg.chmod(0o640)
            calls=[]
            def acquire(root,app,**options):
                calls.append(options);cfg.unlink();cfg.write_bytes(b'publisher overwrite')
                if len(calls)==1:raise steam.SteamInstallError(222860,8,'invalid_platform')
                if options['platform']=='linux':(root/'srcds_linux').write_bytes(b'\x7fELF\x01\x01native fixture')
                return {'buildid':42,'appid':app,'StateFlags':4}
            with mock.patch.object(installer,'steam_update',side_effect=acquire):result=installer.update(root,222860,env={},validate=False,required=('srcds_run',))
            self.assertEqual(result['buildid'],42);self.assertEqual([c['platform'] for c in calls],['linux','windows','linux'])
            self.assertEqual([c['validate'] for c in calls],[False,False,True]);self.assertEqual(calls[-1]['force_platform'],True)
            self.assertEqual(calls[1]['env']['WINDOWS_INSTALL'],'1');self.assertEqual(calls[2]['env']['WINDOWS_INSTALL'],'0')
            self.assertEqual(cfg.read_bytes(),b'operator\xff\r\n');self.assertEqual((cfg.stat().st_mode&0o777,cfg.stat().st_uid,cfg.stat().st_gid),(0o640,345,678))
            audits=list((root/'.voltra/source/platform-corrections').glob('*.json'));self.assertEqual(len(audits),1)
            import json
            audit=json.loads(audits[0].read_text());self.assertEqual(audit['phase'],'complete');self.assertEqual(audit['elf_bits'],32);self.assertEqual(audits[0].stat().st_mode&0o777,0o600)

    def test_l4d2_correction_does_not_retry_generic_other_app_or_later_phase_failures(self):
        scenarios=[(222860,RuntimeError('publisher failure'),1),(232330,steam.SteamInstallError(232330,8,'invalid_platform'),1),(222860,steam.SteamInstallError(232330,8,'invalid_platform'),1)]
        for app,error,expected in scenarios:
            with self.subTest(app=app,error=type(error).__name__),tempfile.TemporaryDirectory() as directory:
                with mock.patch.object(installer,'steam_update',side_effect=error) as acquire:
                    with self.assertRaises(RuntimeError):installer.update(Path(directory),app,env={})
                    self.assertEqual(acquire.call_count,expected)
        for fail_at in (2,3):
            with self.subTest(fail_at=fail_at),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);cfg=root/'left4dead2/cfg/server.cfg';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'operator')
                count=0
                def acquire(*args,**options):
                    nonlocal count
                    count+=1;cfg.write_bytes(b'publisher')
                    if count==1 or count==fail_at:raise steam.SteamInstallError(222860,8,'invalid_platform')
                    return {'buildid':42}
                with mock.patch.object(installer,'steam_update',side_effect=acquire):
                    with self.assertRaises(steam.SteamInstallError):installer.update(root,222860,env={})
                self.assertEqual(count,fail_at);self.assertEqual(cfg.read_bytes(),b'operator')

    def test_l4d2_correction_requires_final_linux_elf_and_confined_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);responses=[steam.SteamInstallError(222860,8,'invalid_platform'),{'buildid':42},{'buildid':42}]
            (root/'srcds_linux').write_bytes(b'MZ Windows fixture')
            with mock.patch.object(installer,'steam_update',side_effect=responses) as acquire:
                with self.assertRaisesRegex(ValueError,'native Linux'):installer.update(root,222860,env={})
            self.assertEqual(acquire.call_count,3)
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as external:
            root=Path(directory);(root/'.voltra/source').mkdir(parents=True);(root/'.voltra/source/platform-corrections').symlink_to(external)
            with mock.patch.object(installer,'steam_update',side_effect=steam.SteamInstallError(222860,8,'invalid_platform')) as acquire:
                with self.assertRaises(ValueError):installer.update(root,222860,env={})
            self.assertEqual(acquire.call_count,1);self.assertEqual(list(Path(external).iterdir()),[])

    def test_existing_three_port_source_argv_contract_is_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            argv,_=runtime.configure(root,env)
            self.assertEqual(argv,[str(root/'srcds_run'),'-game','cstrike','-console','-ip','0.0.0.0','-port','27015','-strictportbind','-norestart','-maxplayers','24','+clientport','27016','+tv_port','27017','+servercfgfile','voltra-server.cfg','+exec','voltra-managed.cfg','+sv_lan','1','+exec','voltra-login.cfg','+map','de_dust2'])

    def test_trusted_64bit_launcher_and_untrusted_launcher_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root,'673990')
            argv,_=variant.launch(root,env)
            self.assertEqual(argv[0],str(root/'srcds_run_64'));self.assertFalse((root/'srcds_run').exists())
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            with self.assertRaises(ValueError):runtime.configure(root,env,launcher='../outside')
            self.assertFalse((root/'cstrike').exists())

    def test_left4dead_one_real_allocation_without_source_tv_or_fake_capacity(self):
        for app,game in [('222840','left4dead'),('222860','left4dead2')]:
            with self.subTest(app=app),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=fixture(root,app)
                argv,_=variant.launch(root,{**env,'VOLTRA_ALLOCATED_PORTS':'27015','GAMEMODE':'versus','DIFFICULTY':'Impossible'})
                self.assertNotIn('-maxplayers',argv);self.assertNotIn('+tv_port',argv)
                self.assertNotIn('+clientport',argv);self.assertNotIn('+servercfgfile',argv)
                self.assertEqual(argv[argv.index('+mp_gamemode')+1],'versus')
                cfg=root/game/'cfg/voltra-managed.cfg';self.assertNotIn('tv_enable',cfg.read_text());self.assertNotIn('tv_port',cfg.read_text())
                extra=root/game/'cfg/voltra-variant.cfg';self.assertIn('z_difficulty "Impossible"',extra.read_text())
                if app=='222840':self.assertIn('mp_gamemode "versus"',extra.read_text())
                else:self.assertNotIn('mp_gamemode',extra.read_text())
                self.assertIn('sv_allow_lobby_connect_only 0',extra.read_text());self.assertEqual(extra.stat().st_mode&0o777,0o600)

    def test_left4dead_mode_and_port_validation_before_configuration(self):
        for app,key,value in [('222840','GAMEMODE','realism'),('222860','GAMEMODE','coop;quit'),('222860','CUSTOM_GAMEMODE','bad;quit'),('222860','DIFFICULTY','Expert'),('222860','LOBBY_ONLY','yes'),('222840','SRCDS_CPORT','27015')]:
            with self.subTest(app=app,key=key),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=fixture(root,app)
                with self.assertRaises(ValueError):variant.launch(root,{**env,key:value})
                self.assertFalse((root/('left4dead' if app=='222840' else 'left4dead2')).exists())

    def test_left4dead_outgoing_port_does_not_require_fake_host_allocation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root,'222840')
            argv,_=variant.launch(root,{**env,'VOLTRA_ALLOCATED_PORTS':'27015','SRCDS_CPORT':'29001'})
            self.assertEqual(argv[argv.index('+clientport')+1],'29001')

    def test_left4dead_footer_retains_operator_bytes_permissions_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cfg=root/'left4dead/cfg/server.cfg';cfg.parent.mkdir(parents=True)
            original=b'// arbitrary operator bytes\xff\r\nhostname "operator"\r\n';cfg.write_bytes(original);os.chown(cfg,345,678);cfg.chmod(0o640)
            l4d.append_footer(root,'left4dead');metadata=cfg.stat()
            self.assertEqual(cfg.read_bytes(),original+l4d.FOOTER);self.assertEqual(metadata.st_mode&0o777,0o640)
            self.assertEqual((metadata.st_uid,metadata.st_gid),(345,678))
            l4d.append_footer(root,'left4dead');self.assertEqual(cfg.stat().st_mtime_ns,metadata.st_mtime_ns)
            backups=list((root/'.voltra/source/l4d-config-backups').glob('*.cfg'))
            self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_bytes(),original)
            self.assertEqual(backups[0].stat().st_mode&0o777,0o600)

    def test_left4dead_footer_rejects_escape_and_unknown_marked_edit(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as external:
            root=Path(directory);cfg=root/'left4dead/cfg/server.cfg';cfg.parent.mkdir(parents=True)
            cfg.write_bytes(b'operator');(root/'.voltra/source').mkdir(parents=True)
            (root/'.voltra/source/l4d-config-backups').symlink_to(external)
            with self.assertRaises(ValueError):l4d.append_footer(root,'left4dead')
            self.assertEqual(cfg.read_bytes(),b'operator');self.assertEqual(list(Path(external).iterdir()),[])
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cfg=root/'left4dead/cfg/server.cfg';cfg.parent.mkdir(parents=True)
            original=b'operator\n// BEGIN VOLTRA L4D MANAGED\nmodified footer';cfg.write_bytes(original)
            with self.assertRaises(ValueError):l4d.append_footer(root,'left4dead')
            self.assertEqual(cfg.read_bytes(),original)

    def test_left4dead_readiness_validates_native_fields_and_framing(self):
        packet=b'\xff\xff\xff\xffI\x07'+b"literal $ 'name'\0map_native\0left4dead\0L4D\0"+b'\xf4\x01\x00\x04\x00dl\x01\x00'
        self.assertTrue(l4d.info_matches(packet,"literal $ 'name'",'map_native',True))
        for data,name,map_name,password in [(packet[:-1],"literal $ 'name'",'map_native',True),(packet,'wrong','map_native',True),(packet,"literal $ 'name'",'wrong',True),(packet,"literal $ 'name'",'map_native',False),(b'bad',"literal $ 'name'",'map_native',True),(packet[:10],"literal $ 'name'",'map_native',True)]:
            self.assertFalse(l4d.info_matches(data,name,map_name,password))

    def test_left4dead_readiness_challenge_foreign_source_absence_and_cancellation(self):
        packet=b'\xff\xff\xff\xffI\x07name\0map\0left4dead\0L4D\0'+b'\xf4\x01\x00\x04\x00dl\x00\x00'
        connection=mock.MagicMock();connection.__enter__.return_value=connection
        connection.recvfrom.side_effect=[(b'\xff\xff\xff\xffA1234',('127.0.0.1',27015)),(packet,('127.0.0.1',27015))]
        emit=mock.Mock();cancel=threading.Event()
        with mock.patch.object(l4d.socket,'socket',return_value=connection):l4d.query_ready(27015,'name','map',False,cancel,timeout=1,emit=emit)
        emit.assert_called_once_with(l4d.READY,flush=True)
        self.assertEqual(connection.sendto.call_args_list[-1].args,(l4d.INFO+b'1234',('127.0.0.1',27015)))
        for response in [(packet,('127.0.0.2',27015)),(packet,('127.0.0.1',27016)),(b'\xff\xff\xff\xffAbad',('127.0.0.1',27015)),(b'bad',('127.0.0.1',27015))]:
            connection.recvfrom.side_effect=[response,socket.timeout()];emit.reset_mock()
            with mock.patch.object(l4d.socket,'socket',return_value=connection):l4d.query_ready(27015,'name','map',False,cancel,timeout=0.01,emit=emit)
            emit.assert_not_called()
        connection.recvfrom.side_effect=socket.timeout();emit.reset_mock()
        with mock.patch.object(l4d.socket,'socket',return_value=connection):l4d.query_ready(27015,'name','map',False,cancel,timeout=0.01,emit=emit)
        emit.assert_not_called();cancel.set()
        with mock.patch.object(l4d.socket,'socket',return_value=connection):l4d.query_ready(27015,'name','map',False,cancel,emit=emit)
        emit.assert_not_called()
        cancel.clear()
        def cancelled_reply(*args):cancel.set();return packet,('127.0.0.1',27015)
        connection.recvfrom.side_effect=cancelled_reply
        with mock.patch.object(l4d.socket,'socket',return_value=connection):l4d.query_ready(27015,'name','map',False,cancel,emit=emit)
        emit.assert_not_called()

    def test_left4dead_observer_cancelled_when_native_returns_or_fails(self):
        stopped=threading.Event()
        def observe(*args,**kwargs):args[-1].wait(1);stopped.set()
        for failure in (False,True):
            stopped.clear();native=mock.Mock(side_effect=ValueError('native failure')) if failure else mock.Mock(return_value=7)
            with mock.patch.object(l4d,'query_ready',side_effect=observe),mock.patch.object(l4d,'local_query_address',return_value='127.0.0.1'):
                if failure:
                    with self.assertRaises(ValueError):l4d.run_ready(native,Path('/game'),[],{},[],{'SERVER_PORT':'27015','SRCDS_MAP':'map'})
                else:self.assertEqual(l4d.run_ready(native,Path('/game'),[],{},[],{'SERVER_PORT':'27015','SRCDS_MAP':'map'}),7)
            self.assertTrue(stopped.is_set())

    def test_left4dead_query_target_requires_ordinary_local_bind(self):
        probe=mock.MagicMock();probe.__enter__.return_value=probe
        def bind(address):
            if address[0]=='192.0.2.99':raise OSError('Address not assigned locally')
        probe.bind.side_effect=bind
        with mock.patch.object(l4d.socket,'gethostname',return_value='os-container-name'),mock.patch.object(l4d.socket,'getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_DGRAM,0,'',('192.0.2.99',0)),(socket.AF_INET,socket.SOCK_DGRAM,0,'',('172.30.90.2',0))]) as lookup,mock.patch.object(l4d.socket,'socket',return_value=probe):
            self.assertEqual(l4d.local_query_address(),'172.30.90.2')
            self.assertEqual(lookup.call_args.args[0],'os-container-name');probe.sendto.assert_not_called()
        probe.bind.side_effect=OSError('No assigned address')
        with mock.patch.object(l4d.socket,'getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_DGRAM,0,'',('192.0.2.99',0))]),mock.patch.object(l4d.socket,'socket',return_value=probe):
            with self.assertRaises(ValueError):l4d.local_query_address()
            probe.sendto.assert_not_called()

    def test_left4dead_custom_installed_mutation_id_and_private_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root,'222860')
            variant.launch(root,{**env,'CUSTOM_GAMEMODE':'mutation12'})
            cfg=root/'left4dead2/cfg/voltra-variant.cfg';original=cfg.read_bytes()
            variant.launch(root,{**env,'GAMEMODE':'coop','DIFFICULTY':'Hard'})
            backups=list((root/'.voltra/source/variant-config-backups').glob('*.cfg'))
            self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_bytes(),original)
            self.assertEqual(backups[0].stat().st_mode&0o777,0o600)

    def test_l4d2_startup_mode_selector_preserves_l4d1_mode_contract(self):
        for app,game_map in [('222840','l4d_hospital01_apartment'),('222860','c1m1_hotel')]:
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=fixture(root,app)
                argv,_=variant.launch(root,{**env,'CUSTOM_GAMEMODE':'mutation12'})
                self.assertEqual(argv[-2:],['+map',game_map]);self.assertEqual(argv[argv.index('+mp_gamemode')+1],'mutation12')

    def test_l4d2_ordered_private_boot_rejects_wrong_map_old_boot_and_bad_order(self):
        mapline=b'Host_NewGame on map c1m1_hotel\n'
        footer=(l4d.CONFIG_READY+'\n').encode();vac=b'VAC secure mode disabled.\n'
        for data in [footer+mapline+vac,mapline+vac+footer,mapline+footer,b'Host_NewGame on map wrong\n'+footer+vac,
                     mapline+footer+vac+b'Host_NewGame on map wrong\n',footer+vac]:
            boot=l4d.PrivateBoot('c1m1_hotel');boot.feed(data)
            self.assertFalse(boot.initialized.is_set())
        boot=l4d.PrivateBoot('c1m1_hotel')
        for data in [mapline[:9],mapline[9:]+footer,vac]:boot.feed(data)
        self.assertTrue(boot.initialized.is_set())
        boot.feed(mapline);self.assertFalse(boot.initialized.is_set())

    def test_l4d2_footer_upgrade_keeps_operator_prefix_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cfg=root/'left4dead2/cfg/server.cfg';cfg.parent.mkdir(parents=True)
            prefix=b'operator\xff\r\n';cfg.write_bytes(prefix+l4d.FOOTER);cfg.chmod(0o640);os.chown(cfg,345,678)
            l4d.append_footer(root,'left4dead2',readiness_marker=True)
            self.assertEqual(cfg.read_bytes(),prefix+l4d.PRIVATE_FOOTER)
            self.assertEqual((cfg.stat().st_mode&0o777,cfg.stat().st_uid,cfg.stat().st_gid),(0o640,345,678))
            stamp=cfg.stat().st_mtime_ns;l4d.append_footer(root,'left4dead2',readiness_marker=True)
            self.assertEqual(cfg.stat().st_mtime_ns,stamp)

    def test_l4d2_private_readiness_requires_auth_when_configured_and_cancels(self):
        boot=l4d.PrivateBoot('map');boot.feed(b'Host_NewGame on map map\n'+(l4d.CONFIG_READY+'\n').encode()+b'VAC secure mode disabled.\n')
        settings={'SERVER_PORT':'27015','SRCDS_MAP':'map','SERVER_PASSWORD':'join-secret','RCON_PASSWORD':'rcon-secret'}
        cancel=threading.Event();emit=mock.Mock()
        with mock.patch.object(l4d,'rcon_verified',return_value=False) as verify:
            l4d.private_ready(boot,settings,cancel,host='127.0.0.1',timeout=0.01,emit=emit)
            verify.assert_called_once();emit.assert_not_called()
        with mock.patch.object(l4d,'rcon_verified',return_value=True):
            l4d.private_ready(boot,settings,cancel,host='127.0.0.1',timeout=1,emit=emit)
        emit.assert_called_once_with(l4d.READY,flush=True)
        emit.reset_mock();cancel.set()
        l4d.private_ready(boot,settings,cancel,host='127.0.0.1',timeout=1,emit=emit);emit.assert_not_called()

    def test_l4d2_rcon_checks_auth_identity_map_capacity_and_private_value(self):
        status='hostname: literal name\nmap : c1m1_hotel\nplayers : 0 humans, 0 bots (8 max)\n'
        def replies(text=status,password='join-secret',auth=4101):
            return [(auth,2,''),(4200,0,text+'"sv_password" = "'+password+'"'),(4201,0,'')]
        for response,expected in [(replies(),True),(replies(status.replace('literal name','wrong')),False),
                                  (replies(status.replace('c1m1_hotel','wrong')),False),(replies(status.replace('8 max','4 max')),False),
                                  (replies(password='wrong'),False),([(-1,2,'')],False)]:
            with mock.patch.object(l4d.socket,'create_connection'),mock.patch.object(l4d,'rcon_read',side_effect=response):
                self.assertEqual(l4d.rcon_verified('127.0.0.1',27015,'rcon-secret','literal name','c1m1_hotel','join-secret','versus',threading.Event()),expected)

    def test_l4d2_rcon_rejects_malformed_frames_and_exit_before_vac(self):
        connection=mock.Mock();connection.recv.return_value=b'\xff\xff\xff\x7f'
        with self.assertRaises(ValueError):l4d.rcon_read(connection,threading.Event())
        boot=l4d.PrivateBoot('map');boot.feed(b'Host_NewGame on map map\n'+(l4d.CONFIG_READY+'\n').encode())
        emit=mock.Mock();cancel=threading.Event();cancel.set()
        l4d.private_ready(boot,{'SERVER_PORT':'27015','SRCDS_MAP':'map','SERVER_PASSWORD':'private'},cancel,host='127.0.0.1',emit=emit)
        emit.assert_not_called()

    def test_l4d2_private_native_failure_restores_output_and_cancels_observer(self):
        stopped=threading.Event();original=sys.stdout
        def observe(boot,settings,cancel,**options):
            cancel.wait(1);stopped.set()
        with mock.patch.object(l4d,'private_ready',side_effect=observe),mock.patch.object(l4d,'local_query_address',return_value='127.0.0.1'):
            with self.assertRaisesRegex(ValueError,'native failure'):
                l4d.run_ready(mock.Mock(side_effect=ValueError('native failure')),Path('/game'),[],{},[],
                              {'SRCDS_APPID':'222860','SERVER_PORT':'27015','SRCDS_MAP':'map','SERVER_PASSWORD':'join'})
        self.assertIs(sys.stdout,original);self.assertTrue(stopped.is_set())

    def test_l4d2_private_without_rcon_is_initialization_only(self):
        boot=l4d.PrivateBoot('map');emit=mock.Mock();cancel=threading.Event()
        settings={'SERVER_PORT':'27015','SRCDS_MAP':'map','SERVER_PASSWORD':'join'}
        with mock.patch.object(l4d,'rcon_verified') as verify:
            l4d.private_ready(boot,settings,cancel,host='127.0.0.1',timeout=0.01,emit=emit)
            emit.assert_not_called()
            boot.feed(b'Host_NewGame on map map\n'+(l4d.CONFIG_READY+'\n').encode()+b'VAC secure mode enabled.\n')
            l4d.private_ready(boot,settings,cancel,host='127.0.0.1',timeout=1,emit=emit)
            emit.assert_called_once_with(l4d.READY,flush=True);verify.assert_not_called()

    def test_iosoccer_original_map_slots_tick_fps_and_rcon_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root,'673990')
            argv,_=variant.launch(root,{**env,'MAP':'custom_football','SLOTS':'18','TICKRATE':'120','MAX_FPS':'300','RCON':'private native admin'})
            self.assertEqual(argv[-1],'custom_football');self.assertEqual(argv[argv.index('-maxplayers')+1],'18')
            self.assertEqual(argv[argv.index('-tickrate')+1],'120');self.assertEqual(argv[argv.index('+fps_max')+1],'300')
            self.assertIn('-condebug',argv);self.assertNotIn('private native admin',argv)
            cfg=root/'iosoccer/cfg/voltra-managed.cfg';self.assertIn('rcon_password "private native admin"',cfg.read_text());self.assertEqual(cfg.stat().st_mode&0o777,0o600)
            self.assertIn('fps_max 300',(root/'iosoccer/cfg/voltra-variant.cfg').read_text())

    def test_new_native_variant_defaults_keep_original_games_and_maps(self):
        for app,game,map_name,maximum in [('346680','bms','dm_crossfire','32'),('317670','nmrih','nms_northway','8')]:
            with self.subTest(app=app),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=fixture(root,app);argv,_=variant.launch(root,env)
                self.assertEqual(argv[argv.index('-game')+1],game);self.assertEqual(argv[-1],map_name)
                self.assertEqual(argv[argv.index('-maxplayers')+1],maximum)

    def test_steam_validation_preserves_configuration_bytes_mode_uid_and_gid(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            names=['fof/cfg/server.cfg','fof/cfg/nested/values.txt','fof/banned_user.cfg','fof/mapcycle.txt','fof/motd.txt','fof/gameinfo.txt','fof/addons/sourcemod/configs/admins_simple.ini']
            before={}
            for i,name in enumerate(names):
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True)
                path.write_bytes(('operator\r\n'+name+'\r\n').encode())
                path.chmod(0o640 if i%2 else 0o600)
                os.chown(path,12001+i,13001+i)
                info=path.stat();before[name]=(path.read_bytes(),info.st_mode&0o7777,info.st_uid,info.st_gid)
            def steam_replace(*args,**kwargs):
                for name in names:
                    path=root/name;path.unlink();path.write_bytes(b'publisher replacement');path.chmod(0o666)
                return {'buildid':42}
            with mock.patch.object(installer,'steam_update',side_effect=steam_replace):
                self.assertEqual(installer.update(root,295230),{'buildid':42})
            for name,expected in before.items():
                path=root/name;info=path.stat()
                self.assertEqual((path.read_bytes(),info.st_mode&0o7777,info.st_uid,info.st_gid),expected)
            backups=list((root/'.voltra/source/steam-preservation').rglob('*'))
            self.assertTrue(backups)
            for backup in backups:
                if backup.is_file():self.assertEqual(backup.stat().st_mode&0o777,0o600)

    def test_steam_failure_restores_operator_cfg_in_finally(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cfg=root/'fof/cfg/server.cfg';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'private operator cfg\r\n');cfg.chmod(0o640)
            os.chown(cfg,12003,13003)
            def failed_update(*args,**kwargs):
                cfg.unlink();cfg.write_bytes(b'partial publisher replacement')
                raise RuntimeError('simulated publisher failure')
            with mock.patch.object(installer,'steam_update',side_effect=failed_update):
                with self.assertRaisesRegex(RuntimeError,'simulated publisher failure'):installer.update(root,295230)
            self.assertEqual(cfg.read_bytes(),b'private operator cfg\r\n')
            self.assertEqual((cfg.stat().st_mode&0o777,cfg.stat().st_uid,cfg.stat().st_gid),(0o640,12003,13003))

    def test_steam_preservation_restores_internal_config_symlink_and_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cfg=root/'fof/cfg/server.cfg';cfg.parent.mkdir(parents=True)
            target=root/'operator/server.cfg';target.parent.mkdir();target.write_bytes(b'linked operator cfg');target.chmod(0o640);os.chown(target,12004,13004)
            cfg.symlink_to('../../operator/server.cfg');os.lchown(cfg,12004,13004)
            def replace_link(*args,**kwargs):
                cfg.unlink();cfg.write_bytes(b'publisher cfg');target.write_bytes(b'changed target')
            with mock.patch.object(installer,'steam_update',side_effect=replace_link):installer.update(root,295230)
            self.assertTrue(cfg.is_symlink());self.assertEqual(os.readlink(cfg),'../../operator/server.cfg')
            self.assertEqual(target.read_bytes(),b'linked operator cfg')
            self.assertEqual((target.stat().st_mode&0o777,target.stat().st_uid,target.stat().st_gid),(0o640,12004,13004))
            self.assertEqual((cfg.lstat().st_uid,cfg.lstat().st_gid),(12004,13004))

    def test_steam_config_escape_rejected_before_publisher_mutation(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as external:
            root=Path(directory);cfg=root/'fof/cfg/server.cfg';cfg.parent.mkdir(parents=True)
            target=Path(external)/'server.cfg';target.write_bytes(b'external');cfg.symlink_to(target)
            with mock.patch.object(installer,'steam_update') as updater:
                with self.assertRaises(ValueError):installer.update(root,295230)
                updater.assert_not_called()
            self.assertEqual(target.read_bytes(),b'external')

    def test_initial_publisher_config_is_retained_and_typed_options_forwarded(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env={'AUTO_UPDATE':'0'}
            def initial(*args,**kwargs):
                self.assertEqual(args,(root,295230));self.assertEqual(kwargs,{'env':env,'validate':False,'required':('srcds_run',),'platform':'linux'})
                cfg=root/'fof/cfg/server.cfg';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'publisher initial config')
            with mock.patch.object(installer,'steam_update',side_effect=initial):installer.update(root,295230,env=env,validate=False,required=('srcds_run',))
            self.assertEqual((root/'fof/cfg/server.cfg').read_bytes(),b'publisher initial config')
            self.assertFalse((root/'.voltra/source/steam-preservation').exists())

    def test_half_life_original_aliases_and_tickrate_reach_shared_launcher(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root,'232370')
            argv,_=variant.launch(root,{**env,'SERVER_NAME':'Legacy $name','MAP_NAME':'dm_custom','TICK_RATE':'100'})
            self.assertEqual(argv[argv.index('-game')+1],'hl2mp')
            self.assertEqual(argv[argv.index('-tickrate')+1],'100')
            self.assertEqual(argv[argv.index('-maxplayers')+1],'20')
            self.assertEqual(argv[-1],'dm_custom')
            self.assertIn('hostname "Legacy $name"',(root/'hl2mp/cfg/voltra-managed.cfg').read_text())

    def test_variant_validation_rejects_before_mutating_configuration(self):
        for app,key,value in [('232370','TICK_RATE','0'),('232370','MAP_NAME','../bad'),('232370','SERVER_NAME','bad;quit'),('295230','MAX_PLAYERS','33')]:
            with self.subTest(app=app,key=key),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=fixture(root,app)
                with self.assertRaises(ValueError):variant.launch(root,{**env,key:value})
                self.assertFalse((root/('hl2mp' if app=='232370' else 'fof')).exists())

    def test_fistful_uses_shared_native_port_and_config_handling(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root,'295230')
            argv,_=variant.launch(root,env)
            self.assertEqual(argv[argv.index('-game')+1],'fof')
            self.assertEqual(argv[-1],'fof_revenge')
            self.assertTrue((root/'fof/cfg/voltra-managed.cfg').exists())

    def test_managed_layer_preserves_operator_configuration_and_maps(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            cfg=root/'cstrike/cfg';cfg.mkdir(parents=True)
            original=b'// operator\r\nhostname old\r\nmp_timelimit 23\r\n'
            (cfg/'server.cfg').write_bytes(original)
            maps=root/'cstrike/maps';maps.mkdir();(maps/'custom.bsp').write_bytes(b'custom map')
            argv,_=runtime.configure(root,{**env,'HOSTNAME':"LAN $literal 'apostrophe'",'SERVER_PASSWORD':'secret pass'})
            self.assertEqual((cfg/'server.cfg').read_bytes(),original)
            self.assertEqual((maps/'custom.bsp').read_bytes(),b'custom map')
            self.assertEqual((cfg/'voltra-server.cfg').read_text(),'exec server.cfg\nexec voltra-managed.cfg\n')
            self.assertIn('hostname "LAN $literal \'apostrophe\'"',(cfg/'voltra-managed.cfg').read_text())
            self.assertNotIn('secret pass',argv)
            self.assertEqual((cfg/'voltra-managed.cfg').stat().st_mode&0o777,0o600)
            self.assertEqual(argv[argv.index('+clientport')+1],'27016')
            self.assertEqual(argv[argv.index('+tv_port')+1],'27017')
            self.assertEqual(argv[argv.index('+sv_lan')+1],'1')
            self.assertIn('-norestart',argv)

    def test_both_games_use_fixed_native_directories(self):
        for app,game in [('232330','cstrike'),('232250','tf')]:
            with self.subTest(app=app),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=fixture(root,app)
                argv,environment=runtime.configure(root,env)
                self.assertEqual(argv[argv.index('-game')+1],game)
                self.assertTrue((root/game/'cfg/voltra-managed.cfg').exists())
                self.assertNotIn('PYTHONHOME',environment)

    def test_counterstrike_public_requires_token_and_stores_it_privately(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            with self.assertRaises(ValueError):runtime.configure(root,{**env,'PUBLIC_SERVER':'1'})
            token='A'*32
            argv,_=runtime.configure(root,{**env,'PUBLIC_SERVER':'1','STEAM_TOKEN':token})
            self.assertNotIn(token,argv)
            cfg=root/'cstrike/cfg/voltra-login.cfg'
            self.assertIn(token,cfg.read_text());self.assertEqual(cfg.stat().st_mode&0o777,0o600)

    def test_invalid_settings_reject_before_writing_files(self):
        cases=[('HOSTNAME','bad";quit'),('SERVER_PASSWORD','bad\nquit'),('RCON_PASSWORD','bad\\escape'),
               ('SRCDS_MAP','../map'),('SRCDS_MAP','map;quit'),('SRCDS_GAME','tf'),('SRCDS_APPID','999'),
               ('VOLTRA_ALLOCATED_PORTS','27015,27016'),('SRCDS_CPORT','27015'),('SRCDS_STV','27016'),
               ('SRCDS_CPORT','29999'),('SERVER_PORT','29999'),('TV_ENABLE','yes'),('PUBLIC_SERVER','yes'),
               ('MAX_PLAYERS','65'),('STEAM_TOKEN','+quit')]
        for key,value in cases:
            with self.subTest(key=key,value=value),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=fixture(root)
                with self.assertRaises(ValueError):runtime.configure(root,{**env,key:value})
                self.assertFalse((root/'cstrike').exists())

    def test_explicit_port_choices_and_custom_map_subdirectories(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root,'232250')
            argv,_=runtime.configure(root,{**env,'SRCDS_CPORT':'27017','SRCDS_STV':'27016','SRCDS_MAP':'workshop/custom_map','MAX_PLAYERS':'100'})
            self.assertEqual(argv[argv.index('+clientport')+1],'27017')
            self.assertEqual(argv[-1],'workshop/custom_map')
            self.assertEqual(argv[argv.index('-maxplayers')+1],'100')

    def test_changed_form_settings_back_up_previous_private_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            runtime.configure(root,env)
            cfg=root/'cstrike/cfg/voltra-managed.cfg';before=cfg.read_bytes();mtime=cfg.stat().st_mtime_ns
            runtime.configure(root,env);self.assertEqual(cfg.stat().st_mtime_ns,mtime)
            runtime.configure(root,{**env,'HOSTNAME':'changed'})
            backups=list((root/'.voltra/source/config-backups').glob('*.cfg'))
            self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_bytes(),before)
            self.assertEqual(backups[0].stat().st_mode&0o777,0o600)

    def test_symlink_config_escape_does_not_mutate_external_directory(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as external:
            root=Path(directory);env=fixture(root);(root/'cstrike').mkdir();(root/'cstrike/cfg').symlink_to(external)
            with self.assertRaises(ValueError):runtime.configure(root,env)
            self.assertEqual(list(Path(external).iterdir()),[])

    def test_nested_backup_escape_rejects_before_config_mutation(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as external:
            root=Path(directory);env=fixture(root);runtime.configure(root,env)
            cfg=root/'cstrike/cfg/voltra-managed.cfg';before=cfg.read_bytes()
            (root/'.voltra/source').mkdir(parents=True,exist_ok=True)
            (root/'.voltra/source/config-backups').symlink_to(external,target_is_directory=True)
            with self.assertRaises(ValueError):runtime.configure(root,{**env,'HOSTNAME':'changed'})
            self.assertEqual(cfg.read_bytes(),before);self.assertEqual(list(Path(external).iterdir()),[])

    def test_nested_backup_internal_symlink_retains_private_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root);runtime.configure(root,env)
            cfg=root/'cstrike/cfg/voltra-managed.cfg';before=cfg.read_bytes()
            destination=root/'operator-backups';destination.mkdir()
            (root/'.voltra/source').mkdir(parents=True,exist_ok=True)
            (root/'.voltra/source/config-backups').symlink_to(destination,target_is_directory=True)
            runtime.configure(root,{**env,'HOSTNAME':'changed'})
            backups=list(destination.glob('*.cfg'));self.assertEqual(len(backups),1)
            self.assertEqual(backups[0].read_bytes(),before);self.assertEqual(backups[0].stat().st_mode&0o777,0o600)

    def test_launcher_supplies_controlling_terminal_and_native_quit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            for name,source in [('steam_template.py',STEAM_SOURCE),('source_install.py',INSTALL_SOURCE),('native_console.py',CONSOLE_SOURCE),('source_runtime.py',RUNTIME_SOURCE)]:
                (root/name).write_text(source)
            launcher=root/'srcds_run'
            launcher.write_text('#!/bin/sh\ntest -t 0 && test -t 1 && test -t 2 || exit 7\necho NATIVE_TTY_READY\nwhile IFS= read -r line; do\nif [ "$line" = quit ]; then echo NATIVE_CLOSED; exit 0; fi\ndone\n')
            launcher.chmod(0o755)
            child=subprocess.Popen([sys.executable,str(root/'source_runtime.py')],cwd=root,env={**os.environ,**env,'AUTO_UPDATE':'0'},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            try:
                self.assertEqual(child.stdout.readline().strip(),b'NATIVE_TTY_READY')
                child.stdin.write(b'quit\n');child.stdin.flush()
                self.assertEqual(child.stdout.readline().strip(),b'NATIVE_CLOSED')
                self.assertEqual(child.wait(timeout=10),0)
            finally:
                if child.poll() is None:child.kill();child.wait()
                child.stdin.close();child.stdout.close()

    def test_iosoccer_native_console_redacts_original_rcon_alias(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root,'673990')
            for name,source in [('steam_template.py',STEAM_SOURCE),('source_install.py',INSTALL_SOURCE),('native_console.py',CONSOLE_SOURCE),('source_runtime.py',RUNTIME_SOURCE),('source_variant_runtime.py',VARIANT_SOURCE)]:
                (root/name).write_text(source)
            launcher=root/'srcds_run_64';launcher.write_text('#!/bin/sh\necho "$RCON"\nwhile IFS= read -r line; do if [ "$line" = quit ]; then exit 0; fi; done\n');launcher.chmod(0o755)
            child=subprocess.Popen([sys.executable,str(root/'source_variant_runtime.py')],cwd=root,env={**os.environ,**env,'AUTO_UPDATE':'0','RCON':'alias-credential-517077'},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            try:
                self.assertEqual(child.stdout.readline().strip(),b'[redacted]')
                child.stdin.write(b'quit\n');child.stdin.flush();self.assertEqual(child.wait(timeout=10),0)
            finally:
                if child.poll() is None:child.kill();child.wait()
                child.stdin.close();child.stdout.close()


unittest.main()
