import hashlib
import importlib.util
import io
import json
import os
import signal
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zipfile

import valheim_runtime as valheim
import vrising_runtime as vrising
import valheim_vrising_install as installer


class NativeFamilies(unittest.TestCase):
    def test_private_mono_installs_only_in_owned_prefix(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();state=root/'.voltra/vrising';state.mkdir(parents=True)
            package=state/'wine-mono-9.1.0-x86.msi';package.write_bytes(b'pinned-test-msi')
            compat=root/'.steam/steam/steamapps/compatdata/1829350';runtime=compat/'pfx/drive_c/windows/mono/mono-2.0/lib/mono/4.5/mscorlib.dll'
            environment={'VOLTRA_PRIVATE_MONO':'mono','STEAM_COMPAT_DATA_PATH':str(compat),'WINEDLLOVERRIDES':'winhttp=n,b;mscoree=b'}
            calls=[]
            def execute(command,**options):
                calls.append(command);self.assertEqual(options['env']['WINEDLLOVERRIDES'],'mscoree=;winhttp=b');self.assertEqual(options['cwd'],root)
                if 'msiexec.exe' in command:
                    runtime.parent.mkdir(parents=True);runtime.write_bytes(b'installed-test-runtime')
                return subprocess.CompletedProcess(command,0,b'installer fixture')
            with patch.dict(installer.MONO_RELEASE,{'sha256':hashlib.sha256(package.read_bytes()).hexdigest()}),patch.object(vrising.subprocess,'run',side_effect=execute):
                vrising.private_mono(root,root/'private/proton',environment)
            self.assertEqual(len(calls),2);self.assertIn('msiexec.exe',calls[1]);self.assertIn('/qn',calls[1])
            self.assertEqual(environment['WINEDLLOVERRIDES'],'winhttp=n,b;mscoree=b')
            receipt=json.loads((state/'mono-installed.json').read_text());self.assertEqual(receipt['native_installer_exit'],0)
            self.assertEqual(receipt['prefix'],str((compat/'pfx').relative_to(root)))

    def test_private_mono_verified_cache_and_tamper(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();state=root/'.voltra/vrising';state.mkdir(parents=True)
            compat=root/'.steam/steam/steamapps/compatdata/1829350';runtime=compat/'pfx/drive_c/windows/mono/mono-2.0/lib/mono/4.5/mscorlib.dll'
            runtime.parent.mkdir(parents=True);runtime.write_bytes(b'owned-mono-runtime')
            (state/'mono-installed.json').write_text(json.dumps({'package_sha256':installer.MONO_RELEASE['sha256'],'mscorlib_sha256':hashlib.sha256(runtime.read_bytes()).hexdigest()}))
            environment={'VOLTRA_PRIVATE_MONO':'mono','STEAM_COMPAT_DATA_PATH':str(compat)}
            with patch.object(vrising.subprocess,'run',side_effect=AssertionError('cached runtime must not launch installers')):
                vrising.private_mono(root,root/'proton',environment)
                runtime.write_bytes(b'operator-modified-runtime')
                with self.assertRaisesRegex(ValueError,'differs'):
                    vrising.private_mono(root,root/'proton',environment)
            environment['STEAM_COMPAT_DATA_PATH']=str(root.parent/'outside')
            with self.assertRaisesRegex(ValueError,'leave the volume'):
                vrising.private_mono(root,root/'proton',environment)

    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.root=Path(self.temporary.name)
        for name in ['valheim_server.x86_64','VRisingServer.exe','.voltra/proton/GE-Proton11-9/proton','.voltra/nss/libnss_wrapper.so']:
            target=self.root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('fixture')
        self.env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012','SERVER_NAME':'Literal +name $()','PASSWORD':'FiveSecret','WORLD':'World One'}
    def tearDown(self):self.temporary.cleanup()
    def archive(self,members):
        target=self.root/'test.zip'
        with zipfile.ZipFile(target,'w')as out:
            for name,data in members.items():out.writestr(name,data)
        return target
    def test_valheim_literal_arguments_and_backup_controls(self):
        args,environment,secrets=valheim.configure(self.root,{**self.env,'ENABLE_CROSSPLAY':'1','BACKUP_INTERVAL':'60','BACKUP_COUNT':'7','BACKUP_SHORTTIME':'120','BACKUP_LONGTIME':'240'})
        self.assertEqual(args[args.index('-name')+1],'Literal +name $()');self.assertIn('-crossplay',args)
        self.assertEqual(args[args.index('-backups')+1],'7');self.assertEqual(environment['SteamAppId'],'892970');self.assertIn('FiveSecret',secrets)
    def test_valheim_requires_consecutive_allocations(self):
        with self.assertRaises(ValueError):valheim.configure(self.root,{**self.env,'VOLTRA_ALLOCATED_PORTS':'28010,28012'})
    def test_valheim_unsafe_world_and_password_rejected(self):
        for values in [{'WORLD':'../escape'},{'PASSWORD':'abc'},{'PASSWORD':'Literal'}]:
            with self.subTest(values=values),self.assertRaises(ValueError):valheim.configure(self.root,{**self.env,**values})
    def test_valheim_loader_must_exist(self):
        with self.assertRaises(ValueError):valheim.configure(self.root,{**self.env,'VOLTRA_VALHEIM_VARIANT':'bepinex'})
    def test_valheim_private_nss_and_doorstop_do_not_mutate_parent_preloads(self):
        for name in ['doorstop_libs/libdoorstop_x64.so','BepInEx/core/BepInEx.Preloader.dll']:
            target=self.root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('fixture')
        with patch.dict(os.environ,{'LD_PRELOAD':'/outside.so'}):
            _,environment,_=valheim.configure(self.root,{**self.env,'VOLTRA_VALHEIM_VARIANT':'bepinex'})
            self.assertEqual(os.environ['LD_PRELOAD'],'/outside.so');self.assertNotIn('/outside.so',environment['LD_PRELOAD'])
            self.assertEqual(environment['LD_PRELOAD'].split(':'),[str(self.root/'.voltra/nss/libnss_wrapper.so'),str(self.root/'doorstop_libs/libdoorstop_x64.so')])
            self.assertEqual((self.root/'.voltra/nss/passwd').stat().st_mode&511,0o600)
    def test_vrising_typed_native_settings_preserve_unknown_fields(self):
        target=self.root/'save-data/Settings/ServerHostSettings.json';target.parent.mkdir(parents=True);target.write_text(json.dumps({'Custom':{'kept':True},'Rcon':{'Extra':'keep'}}))
        args,environment,secrets,log,rcon=vrising.configure(self.root,{**self.env,'VR_NAME':'Native +literal $safe','VR_RCON_ENABLED':'true','VR_RCON_PASSWORD':'privateRcon','VR_SAVE_NAME':'World One','VR_MAX_USERS':'8','VR_LIST_ON_STEAM':'false'})
        data=json.loads(target.read_text());self.assertEqual(data['Name'],'Native +literal $safe');self.assertEqual(data['MaxConnectedUsers'],8);self.assertIs(data['ListOnSteam'],False);self.assertEqual(data['Custom'],{'kept':True});self.assertEqual(data['Rcon']['Extra'],'keep')
        self.assertEqual(data['QueryPort'],28011);self.assertEqual(data['Rcon']['Port'],28012);self.assertEqual(target.stat().st_mode&511,0o600)
        self.assertTrue(list((self.root/'.voltra/vrising/config-backups').glob('*')));self.assertNotIn('VR_RCON_PASSWORD',environment)
        self.assertEqual(environment['WINEDLLOVERRIDES'],'winhttp=b');self.assertIn('1829350',environment['STEAM_COMPAT_DATA_PATH'])
        self.assertEqual(environment['SteamAppId'],'1604030')
    def test_vrising_bepinex_original_vocabulary(self):
        for name in ['winhttp.dll','BepInEx/core/BepInEx.Unity.IL2CPP.dll']:
            target=self.root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('fixture')
        vrising.configure(self.root,{**self.env,'VOLTRA_VRISING_VARIANT':'bepinex','VOLTRA_WINETRICKS_RUN':'mono','WINETRICKS_RUN':'','MAX_PLAYERS':'6','SERVER_LIST':'false','SERVER_SECURE':'false','ADMIN_ONLY_DEBUG_EVENTS':'true','DEBUG_EVENTS':'false','SAVE_NAME':'Legacy'})
        data=json.loads((self.root/'save-data/Settings/ServerHostSettings.json').read_text());self.assertEqual(data['MaxConnectedUsers'],6);self.assertIs(data['ListOnEOS'],False);self.assertIs(data['Secure'],False);self.assertEqual(data['SaveName'],'Legacy')
    def test_vrising_rejects_unsafe_save_invalid_boolean_and_external_config(self):
        for values in [{'VR_SAVE_NAME':'../escape'},{'VR_SECURE':'yes'},{'VR_MAX_USERS':'129'}]:
            with self.subTest(values=values),self.assertRaises(ValueError):vrising.configure(self.root,{**self.env,**values})
        (self.root/'save-data').symlink_to('/tmp',target_is_directory=True)
        with self.assertRaises(ValueError):vrising.configure(self.root,self.env)
    def test_mod_archive_prevalidates_all_before_publication(self):
        archive=self.archive({'BepInEx/core/native.dll':'valid','save-data/Saves/world':'forbidden'})
        with self.assertRaises(ValueError):installer.overlay(self.root,archive)
        self.assertFalse((self.root/'BepInEx').exists())
    def test_mod_archive_links_and_duplicates_rejected(self):
        archive=self.root/'link.zip'
        with zipfile.ZipFile(archive,'w')as out:
            info=zipfile.ZipInfo('BepInEx/core/link');info.external_attr=0o120777<<16;out.writestr(info,'/outside')
        with self.assertRaises(ValueError):installer.overlay(self.root,archive)
    def test_windows_package_separators_normalized_without_traversal_or_collisions(self):
        archive=self.archive({'plugins\\Example.dll':'legitimate Windows ZIP member'})
        installer.overlay(self.root,archive,plugin_directory='BepInEx/plugins/Owner-Package-1.0.0')
        self.assertEqual((self.root/'BepInEx/plugins/Owner-Package-1.0.0/Example.dll').read_text(),'legitimate Windows ZIP member')
        for name in ['..\\outside.dll','C:\\outside.dll','\\\\server\\outside.dll']:
            archive=self.archive({'plugins/Safe.dll':'safe',name:'unsafe'})
            with self.subTest(name=name),self.assertRaises(ValueError):installer.overlay(self.root,archive,plugin_directory='BepInEx/plugins/Other-Package-1.0.0')
        self.assertFalse((self.root/'BepInEx/plugins/Other-Package-1.0.0').exists())
        archive=self.archive({'plugins/Other.dll':'first','plugins\\Other.dll':'second'})
        with self.assertRaises(ValueError):installer.overlay(self.root,archive)
    def test_mod_overlay_keeps_operator_settings_and_updates_owned_plugins(self):
        config=self.root/'BepInEx/config/keep.cfg';config.parent.mkdir(parents=True);config.write_text('operator')
        plugin=self.root/'BepInEx/plugins/managed.dll';plugin.parent.mkdir(parents=True);plugin.write_text('old');plugin.chmod(0o640)
        archive=self.archive({'BepInEx/config/keep.cfg':'default','BepInEx/plugins/managed.dll':'new','BepInEx/core/loader.dll':'loader'})
        identity=hashlib.sha256(b'old').hexdigest();files=installer.overlay(self.root,archive,managed={'BepInEx/plugins/managed.dll':identity})
        self.assertEqual(config.read_text(),'operator');self.assertEqual(plugin.read_text(),'new');self.assertIn('BepInEx/plugins/managed.dll',files)
        backups=list((self.root/'.voltra/survival-mods/backups').rglob('managed.dll'));self.assertEqual(backups[0].read_text(),'old');self.assertEqual(backups[0].stat().st_mode&511,0o640)
    def test_mod_dependency_cycles_fail_closed(self):
        with patch.object(installer,'api',return_value={'dependencies':['Owner-Pack-1.0.0']}),self.assertRaises(ValueError):installer.dependencies('Owner-Pack-1.0.0')
    def test_selected_modpack_version_cannot_silently_change_publisher_bytes(self):
        def zipped(name,content):
            buffer=io.BytesIO()
            with zipfile.ZipFile(buffer,'w')as out:out.writestr(name,content)
            return buffer.getvalue()
        base=zipped('Pack/BepInEx/core/BepInEx.Preloader.dll','loader');first=zipped('plugins/Example.dll','original');changed=zipped('plugins/Example.dll','unexpected changed bytes')
        current=[first]
        class Response(io.BytesIO):
            def geturl(self):return 'https://publisher.invalid/archive.zip'
        def response(request,**_):return Response(base if request.full_url.endswith('base.zip')else current[0])
        release={'url':'https://publisher.invalid/base.zip','sha256':hashlib.sha256(base).hexdigest(),'prefix':'Pack'}
        package={'identifier':'Owner-Pack-1.0.0','url':'https://publisher.invalid/mod.zip'}
        environment={'VOLTRA_VALHEIM_VARIANT':'bepinex','V_MODPACK':'Owner-Pack-1.0.0'}
        with patch.object(installer,'update'),patch.object(installer,'dependencies',return_value=[package]),patch.dict(installer.RELEASES,{'valheim':release}),patch.object(installer.urllib.request,'urlopen',side_effect=response),patch('private_nss.provision'):
            first_receipt=installer.install(self.root,'valheim',environment);self.assertEqual(first_receipt['overlays'][1]['sha256'],hashlib.sha256(first).hexdigest())
            current[0]=changed
            with self.assertRaisesRegex(ValueError,'checksum mismatch'):installer.install(self.root,'valheim',environment)
        self.assertEqual((self.root/'BepInEx/plugins/Owner-Pack-1.0.0/Example.dll').read_text(),'original')
    def test_mod_package_and_ambiguous_asset_validation(self):
        for name in ['../escape','Owner/Name','Owner-Pack-1.0.0;cmd']:
            with self.subTest(name=name),self.assertRaises(ValueError):installer.package_id(name)
        with patch.object(installer,'api',return_value={'assets':[{'name':'One.zip'},{'name':'Two.zip'}]}),self.assertRaises(ValueError):installer.plus_release({'MATCH':'.zip'})
    def test_native_windows_pid_match_excludes_similar_names(self):
        proc=self.root/'proc';proc.mkdir()
        for pid,name in [('12',str(self.root/'VRisingServer.exe')),('13',str(self.root/'VRisingServer.exe-helper'))]:
            directory=proc/pid;directory.mkdir();(directory/'cmdline').write_bytes(name.encode()+b'\0-private')
        self.assertEqual(vrising.native_pids(self.root,proc),[12])
    def test_rcon_native_protocol_authentication_and_literal_command(self):
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);port=listener.getsockname()[1];received=[]
        def exact(connection,count):
            output=b''
            while len(output)<count:output+=connection.recv(count-len(output))
            return output
        def peer():
            with listener.accept()[0]as connection:
                for kind,answer in [(3,b''),(2,b'native version')]:
                    length=struct.unpack('<i',exact(connection,4))[0];frame=exact(connection,length);identifier,actual=struct.unpack('<ii',frame[:8]);received.append((actual,frame[8:-2].decode()));self.assertEqual(actual,kind)
                    response=struct.pack('<ii',identifier,2 if kind==3 else 0)+answer+b'\0\0';connection.sendall(struct.pack('<i',len(response))+response)
            listener.close()
        thread=threading.Thread(target=peer);thread.start();client=vrising.RCON(port,'fixture-private')
        try:self.assertEqual(client.command('announce literal $()'),'native version')
        finally:client.close();thread.join(timeout=3)
        self.assertEqual(received,[(3,'fixture-private'),(2,'announce literal $()')])
    def test_valheim_supervisor_requests_native_save_and_preserves_exit(self):
        fixture=self.root/'native.py';fixture.write_text("import signal,time,pathlib,sys\ndef stop(*_):\n pathlib.Path('save.receipt').write_text('native saved');sys.exit(0)\nsignal.signal(signal.SIGINT,stop)\npathlib.Path('ready.receipt').write_text('ready')\nprint('Game server connected',flush=True)\nwhile True:time.sleep(.02)\n")
        code="import os,sys;from pathlib import Path;from valheim_runtime import run;sys.exit(run(Path.cwd(),[sys.executable,'native.py'],dict(os.environ),[]))"
        process=subprocess.Popen([sys.executable,'-B','-c',code],cwd=self.root,env={**os.environ,'PYTHONPATH':str(Path(valheim.__file__).parent)},stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        try:
            deadline=time.monotonic()+4
            while not(self.root/'ready.receipt').exists()and time.monotonic()<deadline:time.sleep(.01)
            self.assertTrue((self.root/'ready.receipt').exists());process.send_signal(signal.SIGTERM);output=process.communicate(timeout=4)[0]
            self.assertEqual(process.returncode,0,output);self.assertEqual((self.root/'save.receipt').read_text(),'native saved')
        finally:
            if process.poll()is None:process.kill();process.wait()


if __name__=='__main__':unittest.main()
