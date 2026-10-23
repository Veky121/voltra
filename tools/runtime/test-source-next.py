import os
import io
import json
import tarfile
import zipfile
import threading
from pathlib import Path
import sys
import tempfile
import types
import struct
import hashlib
import unittest
from unittest import mock
for name,source in SOURCES:
    module=types.ModuleType(name);exec(source,module.__dict__);sys.modules[name]=module
runtime=sys.modules['source_next_runtime'];installer=sys.modules['source_install']
modules=sys.modules['source_next_install']

class AdditionalSourceTests(unittest.TestCase):
    def fixture(self,root,**extra):
        (root/'srcds_run').write_bytes(b'publisher')
        return {'SRCDS_APPID':'4020','SERVER_PORT':'27015','VOLTRA_ALLOCATED_PORTS':'27015,27016,27017',**extra}

    def test_gmod_original_controls_and_token_private_cfg(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=self.fixture(root,GAMEMODE='sandbox',WORKSHOP_ID='123456',TICKRATE='66',LUA_REFRESH='0',STEAM_TOKEN='abc123')
            argv,_=runtime.launch(root,env)
            for key,value in [('+gamemode','sandbox'),('+host_workshop_collection','123456'),('-tickrate','66'),('-maxplayers','24')]:self.assertEqual(argv[argv.index(key)+1],value)
            self.assertIn('-disableluarefresh',argv);self.assertNotIn('abc123',argv)
            cfg=root/'garrysmod/cfg/voltra-login.cfg';self.assertIn('abc123',cfg.read_text());self.assertEqual(cfg.stat().st_mode&0o777,0o600)
            argv,_=runtime.launch(root,{**env,'WORKSHOP_ID':'','LUA_REFRESH':'1'})
            self.assertNotIn('-disableluarefresh',argv);self.assertNotIn('+host_workshop_collection',argv)

    def test_gmod_invalid_native_controls_fail_before_mutation(self):
        for key,value in [('GAMEMODE','sandbox;quit'),('GAMEMODE','../bad'),('WORKSHOP_ID','1 +quit'),('WORKSHOP_ID','0'),('TICKRATE','101'),('LUA_REFRESH','2'),('PUBLIC_SERVER','1')]:
            with self.subTest(key=key,value=value),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);env=self.fixture(root,**{key:value})
                with self.assertRaises(ValueError):runtime.launch(root,env)
                self.assertFalse((root/'garrysmod').exists())

    def test_open_fortress_original_player_alias(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);argv,_=runtime.launch(root,self.fixture(root,SRCDS_APPID='244310',MAXPLAYERS='17'))
            self.assertEqual(argv[argv.index('-maxplayers')+1],'17');self.assertEqual(argv[-2:],['+map','dm_2fort'])

    def test_new_preservation_mappings_restore_native_cfg_on_publisher_failure(self):
        for app,game in [(4020,'garrysmod'),(293030,'contagion'),(244310,'open_fortress')]:
            with self.subTest(app=app),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);cfg=root/game/'cfg/server.cfg';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'operator\xff\r\n');cfg.chmod(0o640);os.chown(cfg,345,678)
                def fail(*args,**options):cfg.unlink();cfg.write_bytes(b'publisher');raise RuntimeError('publisher failure')
                with mock.patch.object(installer,'steam_update',side_effect=fail):
                    with self.assertRaises(RuntimeError):installer.update(root,app)
                self.assertEqual(cfg.read_bytes(),b'operator\xff\r\n');self.assertEqual((cfg.stat().st_mode&0o777,cfg.stat().st_uid,cfg.stat().st_gid),(0o640,345,678))

    def test_sourcecoop_original_aliases_controls_and_zero_password(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);argv,_=runtime.launch(root,self.fixture(root,SRCDS_APPID='346680',VOLTRA_SOURCE_RECIPE='sourcecoop',SERVER_NAME='literal name',STARTING_MAP='bm_c1a0a',SERVER_PASSWORD='0',FRIENDLY_FIRE='1',MOD_FORCETOUCHDATA='0'))
            self.assertEqual(argv[-2:],['+map','bm_c1a0a'])
            cfg=root/'bms/cfg/voltra-managed.cfg';self.assertIn('hostname "literal name"',cfg.read_text());self.assertIn('sv_password ""',cfg.read_text())
            self.assertIn('mp_friendlyfire 1',(root/'bms/cfg/voltra-coop.cfg').read_text())
            wrapper=(root/'bms/cfg/voltra-server.cfg').read_text();self.assertLess(wrapper.index('exec voltra-coop-defaults.cfg'),wrapper.index('exec server.cfg'))

    def test_sourcecoop_pinned_defaults_legacy_and_typed_custom_builds(self):
        selected=modules.selection({});self.assertTrue(all(x.get('sha256') for x in selected))
        legacy=modules.selection({'MMS_BUILD':'1148','SM_BUILD':'6960'});self.assertIn('/1.11/',legacy[1]['url']);self.assertTrue(legacy[1].get('sha256'))
        custom=modules.selection({'MMS_BUILD':'1154','SM_BUILD':'7162'});self.assertIn('git1154-',custom[0]['url']);self.assertNotIn('sha256',custom[0]);self.assertIn('/1.12/',custom[1]['url'])
        for env in [{'MMS_BUILD':'1;quit'},{'VERSION':'../../evil'},{'MATCH':'bms;quit'},{'SM_SERIES':'../other'},{'MMS_SHA256':'bad'}]:
            with self.assertRaises(ValueError):modules.selection(env)

    def test_sourcecoop_extraction_rejects_traversal_symlinks_duplicates_and_wrong_root(self):
        for names in [['../outside'],['addons/file','addons/file'],['unknown/file']]:
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);archive=root/'asset.zip'
                with zipfile.ZipFile(archive,'w') as output:
                    for name in names:output.writestr(name,b'fixture')
                with self.assertRaises(ValueError):modules.extract(archive,root/'stage')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);archive=root/'asset.tar'
            with tarfile.open(archive,'w') as output:
                member=tarfile.TarInfo('addons/link');member.type=tarfile.SYMTYPE;member.linkname='../../outside';output.addfile(member)
            with self.assertRaises(ValueError):modules.extract(archive,root/'stage')

    def test_sourcecoop_reinstall_never_adopts_operator_plugin_as_managed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cfg=root/'bms/cfg/server.cfg';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'operator\xff');cfg.chmod(0o640);os.chown(cfg,345,678)
            plugin=root/'bms/addons/sourcemod/plugins/srccoop.smx';plugin.parent.mkdir(parents=True);plugin.write_bytes(b'operator custom plugin')
            def extract(archive,stage):
                for name,data in [('addons/metamod.vdf',b'meta'),('addons/sourcemod/plugins/srccoop.smx',b'new plugin'),('cfg/server.cfg',b'new config')]:
                    path=stage/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
            def publisher(*args,**options):cfg.unlink();cfg.write_bytes(b'publisher config')
            with mock.patch.object(modules,'download',side_effect=lambda record,path:record),mock.patch.object(modules,'extract',side_effect=extract),mock.patch.object(installer,'steam_update',side_effect=publisher):
                modules.install(root,{});modules.install(root,{})
            self.assertEqual(plugin.read_bytes(),b'operator custom plugin');self.assertEqual(cfg.read_bytes(),b'operator\xff')
            self.assertEqual((cfg.stat().st_mode&0o777,cfg.stat().st_uid,cfg.stat().st_gid),(0o640,345,678))
            receipt=json.loads((root/'.voltra/source-next/sourcecoop.json').read_text());self.assertNotIn('addons/sourcemod/plugins/srccoop.smx',receipt['files'])

    def test_sourcecoop_rejects_external_install_target_before_overwrite(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as external:
            root=Path(directory);(root/'bms').mkdir();(root/'bms/addons').symlink_to(external)
            def extract(archive,stage):
                path=stage/'addons/metamod.vdf';path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture')
            with mock.patch.object(modules,'download',side_effect=lambda record,path:record),mock.patch.object(modules,'extract',side_effect=extract),mock.patch.object(modules,'update'):
                with self.assertRaises(ValueError):modules.install(root,{})
            self.assertEqual(list(Path(external).iterdir()),[])

    def test_generic_source_map_query_is_cancelled_on_native_failure(self):
        stopped=threading.Event()
        def observer(port,name,game_map,password,cancel,**options):cancel.wait(1);stopped.set()
        with mock.patch.object(runtime,'query_ready',side_effect=observer),mock.patch.object(runtime,'local_query_address',return_value='127.0.0.1'),mock.patch.object(runtime,'run',side_effect=ValueError('native failure')):
            with self.assertRaises(ValueError):runtime.run_ready(Path('/game'),[],{},[],{'SRCDS_APPID':'4020','SERVER_PORT':'27015'})
        self.assertTrue(stopped.is_set())

    def test_contagion_only_windows_platform_preserves_native_cfg(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cfg=root/'contagion/cfg/server.cfg';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'operator\xff');cfg.chmod(0o640);os.chown(cfg,345,678)
            def publisher(*args,**options):
                self.assertEqual(options['platform'],'windows');self.assertEqual(options['env']['WINDOWS_INSTALL'],'1');cfg.unlink();cfg.write_bytes(b'publisher Windows config')
            with mock.patch.object(installer,'steam_update',side_effect=publisher):installer.update(root,293030,env={'WINDOWS_INSTALL':'1'},platform='windows')
            self.assertEqual(cfg.read_bytes(),b'operator\xff');self.assertEqual((cfg.stat().st_mode&0o777,cfg.stat().st_uid,cfg.stat().st_gid),(0o640,345,678))
        for app,platform in [(4020,'windows'),(244310,'windows'),(293030,'macos'),(293030,'Linux')]:
            with mock.patch.object(installer,'steam_update') as publisher:
                with self.assertRaises(ValueError):installer.update(Path('/unused'),app,platform=platform)
                publisher.assert_not_called()

    def test_contagion_fixed_launcher_allowlist_rejects_paths(self):
        base=sys.modules['source_runtime'];base.GAMES['293030']=('contagion','ce_barlowe',32)
        for launcher in ('contagion_dedicated','contagionds.exe'):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);(root/launcher).write_bytes(b'publisher executable')
                argv,_=base.configure(root,{'SRCDS_APPID':'293030','SERVER_PORT':'27015','VOLTRA_ALLOCATED_PORTS':'27015,27016,27017'},launcher=launcher)
                self.assertEqual(argv[0],str(root/launcher))
        for launcher in ('../contagion_dedicated','/tmp/other','contagionds.exe;quit'):
            with self.assertRaises(ValueError):base.configure(Path('/unused'),{},launcher=launcher)

    def test_coop_readiness_requires_genuine_current_plugin_scan(self):
        for invalid in (b'',b'[SRCCOOP] Scanned invalid maps for voting in 0.1 seconds.\n',b'[SRCCOOP] Scanned 0 maps for voting in 0.1 seconds.\n',b'echo [SRCCOOP] Scanned 77 maps for voting in 0.1 seconds.\n',b'[SRCCOOP] Scanned 77 maps for voting\n'):
            boot=runtime.CoopBoot();boot.feed(invalid);self.assertFalse(boot.initialized.is_set())
        boot=runtime.CoopBoot();boot.feed(b'[SRCCOOP] Scanned 77 maps for ');self.assertFalse(boot.initialized.is_set());boot.feed(b'voting in 0.009 seconds.\r\n');self.assertTrue(boot.initialized.is_set())
        self.assertFalse(runtime.CoopBoot().initialized.is_set())
        boot=runtime.CoopBoot();boot.feed(b'x'*20000);self.assertEqual(len(boot.pending),8192)

    def test_coop_query_without_plugin_marker_cancels_without_readiness(self):
        settings={'SRCDS_APPID':'346680','SERVER_PORT':'27015','SERVER_NAME':'test','STARTING_MAP':'bm_c0a0a'}
        def query(*args,**kwargs):kwargs['emit']('query-ready')
        with mock.patch.object(runtime,'query_ready',side_effect=query),mock.patch.object(runtime,'local_query_address',return_value='127.0.0.1'),mock.patch('builtins.print') as printed:
            self.assertEqual(runtime.run_ready(Path('/unused'),[],{},[],settings,native_runner=lambda *a,**k:250),250)
            printed.assert_not_called()

    def test_contagion_native_and_windows_original_controls(self):
        for windows,binary in [('0','contagion_dedicated'),('1','contagionds.exe')]:
            with tempfile.TemporaryDirectory() as directory,mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/wine'):
                root=Path(directory);env=self.fixture(root,SRCDS_APPID='293030',WINDOWS_INSTALL=windows,SRV_MAP='ce_barlowe',SRV_MAXPLAYERS='13',SRV_CONFIG='operator/custom.cfg')
                (root/binary).write_bytes(b'executable');argv,_=runtime.launch(root,env)
                self.assertEqual(argv[0],'/usr/bin/wine' if windows=='1' else str(root/binary))
                self.assertEqual(argv[argv.index('-maxplayers')+1],'13');self.assertEqual(argv[-2:],['+map','ce_barlowe'])
                self.assertEqual((root/'contagion/cfg/voltra-server.cfg').read_text(),'exec "operator/custom.cfg"\nexec voltra-managed.cfg\necho VOLTRA_CONTAGION_CONFIG_APPLIED\n')
        for key,value in [('SRV_CONFIG','../secret.cfg'),('SRV_CONFIG','voltra-managed.cfg'),('WINEARCH','anything'),('WINETRICKS_RUN','corefonts +quit'),('WINEDEBUG','-all;quit')]:
            with tempfile.TemporaryDirectory() as directory,mock.patch.object(runtime.shutil,'which',return_value='/usr/bin/wine'):
                root=Path(directory);env=self.fixture(root,SRCDS_APPID='293030',WINDOWS_INSTALL='1',**{key:value});(root/'contagionds.exe').write_bytes(b'executable')
                with self.assertRaises(ValueError):runtime.launch(root,env)
                self.assertFalse((root/'contagion').exists())

    def test_contagion_ordered_boot_rejects_old_wrong_and_out_of_order(self):
        lines=[b'Host_NewGame on map ce_barlowe\n',b'VOLTRA_CONTAGION_CONFIG_APPLIED\n',b'VAC secure mode disabled.\n']
        for candidate in (lines[1]+lines[0]+lines[2],lines[0]+lines[2],b''.join(lines).replace(b'ce_barlowe',b'wrong'),b'VOLTRA_CONTAGION_CONFIG_APPLIED\nVAC secure mode disabled.\n'):
            boot=runtime.ContagionBoot('ce_barlowe');boot.feed(candidate);self.assertFalse(boot.initialized.is_set())
        boot=runtime.ContagionBoot('ce_barlowe');boot.feed(b''.join(lines));self.assertTrue(boot.initialized.is_set());boot.feed(b'Host_NewGame on map wrong\n');self.assertFalse(boot.initialized.is_set())
        self.assertFalse(runtime.ContagionBoot('ce_barlowe').initialized.is_set())
        boot.feed(b'x'*20000);self.assertEqual(len(boot.pending),8192)

    def test_contagion_authenticated_settings_match_and_no_secret_output(self):
        settings={'SERVER_PORT':'27015','RCON_PASSWORD':'rcon-secret','HOSTNAME':'literal name','SRV_MAP':'ce_barlowe','SRV_MAXPLAYERS':'8','SERVER_PASSWORD':'join-secret'}
        status='hostname: literal name\nmap : ce_barlowe\nplayers : 0 humans (8 max)\n"sv_password" = "join-secret"\n'
        wine=sys.modules['source_wine_runtime']
        with mock.patch.object(wine,'command',return_value=status),mock.patch('builtins.print')as printed:self.assertTrue(runtime.contagion_verified('127.0.0.1',settings,threading.Event()));printed.assert_not_called()
        for bad in (status.replace('literal name','wrong'),status.replace('ce_barlowe','wrong'),status.replace('8 max','9 max'),status.replace('join-secret','wrong'),status.replace('"sv_password"','"other"')):
            with mock.patch.object(wine,'command',return_value=bad):self.assertFalse(runtime.contagion_verified('127.0.0.1',settings,threading.Event()))

    def test_wine_log_rotation_retains_previous_bytes_and_rejects_links(self):
        wine=sys.modules['source_wine_runtime']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);log=root/'contagion/console.log';log.parent.mkdir();log.write_bytes(b'old native initialized\n')
            wine.reset_log(root,log);self.assertEqual(log.read_bytes(),b'');self.assertEqual(log.stat().st_mode&0o777,0o600)
            backups=list((root/'.voltra/source-next/console-backups').glob('*.log'));self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_bytes(),b'old native initialized\n');self.assertEqual(backups[0].stat().st_mode&0o777,0o600)
            log.unlink();other=root/'operator';other.write_bytes(b'keep');log.symlink_to(other)
            with self.assertRaises(ValueError):wine.reset_log(root,log)
            self.assertEqual(other.read_bytes(),b'keep')

    def test_contagion_no_init_cancels_without_marker(self):
        settings={'SRCDS_APPID':'293030','SERVER_PORT':'27015','HOSTNAME':'test','SRV_MAP':'ce_barlowe'}
        with mock.patch.object(runtime,'local_query_address',return_value='127.0.0.1'),mock.patch('builtins.print')as printed:
            self.assertEqual(runtime.run_ready(Path('/unused'),[],{},[],settings,native_runner=lambda *a,**k:255),255);printed.assert_not_called()

    def test_native_console_literal_input_uses_stdin_and_exact_private_pid(self):
        wine=sys.modules['source_wine_runtime']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env={'WINEPREFIX':str(root/'.wine'),'PYTHONHOME':'private-python','LD_PRELOAD':'untrusted','WINEDEBUG':'+all'}
            listed=types.SimpleNamespace(returncode=0,stdout=b'"contagionds.exe","736","Console"\n');delivered=types.SimpleNamespace(returncode=0)
            text='echo literal $value "quoted"'
            with mock.patch.object(wine,'verified_build',return_value={'valid':True}),mock.patch.object(wine,'native_pids',return_value=[2202]),mock.patch.object(wine.subprocess,'run',side_effect=[listed,delivered])as run:
                wine.native_input(root,env,text)
                call=run.call_args_list[1];self.assertEqual(call.args[0],['wine',str(root/'.voltra/source_wine_console.exe'),'736']);self.assertEqual(call.kwargs['input'],text.encode()+b'\n');self.assertNotIn(text,repr(call.args));self.assertEqual(call.kwargs['env']['WINEDEBUG'],'-all');self.assertNotIn('LD_PRELOAD',call.kwargs['env']);self.assertNotIn('PYTHONHOME',call.kwargs['env'])
            for bad in ('','quit\nother','bad\0value','x'*8193):
                with mock.patch.object(wine.subprocess,'run')as run:
                    with self.assertRaises(ValueError):wine.native_input(root,env,bad)
                    run.assert_not_called()
            with mock.patch.object(wine.subprocess,'run')as run:
                with self.assertRaises(ValueError):wine.native_input(root,{'WINEPREFIX':'/other'},'quit')
                run.assert_not_called()
            duplicate=types.SimpleNamespace(returncode=0,stdout=b'"contagionds.exe","736"\n"contagionds.exe","999"\n')
            with mock.patch.object(wine,'verified_build',return_value={}),mock.patch.object(wine.subprocess,'run')as run:
                with self.assertRaises(ValueError):wine.native_input(root,env,'quit')
                run.assert_not_called()
            with mock.patch.object(wine,'verified_build',return_value={'valid':True}),mock.patch.object(wine,'native_pids',return_value=[2202]),mock.patch.object(wine.subprocess,'run',return_value=duplicate)as run:
                with self.assertRaises(ValueError):wine.native_input(root,env,'quit')
                self.assertEqual(run.call_count,1)

    def test_console_build_reuse_requires_source_binary_and_pe32_identity(self):
        build=sys.modules['source_wine_build']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'.voltra').mkdir();source,binary,receipt=build.paths(root)
            source.write_bytes(b'own C source');pe=bytearray(256);pe[:2]=b'MZ';struct.pack_into('<I',pe,60,128);pe[128:132]=b'PE\0\0';struct.pack_into('<H',pe,132,0x14c);binary.write_bytes(pe)
            record={'schema_version':1,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'binary_sha256':hashlib.sha256(pe).hexdigest()};receipt.write_text(json.dumps(record))
            with mock.patch.object(build.subprocess,'run')as run:self.assertTrue(build.ensure(root)['reused']);run.assert_not_called()
            source.write_bytes(b'changed source');self.assertIsNone(build.verified_build(root));source.write_bytes(b'own C source')
            binary.write_bytes(bytes(pe)+b'corrupt');self.assertIsNone(build.verified_build(root));binary.write_bytes(pe)
            struct.pack_into('<H',pe,132,0x8664);binary.write_bytes(pe);record['binary_sha256']=hashlib.sha256(pe).hexdigest();receipt.write_text(json.dumps(record));self.assertIsNone(build.verified_build(root))
            binary.unlink();outside=root.parent/(root.name+'-external');outside.write_bytes(b'keep');binary.symlink_to(outside)
            with mock.patch.object(build.subprocess,'run')as run:
                with self.assertRaises(ValueError):build.ensure(root)
                run.assert_not_called()
            outside.unlink()

    def test_wine_pid_matching_only_exact_current_volume_binary(self):
        wine=sys.modules['source_wine_runtime']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);proc=root/'proc';proc.mkdir()
            for pid,cmd in [('1',str(root/'contagionds.exe')),('2',str(root/'other/contagionds.exe')),('3','wine'),('4','Z:'+str(root/'contagionds.exe').replace('/','\\'))]:
                target=proc/pid;target.mkdir();(target/'cmdline').write_bytes(cmd.encode()+b'\0private')
            self.assertEqual(sorted(wine.native_pids(root,proc)),[1,4])

    def test_open_fortress_listing_rejects_unsafe_and_expansion(self):
        of=sys.modules['source_openfortress_install']
        good='header\n----------\nPath = open_fortress/bin/server.so\nSize = 12\nAttributes = A -rw-r--r--\nEncrypted = -\n'
        self.assertEqual(of.listing(good),['open_fortress/bin/server.so'])
        for bad in (good.replace('open_fortress/bin','../bin'),good.replace('Encrypted = -','Encrypted = +'),good+'\n'+good.split('----------\n')[1],good.replace('Size = 12','Size = 999999999999'),good+'Symbolic Link = /etc/passwd\n'):
            with self.assertRaises(ValueError):of.listing(bad)

    def test_private_archive_tool_reuses_exact_bytes_never_deletes_unknown(self):
        of=sys.modules['source_openfortress_install']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'publisher';source.mkdir();(source/'7z').write_bytes(b'tool');copyright=root/'license';copyright.write_bytes(b'license')
            of.provision_tool(root,source,copyright);of.provision_tool(root,source,copyright)
            target=root/'.voltra/7zip';(target/'operator').write_bytes(b'private')
            with self.assertRaises(ValueError):of.provision_tool(root,source,copyright)
            self.assertEqual((target/'operator').read_bytes(),b'private')

    def test_open_fortress_mount_patch_preserves_operator_text(self):
        of=sys.modules['source_openfortress_install']
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'gameinfo.txt';original='// operator\n'+''.join(' game "|all_source_engine_paths|..\\Team Fortress 2\\tf\\file'+str(i)+'"\n' for i in range(8))
            path.write_text(original);of.mount_paths(path)
            self.assertTrue(path.read_text().startswith('// operator\n'));self.assertEqual(path.read_text().count('|gameinfo_path|../tf2/tf/'),8)

