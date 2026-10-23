"""Isolated source/config/publication tests. Never launches a publisher binary."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import tomllib
import subprocess
import unittest
from unittest.mock import patch
import zipfile

base=Path('/helpers')
sys.path.insert(0,str(base))
def load(name, file):
    spec=importlib.util.spec_from_file_location(name,base/file)
    module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    spec.loader.exec_module(module)
    return module
steam=load('steam_template','steam-template.py')
load('native_console','native-console.py')
runtime=load('virtual_worlds_runtime','virtual-worlds-runtime.py')
installer=load('virtual_worlds_install','virtual-worlds-install.py')
# Source files use a hyphen; embedded installation modules use underscores.
installer.releases=lambda:json.loads((base/'virtual-worlds-releases.json').read_text())

class Worlds(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.root=Path(self.temporary.name)/'server';self.root.mkdir()
        self.env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001'}
    def tearDown(self):self.temporary.cleanup()
    def payload(self,game):
        relative={'nwn':'bin/linux-x86/nwserver-linux','neos':'Neos.exe','resonite':'Headless/Resonite.dll'}[game]
        path=self.root/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture-do-not-execute')
    def archive(self,name='server.zip',files=None):
        path=Path(self.temporary.name)/name
        with zipfile.ZipFile(path,'w') as archive:
            for name,data in (files or {'bin/linux-x86/nwserver-linux':b'program-v1','data/base.bif':b'base-v1'}).items():archive.writestr(name,data)
        return path
    def test_private_gate_before_process_write_or_network(self):
        for game in ('neos','resonite'):
            with patch.object(installer,'fetch') as fetch,patch.object(steam,'update') as update:
                with self.assertRaisesRegex(ValueError,'Private Steam transport'):installer.install(self.root,game,{'STEAM_PASS':'never-log-this'})
                fetch.assert_not_called();update.assert_not_called();self.assertEqual(list(self.root.iterdir()),[])
    def test_wrong_headless_branch_or_app_rejected(self):
        for env in ({'SRCDS_APPID':'123'},{'SRCDS_BETAID':'public'}):
            with self.assertRaisesRegex(ValueError,'original entitled'):installer.install(self.root,'resonite',env)
    def test_resonite_modern_dotnet_and_private_seed(self):
        self.payload('resonite')
        cwd,argv,env,stop,secrets,ready=runtime.configure(self.root,'resonite',self.env)
        self.assertEqual(cwd,self.root/'Headless');self.assertEqual(argv[0],'dotnet');self.assertTrue(argv[1].endswith('Resonite.dll'))
        self.assertEqual(stop,'shutdown');self.assertIsInstance(ready,bytes)
        value=json.loads((self.root/'Headless/Config/Config.json').read_text())
        self.assertEqual(value['startWorlds'][0]['forcePorts'],{'lnl':28000});self.assertEqual(value['startWorlds'][0]['accessLevel'],'Private')
    def test_neos_original_config_flags_and_mono(self):
        self.payload('neos');_,argv,_,_,_,_=runtime.configure(self.root,'neos',self.env)
        self.assertEqual(argv[0],'mono');self.assertIn('-c',argv);self.assertIn('-l',argv)
        self.assertEqual(json.loads((self.root/'Config/Config.json').read_text())['startWorlds'][0]['forcePort'],28000)
    def test_existing_unicode_json_bytes_and_metadata_unchanged(self):
        self.payload('resonite');path=self.root/'Headless/Config/Config.json';path.parent.mkdir()
        value={'startWorlds':[{'sessionName':'雪','forcePorts':{'lnl':28000,'tcp':28001},'saveOnExit':True}],'loginPassword':'p@ss$雪','unknown':{'value':7}}
        data=b'\xef\xbb\xbf'+json.dumps(value,ensure_ascii=False,indent=3).encode()+b'\r\n';path.write_bytes(data);path.chmod(0o640);before=path.stat()
        _,argv,env,_,secrets,_=runtime.configure(self.root,'resonite',{**self.env,'STEAM_PASS':'never','SRCDS_BETAPASS':'never'})
        self.assertEqual(path.read_bytes(),data);self.assertEqual(path.stat().st_mode,before.st_mode);self.assertEqual(path.stat().st_mtime_ns,before.st_mtime_ns)
        self.assertIn('p@ss$雪',secrets);self.assertNotIn('STEAM_PASS',env);self.assertNotIn('SRCDS_BETAPASS',env);self.assertNotIn('p@ss$雪',argv)
    def test_empty_worlds_permitted_for_interactive_world_creation(self):
        self.payload('neos');path=self.root/'Config/Config.json';path.parent.mkdir();path.write_text('{"startWorlds":[]}')
        runtime.configure(self.root,'neos',self.env)
    def test_unallocated_world_listener_rejected_without_write(self):
        self.payload('neos');path=self.root/'Config/Config.json';path.parent.mkdir();data=b'{"startWorlds":[{"forcePort":9999}]}'
        path.write_bytes(data)
        with self.assertRaisesRegex(ValueError,'selected allocation'):runtime.configure(self.root,'neos',self.env)
        self.assertEqual(path.read_bytes(),data)
    def test_json_duplicate_and_outside_data_path_rejected(self):
        self.payload('neos');path=self.root/'Config/Config.json';path.parent.mkdir()
        for content in ('{"startWorlds":[],"startWorlds":[]}','{"startWorlds":[],"dataFolder":"/tmp/outside"}'):
            path.write_text(content)
            with self.assertRaises(ValueError):runtime.configure(self.root,'neos',self.env)
    def test_symlink_parent_rejected(self):
        self.payload('neos');(self.root/'Config').symlink_to(Path(self.temporary.name),target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'symlink'):runtime.configure(self.root,'neos',self.env)
    def test_nwn_all_original_numeric_flags_and_literal_name(self):
        self.payload('nwn');env={**self.env,'MODULE_NAME':'Custom 雪;$(nope)','SERVER_NAME':'A literal $name','PVP':'2','MAX_CLIENTS':'13','IS_PUBLIC':'true','ELC':'false'}
        _,argv,_,stop,_,_=runtime.configure(self.root,'nwn',env)
        for flag in ('maxclients','minlevel','maxlevel','pauseandplay','pvp','servervault','elc','ilr','gametype','oneparty','difficulty','autosaveinterval','publicserver','reloadwhenempty','interactive'):
            self.assertIn('-'+flag,argv)
        self.assertEqual(argv[argv.index('-module')+1],env['MODULE_NAME']);self.assertEqual(argv[argv.index('-servername')+1],env['SERVER_NAME']);self.assertEqual(argv[argv.index('-maxclients')+1],'13');self.assertEqual(argv[argv.index('-elc')+1],'0');self.assertEqual(stop,'\x03')
    def test_nwn_missing_passwd_entry_gets_private_nss_and_original_binary_cwd(self):
        self.payload('nwn');library=self.root/'.voltra/virtual-worlds/nss/libnss_wrapper.so';library.parent.mkdir(parents=True);library.write_bytes(b'source-fixture-not-executed')
        with patch.object(runtime.pwd,'getpwuid',side_effect=KeyError),patch.object(os,'getuid',return_value=988),patch.object(os,'getgid',return_value=988):
            cwd,_,env,_,_,_=runtime.configure(self.root,'nwn',{**self.env,'MODULE_NAME':'DockerDemo','LD_PRELOAD':'/untrusted.so','NSS_WRAPPER_PASSWD':'/untrusted'})
        self.assertEqual(cwd,self.root/'bin/linux-x86');self.assertEqual(env['LD_PRELOAD'],str(library));self.assertTrue(env['NSS_WRAPPER_PASSWD'].startswith(str(self.root)))
        self.assertIn(':988:988:',Path(env['NSS_WRAPPER_PASSWD']).read_text());self.assertEqual(Path(env['NSS_WRAPPER_PASSWD']).stat().st_mode & 0o777,0o600)
    def test_nwn_bad_original_maxlevel_fails_before_settings_write(self):
        self.payload('nwn')
        with self.assertRaises(ValueError):runtime.configure(self.root,'nwn',{**self.env,'MODULE_NAME':'DockerDemo','MAX_LEVEL':'100'})
        self.assertFalse((self.root/'user/settings.tml').exists())
    def test_nwn_readiness_only_exact_native_load_completion_and_no_raw_secret(self):
        for complete in (b'Server: Module loaded\r\n',b'Server: Saved game loaded\n'):
            output=io.BytesIO();fake=type('Stdout',(),{'buffer':output})()
            observer=runtime.NWNReady()
            with patch.object(sys,'stdout',fake):
                observer.feed(b'Server: Running...\nsecret-value\ncommand echo Server: Module loaded\n')
                self.assertEqual(output.getvalue(),b'')
                observer.feed(complete[:9]);observer.feed(complete[9:]);observer.feed(complete)
            self.assertEqual(output.getvalue(),b'VOLTRA_NWN_READY\n')
    def test_nwn_child_uses_private_umask_and_observer(self):
        self.payload('nwn');previous=os.getcwd();os.chdir(self.root)
        try:
            with patch.dict(os.environ,{**self.env,'MODULE_NAME':'DockerDemo'},clear=True),patch.object(sys,'argv',['runtime','nwn']),patch.object(os,'umask') as umask,patch.object(runtime,'run',return_value=0) as console:
                self.assertEqual(runtime.main(),0);umask.assert_called_once_with(0o077);self.assertTrue(callable(console.call_args.kwargs['output_observer']))
        finally:os.chdir(previous)
    def test_nwn_secrets_private_toml_not_argv_environment(self):
        self.payload('nwn');path=self.root/'user/settings.tml';path.parent.mkdir();path.write_bytes(b'# operator\r\n[server.login]\r\nplayer-password = "old"\r\nmax-players = 17\r\n[custom]\r\nvalue = "retain"\r\n')
        password='quote" dollar$ slash\\ 雪';_,argv,env,_,secrets,_=runtime.configure(self.root,'nwn',{**self.env,'MODULE_NAME':'module','PLAYER_PASSWORD':password,'DM_PASSWORD':'dm-secret'})
        parsed=tomllib.loads(path.read_text());self.assertEqual(parsed['server']['login']['player-password'],password);self.assertEqual(parsed['custom']['value'],'retain');self.assertEqual(parsed['server']['login']['max-players'],17)
        self.assertIn(b'# operator\r\n',path.read_bytes());self.assertEqual(path.stat().st_mode & 0o777,0o600)
        self.assertNotIn(password,argv);self.assertNotIn('PLAYER_PASSWORD',env);self.assertNotIn('DM_PASSWORD',env);self.assertIn(password,secrets)
        self.assertEqual(len(list((self.root/'.voltra/virtual-worlds/backups').iterdir())),1)
    def test_save_slot_uses_load_instead_of_module(self):
        self.payload('nwn');_,argv,_,_,_,_=runtime.configure(self.root,'nwn',{**self.env,'SAVE_SLOT':'7','MODULE_NAME':'ignored'})
        self.assertEqual(argv[argv.index('-load')+1],'7');self.assertNotIn('-module',argv)
        for slot in ('0','1','-2','7;quit'):
            with self.assertRaises(ValueError):runtime.configure(self.root,'nwn',{**self.env,'SAVE_SLOT':slot})
    def test_bad_toml_and_multiline_managed_password_fail_without_rewrite(self):
        self.payload('nwn');path=self.root/'user/settings.tml';path.parent.mkdir()
        for content in ('[server.login]\nplayer-password = """multi\nline"""\n','[server.login]\nplayer-password = INVALID\n'):
            path.write_text(content)
            with self.assertRaises(ValueError):runtime.configure(self.root,'nwn',{**self.env,'MODULE_NAME':'test'})
            self.assertEqual(path.read_text(),content)
    def test_numeric_latest_uses_publisher_index_not_lexical_or_docker(self):
        value=installer.select_nwn('latest','<a href="nwnee-dedicated-8193.37-9.zip"><a href="nwnee-dedicated-8193.37-17.zip">')
        self.assertEqual(value['version'],'8193.37-17');self.assertTrue(value['url'].startswith('https://nwn.beamdog.net/downloads/'))
        for version in ('../../bad','8193;command','https://mirror/zip'):
            with self.assertRaises(ValueError):installer.select_nwn(version)
    def test_nonpinned_version_requires_matching_publisher_checksum(self):
        with patch.object(installer,'fetch',return_value=b'0'*64+b'  WRONG.zip'):
            with self.assertRaisesRegex(ValueError,'checksum'):installer.select_nwn('8193.37-9')
    def test_archive_preserves_user_tree_and_noop_program_metadata(self):
        user=self.root/'user/saves/7/world.sav';user.parent.mkdir(parents=True);user.write_bytes(b'operator-world');user.chmod(0o640)
        archive=self.archive();installer.publish_archive(self.root,archive,{'version':'fixture','sha256':'0'*64})
        program=self.root/'bin/linux-x86/nwserver-linux';before=program.stat();world=user.stat()
        installer.publish_archive(self.root,archive,{'version':'fixture','sha256':'0'*64})
        self.assertEqual(program.stat().st_ino,before.st_ino);self.assertEqual(program.stat().st_mtime_ns,before.st_mtime_ns)
        self.assertEqual(user.read_bytes(),b'operator-world');self.assertEqual(user.stat().st_mode,world.st_mode);self.assertEqual(user.stat().st_mtime_ns,world.st_mtime_ns)
    def test_update_preserves_program_mode_owner_and_user_mods(self):
        installer.publish_archive(self.root,self.archive(),{})
        program=self.root/'bin/linux-x86/nwserver-linux';program.chmod(0o750);os.chown(program,988,988)
        custom=self.root/'data/operator.bif';custom.write_bytes(b'custom')
        installer.publish_archive(self.root,self.archive('update.zip',{'bin/linux-x86/nwserver-linux':b'program-v2','data/base.bif':b'base-v2'}),{})
        self.assertEqual(program.read_bytes(),b'program-v2');self.assertEqual(program.stat().st_uid,988);self.assertEqual(program.stat().st_mode & 0o777,0o750);self.assertEqual(custom.read_bytes(),b'custom')
    def test_modified_program_collision_no_partial_update(self):
        installer.publish_archive(self.root,self.archive(),{});program=self.root/'bin/linux-x86/nwserver-linux';program.write_bytes(b'operator-patched')
        with self.assertRaisesRegex(ValueError,'operator-modified'):installer.publish_archive(self.root,self.archive('update.zip',{'data/base.bif':b'base-v2','bin/linux-x86/nwserver-linux':b'v2'}),{})
        self.assertEqual((self.root/'data/base.bif').read_bytes(),b'base-v1');self.assertEqual(program.read_bytes(),b'operator-patched')
    def test_archive_traversal_and_symlink_rejected(self):
        for name in ('../escape','/escape','data/../escape','data\\escape'):
            with self.assertRaisesRegex(ValueError,'Unsafe'):installer.publish_archive(self.root,self.archive(files={name:b'bad','bin/linux-x86/nwserver-linux':b'ok'}),{})
        archive=self.archive()
        with zipfile.ZipFile(archive,'a') as z:
            link=zipfile.ZipInfo('data/link');link.external_attr=(0o120777<<16);z.writestr(link,'/outside')
        with self.assertRaisesRegex(ValueError,'Unsafe'):installer.publish_archive(self.root,archive,{})
    def test_publication_failure_rolls_back_changed_program(self):
        installer.publish_archive(self.root,self.archive(),{})
        original=steam._publish
        def fail(root,relative,*args,**kwargs):
            if relative=='data/base.bif':raise RuntimeError('injected publisher failure')
            return original(root,relative,*args,**kwargs)
        with patch.object(steam,'_publish',side_effect=fail):
            with self.assertRaises(RuntimeError):installer.publish_archive(self.root,self.archive('update.zip',{'bin/linux-x86/nwserver-linux':b'v2','data/base.bif':b'v2'}),{})
        self.assertEqual((self.root/'bin/linux-x86/nwserver-linux').read_bytes(),b'program-v1')
    def test_mod_bad_digest_preserves_existing_plugin_tree(self):
        with patch.object(installer,'fetch',return_value=b'bad'):
            with self.assertRaisesRegex(ValueError,'digest'):installer.install_mods(self.root,'resonite')
        self.assertEqual(list(self.root.iterdir()),[])
    def test_late_failure_after_rename_rolls_back_its_exact_inode(self):
        installer.publish_archive(self.root,self.archive(),{})
        original=steam._publish;failed=False
        def fail(root,relative,*args,**kwargs):
            nonlocal failed
            result=original(root,relative,*args,**kwargs)
            if relative=='data/base.bif' and not failed:
                failed=True;raise RuntimeError('injected after atomic rename')
            return result
        with patch.object(steam,'_publish',side_effect=fail):
            with self.assertRaises(RuntimeError):installer.publish_archive(self.root,self.archive('update.zip',{'bin/linux-x86/nwserver-linux':b'v2','data/base.bif':b'v2'}),{})
        self.assertEqual((self.root/'bin/linux-x86/nwserver-linux').read_bytes(),b'program-v1')
        self.assertEqual((self.root/'data/base.bif').read_bytes(),b'base-v1')
    def test_enabled_mod_loader_maps_current_headless_paths_and_keeps_plugins(self):
        self.payload('resonite');plugin=self.root/'Headless/rml_mods/operator.dll';plugin.parent.mkdir();plugin.write_bytes(b'operator')
        files={'ResoniteModLoader.dll':b'loader','0Harmony.dll':b'harmony','license.txt':b'license'}
        assets=[{'name':name,'url':'https://github.com/fixture/'+name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in files.items()]
        package={'mods':{'resonite':{'assets':assets[:2],'licenses':assets[2:]}}}
        with patch.object(installer,'releases',return_value=package),patch.object(installer,'fetch',side_effect=lambda url,limit:files[url.rsplit('/',1)[-1]]):
            cwd,argv,_,_,_,_=runtime.configure(self.root,'resonite',{**self.env,'ENABLE_MODLOADER':'true'})
        self.assertEqual(argv[argv.index('-LoadAssembly')+1],str(self.root/'Headless/Libraries/ResoniteModLoader.dll'))
        self.assertEqual((cwd/'rml_libs/0Harmony.dll').read_bytes(),b'harmony');self.assertEqual(plugin.read_bytes(),b'operator')
        self.assertEqual((self.root/'.voltra/virtual-worlds/licenses/license.txt').read_bytes(),b'license')
    def test_second_bad_mod_asset_does_not_publish_first_asset(self):
        asset=lambda name,data:{'name':name,'url':'https://github.com/fixture/'+name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        package={'mods':{'resonite':{'assets':[asset('ResoniteModLoader.dll',b'loader'),asset('0Harmony.dll',b'expected')],'licenses':[]}}}
        with patch.object(installer,'releases',return_value=package),patch.object(installer,'fetch',side_effect=[b'loader',b'bad']):
            with self.assertRaisesRegex(ValueError,'digest'):installer.install_mods(self.root,'resonite')
        self.assertEqual(list(self.root.iterdir()),[])
    def nss_sources(self):
        library=Path(self.temporary.name)/'libnss_wrapper.so';license=Path(self.temporary.name)/'copyright'
        library.write_bytes(b'fixture NSS source');license.write_bytes(b'fixture license')
        pin={'nss':{'version':'1.1.15-2','sha256':hashlib.sha256(library.read_bytes()).hexdigest(),'copyright_sha256':hashlib.sha256(license.read_bytes()).hexdigest()}}
        return library,license,pin
    def test_nss_reinstall_retains_exact_bytes_mode_owner_and_inode(self):
        library,license,pin=self.nss_sources()
        with patch.object(installer,'releases',return_value=pin),patch.object(installer.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'libnss-wrapper 1.1.15-2\n')):
            installer.prepare_nss(self.root,library,license)
            target=self.root/'.voltra/virtual-worlds/nss/libnss_wrapper.so';target.chmod(0o750);os.chown(target,988,988);before=target.stat()
            installer.prepare_nss(self.root,library,license)
        self.assertEqual(target.stat().st_uid,988);self.assertEqual(target.stat().st_gid,988);self.assertEqual(target.stat().st_mode,before.st_mode);self.assertEqual(target.stat().st_ino,before.st_ino)
    def test_nss_bad_license_digest_precedes_all_publication(self):
        library,license,pin=self.nss_sources();pin['nss']['copyright_sha256']='0'*64
        with patch.object(installer,'releases',return_value=pin),patch.object(installer.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'libnss-wrapper 1.1.15-2\n')):
            with self.assertRaisesRegex(ValueError,'SHA256'):installer.prepare_nss(self.root,library,license)
        self.assertEqual(list(self.root.iterdir()),[])
    def test_native_console_returns_raw_status_and_uses_typed_marker(self):
        self.payload('resonite');previous=os.getcwd();os.chdir(self.root)
        try:
            with patch.dict(os.environ,{**self.env,'AUTO_UPDATE':'0'},clear=True),patch.object(sys,'argv',['runtime','resonite']),patch.object(runtime,'run',return_value=37) as console:
                self.assertEqual(runtime.main(),37);self.assertEqual(console.call_args.kwargs['ready_marker'],b'World running');self.assertEqual(console.call_args.args[3],'shutdown')
        finally:os.chdir(previous)

if __name__=='__main__':unittest.main()