class PublicCapture:
    def __init__(self):self.buffer=io.BytesIO()
    def write(self,text):return self.buffer.write(text.encode())
    def flush(self):pass
    def value(self):return self.buffer.getvalue()


class RawObserverTests(unittest.TestCase):
    def native(self,script,credentials,observer):
        module=sys.modules['native_console'];capture=PublicCapture();children=[];original=module.subprocess.Popen
        def spawn(*a,**kw):
            child=original(*a,**kw);children.append(child);return child
        with tempfile.TemporaryDirectory()as directory,mock.patch.object(module.subprocess,'Popen',side_effect=spawn),mock.patch.object(sys,'stdout',capture):
            try:result=module.run(Path(directory),[sys.executable,'-c',script],dict(os.environ),'quit',credentials,output_observer=observer)
            finally:
                for child in children:
                    child.wait(timeout=3)
                    if child.stdin:child.stdin.close()
        return result,capture.value()

    def test_raw_count_discriminates_positive_zero_and_unknown(self):
        for count,credential,expected in [('77','7',True),('0','0',False),('[redacted]','7',False)]:
            boot=runtime.CoopBoot();sizes=[];raw=(f'[SRCCOOP] Scanned {count} maps for voting in 0.009 seconds.\n').encode()
            def observer(data):sizes.append(len(data));boot.feed(data)
            result,public=self.native('import os,time;os.write(1,'+repr(raw)+');time.sleep(.12)',[credential],observer)
            self.assertEqual(result,0);self.assertEqual(boot.initialized.is_set(),expected);self.assertTrue(sizes);self.assertLessEqual(max(sizes),65536);self.assertNotIn(credential.encode(),public)

    def test_raw_map_contains_secret_and_split_secret_never_reaches_public(self):
        secret='COLLISION_3179';name='ce_'+secret+'_map';boot=runtime.ContagionBoot(name)
        raw=('Host_NewGame on map '+name+'\nVOLTRA_CONTAGION_CONFIG_APPLIED\nVAC secure mode disabled.\n').encode();at=raw.index(secret.encode())+5
        script='import os,time;os.write(1,'+repr(raw[:at])+');time.sleep(.05);os.write(1,'+repr(raw[at:])+');time.sleep(.12)'
        result,public=self.native(script,[secret],boot.feed)
        self.assertEqual(result,0);self.assertTrue(boot.initialized.is_set());self.assertNotIn(secret.encode(),public);self.assertNotIn(b'COLLISION_',public);self.assertIn(b'[redacted]',public)

    def test_multiline_split_secret_remains_private_with_raw_chunks(self):
        secret='FIRST_HALF_3179\nSECOND_HALF_3179';observed=[]
        script="import os,time;os.write(1,b'prefix FIRST_HALF_3179\\n');time.sleep(.05);os.write(1,b'SECOND_HALF_3179 suffix\\n');time.sleep(.12)"
        _,public=self.native(script,iter([secret]),observed.append)
        self.assertIn(secret.encode(),b''.join(observed));self.assertNotIn(b'FIRST_HALF_3179',public);self.assertNotIn(b'SECOND_HALF_3179',public);self.assertIn(b'[redacted]',public)

    def test_observer_exception_has_no_raw_value_in_error_or_stdout(self):
        secret='OBSERVER_PRIVATE_3179';module=sys.modules['native_console'];capture=PublicCapture();children=[];original=module.subprocess.Popen
        def spawn(*a,**kw):
            child=original(*a,**kw);children.append(child);return child
        def broken(data):raise RuntimeError(secret)
        with tempfile.TemporaryDirectory()as directory,mock.patch.object(module.subprocess,'Popen',side_effect=spawn),mock.patch.object(sys,'stdout',capture):
            try:
                with self.assertRaisesRegex(RuntimeError,'Private native output observer failed')as error:module.run(Path(directory),[sys.executable,'-c','import os,time;os.write(1,'+repr(secret.encode()+b'\n')+');time.sleep(.12)'],dict(os.environ),'quit',[secret],output_observer=broken)
                self.assertTrue(error.exception.__suppress_context__);self.assertNotIn(secret,str(error.exception));self.assertNotIn(secret.encode(),capture.value())
            finally:
                for child in children:
                    child.wait(timeout=3)
                    if child.stdin:child.stdin.close()

    def test_wine_private_log_raw_map_and_public_redaction(self):
        wine=sys.modules['source_wine_runtime'];secret='WINE_PRIVATE_3179';name='ce_'+secret;boot=runtime.ContagionBoot(name);capture=PublicCapture()
        raw=('Host_NewGame on map '+name+'\nVOLTRA_CONTAGION_CONFIG_APPLIED\nVAC secure mode disabled.\n').encode();at=raw.index(secret.encode())+5
        script="from pathlib import Path;import time;p=Path('contagion/console.log');p.write_bytes("+repr(raw[:at])+");time.sleep(.16);f=p.open('ab');f.write("+repr(raw[at:])+");f.close();time.sleep(.25)"
        with tempfile.TemporaryDirectory()as directory,mock.patch.object(wine,'verified_build',return_value={'fixture':True}),mock.patch.object(wine,'native_pids',return_value=[]),mock.patch.object(sys,'stdout',capture):
            result=wine.run(Path(directory),[sys.executable,'-c',script],dict(os.environ),'quit',[secret],output_observer=boot.feed)
            self.assertEqual(result,0);self.assertTrue(boot.initialized.is_set());self.assertNotIn(secret.encode(),capture.value());self.assertNotIn(b'WINE_PRIVATE_',capture.value());self.assertIn(b'[redacted]',capture.value());self.assertEqual((Path(directory)/'contagion/console.log').stat().st_mode&0o777,0o600)

    def test_wine_observer_exception_does_not_flush_private_prefix(self):
        wine=sys.modules['source_wine_runtime'];secret='WINE_EXCEPTION_3179';capture=PublicCapture();raw=b'';children=[];original=wine.subprocess.Popen
        def spawn(*a,**kw):
            child=original(*a,**kw);children.append(child);return child
        def observer(data):
            nonlocal raw
            raw+=data
            if secret.encode()in raw:raise ValueError(secret)
        script="import os,time;os.write(1,b'WINE_EXCEP');time.sleep(.05);os.write(1,b'TION_3179\\n');time.sleep(.12)"
        with tempfile.TemporaryDirectory()as directory,mock.patch.object(wine,'verified_build',return_value={'fixture':True}),mock.patch.object(wine,'native_pids',return_value=[]),mock.patch.object(wine.subprocess,'Popen',side_effect=spawn),mock.patch.object(sys,'stdout',capture):
            try:
                with self.assertRaisesRegex(RuntimeError,'Private native output observer failed')as error:wine.run(Path(directory),[sys.executable,'-c',script],dict(os.environ),'quit',[secret],output_observer=observer)
                self.assertTrue(error.exception.__suppress_context__);self.assertNotIn(secret,str(error.exception));self.assertNotIn(b'WINE_EXCEP',capture.value())
            finally:
                for child in children:child.wait(timeout=3)

    def test_source_next_passes_private_hook_without_mutating_stdout(self):
        settings={'SRCDS_APPID':'293030','SERVER_PORT':'27015','SRV_MAP':'ce_COLLISION_3179','HOSTNAME':'fixture'};capture=PublicCapture();ready=threading.Event();write=capture.write
        def writing(value):
            if runtime.READY in value:ready.set()
            return write(value)
        capture.write=writing
        def runner(*args,**kwargs):
            self.assertIs(sys.stdout,capture);callback=kwargs['output_observer'];callback(b'Host_NewGame on map ce_COLLISION_3179\nVOLTRA_CONTAGION_CONFIG_APPLIED\nVAC secure mode disabled.\n');self.assertTrue(ready.wait(1));return 0
        with mock.patch.object(runtime,'local_query_address',return_value='127.0.0.1'),mock.patch.object(sys,'stdout',capture):
            self.assertEqual(runtime.run_ready(Path('/unused'),[],{},['COLLISION_3179'],settings,native_runner=runner),0);self.assertIs(sys.stdout,capture)
        self.assertEqual(capture.value(),(runtime.READY+'\n').encode());self.assertNotIn(b'COLLISION_3179',capture.value())

    def test_wine_log_observer_failure_never_logs_raw_exception_value(self):
        wine=sys.modules['source_wine_runtime'];secret='WINE_FOLLOWER_3179';public=PublicCapture();errors=PublicCapture()
        def observer(data):raise RuntimeError(secret)
        script="from pathlib import Path;import time;Path('contagion/console.log').write_bytes(b'WINE_FOLLOWER_3179\\n');time.sleep(.25)"
        with tempfile.TemporaryDirectory()as directory,mock.patch.object(wine,'verified_build',return_value={'fixture':True}),mock.patch.object(wine,'native_pids',return_value=[]),mock.patch.object(sys,'stdout',public),mock.patch.object(sys,'stderr',errors):
            self.assertEqual(wine.run(Path(directory),[sys.executable,'-c',script],dict(os.environ),'quit',[secret],output_observer=observer),0)
        self.assertNotIn(secret.encode(),public.value());self.assertNotIn(secret.encode(),errors.value());self.assertIn(b'Private native output observer failed',errors.value())

    def test_exit_before_vac_cancels_and_late_raw_output_cannot_emit(self):
        settings={'SRCDS_APPID':'293030','SERVER_PORT':'27015','SRV_MAP':'ce_map'};callbacks=[]
        def runner(*args,**kwargs):
            callback=kwargs['output_observer'];callbacks.append(callback);callback(b'Host_NewGame on map ce_map\nVOLTRA_CONTAGION_CONFIG_APPLIED\n');return 255
        with mock.patch.object(runtime,'local_query_address',return_value='127.0.0.1'),mock.patch('builtins.print')as printed:
            self.assertEqual(runtime.run_ready(Path('/unused'),[],{},[],settings,native_runner=runner),255);callbacks[0](b'VAC secure mode disabled.\n');threading.Event().wait(.05);printed.assert_not_called()

    def test_no_hook_default_and_invalid_hook_preflight(self):
        result,public=self.native("print('DEFAULT_UNCHANGED')",[],None);self.assertEqual(result,0);self.assertEqual(public,b'DEFAULT_UNCHANGED\n')
        for module in (sys.modules['native_console'],sys.modules['source_wine_runtime']):
            with mock.patch.object(module.subprocess,'Popen')as spawn:
                with self.assertRaises(ValueError):module.run(Path('/unused'),[],{},'quit',output_observer='not callable')
                spawn.assert_not_called()

unittest.main()

