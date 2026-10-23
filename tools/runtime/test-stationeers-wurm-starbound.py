import json
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch
import stationeers_wurm_starbound_runtime as runtime
import stationeers_wurm_starbound_install as installer
import steam_template
import stationeers_console_compat as console_compat


class Families(unittest.TestCase):
    def test_console_mapping_preserves_unknown_configuration_and_limits_symbols(self):
        previous='<?xml version="1.0"?>\n<configuration>\n<!-- operator comment -->\n<runtime custom="unchanged" />\n</configuration>\n'
        updated=console_compat.configuration(previous)
        self.assertEqual(updated.replace(console_compat.BLOCK,''),previous)
        self.assertEqual(console_compat.configuration(updated),updated)
        import xml.etree.ElementTree as E
        mappings=E.fromstring(updated).findall('dllmap');self.assertEqual(len(mappings),1)
        self.assertEqual(mappings[0].attrib,{'dll':'kernel32.dll','os':'linux','cpu':'x86-64'})
        self.assertEqual([x.get('name')for x in mappings[0]],['SetConsoleOutputCP','SetConsoleCP'])
    def test_console_mapping_conflicts_and_unsafe_xml_fail_closed(self):
        for previous in ['<configuration><dllmap dll="kernel32.dll" target="operator.so" /></configuration>','<!DOCTYPE configuration [<!ENTITY outside SYSTEM "file:///etc/passwd">]><configuration />',console_compat.BEGIN+'\n<configuration></configuration>']:
            with self.assertRaises(ValueError):console_compat.configuration(previous)
    def test_console_compatibility_rejects_external_library_link_before_read(self):
        state=self.root/'.voltra/stationeers/console-compat';state.mkdir(parents=True,exist_ok=True)
        (state/'libvoltra_console_utf8.so').unlink();(state/'libvoltra_console_utf8.so').symlink_to('/etc/passwd')
        with patch.object(console_compat.subprocess,'run',side_effect=AssertionError('no compiler on unsafe destination')):
            with self.assertRaises(ValueError):console_compat.provision(self.root)
    def test_console_preload_checks_receipt_and_confines_other_loaders(self):
        library=self.root/'.voltra/stationeers/console-compat/libvoltra_console_utf8.so'
        with self.assertRaises(ValueError):console_compat.native_preload(self.root,('/etc/passwd',))
        library.write_bytes(b'changed operator binary')
        with self.assertRaisesRegex(ValueError,'build receipt'):console_compat.native_preload(self.root)
    def test_family_uses_typed_shared_steam_contract(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);environment={'SRCDS_BETAID':'beta','STEAM_USER':'anonymous'};observed=[]
            def acquire(path,appid,*,env,required,validate):
                argv=steam_template.arguments(path,appid,env,validate)
                self.assertIn('-beta',argv);self.assertIsInstance(env,dict);self.assertEqual(required,('rocketstation_DedicatedServer.x86_64',));observed.append(appid);return{'appid':appid,'buildid':1}
            with patch.object(installer,'update',side_effect=acquire),patch.object(console_compat,'provision',return_value={}):installer.install(root,'stationeers',environment)
            self.assertEqual(observed,[600760])
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)
        self.env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011'}
        state=self.root/'.voltra/stationeers/console-compat';state.mkdir(parents=True,exist_ok=True);library=state/'libvoltra_console_utf8.so';library.write_bytes(b'private compatibility fixture')
        (state/'build.json').write_text(json.dumps({'source_sha256':hashlib.sha256(console_compat.SOURCE.encode()).hexdigest(),'binary_sha256':hashlib.sha256(library.read_bytes()).hexdigest()}))
        for name in ('rocketstation_DedicatedServer.x86_64','WurmServerLauncher','starbound_server'):
            path=self.root/name;path.write_text('fixture');path.chmod(0o755)
    def world(self,name='dist/Adventure'):
        path=self.root/name;path.mkdir(parents=True);database=path/'sqlite.db';database.write_bytes(b'actual operator world');database.chmod(0o640);return path,database
    def test_stationeers_literal_original_controls(self):
        env={**self.env,'SERVER_NAME':'literal $name +quit','WORLD_NAME':'Moon','SAVE_NAME':'world-one','SERVER_PASSWD':'literal secret','UPDATE_PORT':'27014','AUTOSAVE':'false','SAVE_INTERVAL':'42','UPNP':'true','MAX_PLAYERS':'12'}
        argv,child,stop,secrets,options=runtime.configure(self.root,'stationeers',env)
        self.assertEqual(argv[1:7],['-batchmode','-nographics','-file','start','world-one','Lunar']);self.assertIn('literal $name +quit',argv);self.assertIn('literal secret',argv);self.assertIn('28011',argv);self.assertIn('42',argv);self.assertIn('literal secret',secrets);self.assertTrue(options['terminal_input']);self.assertTrue(options['terminal_enter_carriage_return']);self.assertEqual(child['LD_PRELOAD'],str(self.root/'.voltra/stationeers/console-compat/libvoltra_console_utf8.so'))
    def test_stationeers_current_world_aliases_and_retired_choices(self):
        for old,current in [('Moon','Lunar'),('Mars','Mars2'),('Europa','Europa3'),('Europa2','Europa3'),('Mimas','MimasHerschel'),('Vulcan','Vulcan'),('Vulcan2','Vulcan2'),('Venus','Venus')]:
            argv,*_=runtime.configure(self.root,'stationeers',{**self.env,'WORLD_NAME':old});self.assertEqual(argv[6],current)
        for retired in ('Space','Loulan'):
            with self.assertRaisesRegex(ValueError,'does not provide'):runtime.configure(self.root,'stationeers',{**self.env,'WORLD_NAME':retired})
    def test_stationeers_rejects_save_path_world_and_ports(self):
        for changes in ({'SAVE_NAME':'../escape'},{'WORLD_NAME':'moon;quit'},{'AUTOSAVE':'yes'},{'MAX_PLAYERS':'31'},{'SERVER_NAME':'bad\nquit'},{'VOLTRA_ALLOCATED_PORTS':'28010'}):
            with self.subTest(changes=changes),self.assertRaises(ValueError):runtime.configure(self.root,'stationeers',{**self.env,**changes})
    def test_stationeers_loader_confined_and_explicit(self):
        (self.root/'libdoorstop.so').write_bytes(b'loader');assembly=self.root/'BepInEx/core/BepInEx.Preloader.dll';assembly.parent.mkdir(parents=True);assembly.write_bytes(b'assembly')
        _,env,_,_,_=runtime.configure(self.root,'stationeers',{**self.env,'VOLTRA_STATIONEERS_VARIANT':'bepinex'})
        self.assertEqual(env['LD_PRELOAD'].split(':')[-1],str(self.root/'libdoorstop.so'));self.assertEqual(env['DOORSTOP_TARGET_ASSEMBLY'],str(assembly))
        assembly.unlink();assembly.symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):runtime.configure(self.root,'stationeers',{**self.env,'VOLTRA_STATIONEERS_VARIANT':'bepinex'})
    def test_stationeers_original_archive_missing_fails_before_steam(self):
        with patch.object(installer,'update',side_effect=AssertionError('missing framework must fail before game acquisition')):
            with self.assertRaisesRegex(ValueError,'publisher endpoint is unavailable'):installer.install(self.root,'stationeers',{'VOLTRA_STATIONEERS_VARIANT':'bepinex','STATIONEERS_MOD_FRAMEWORK':'stationeersmods'})
    def test_stationeers_mutually_exclusive_framework_preserves_old_plugin(self):
        old=self.root/'BepInEx/plugins/StationeersMods/StationeersMods.dll';old.parent.mkdir(parents=True);old.write_bytes(b'operator original framework')
        with patch.object(installer,'update',side_effect=AssertionError('conflict must fail before Steam')):
            with self.assertRaisesRegex(ValueError,'Conflicting'):installer.install(self.root,'stationeers',{'VOLTRA_STATIONEERS_VARIANT':'bepinex','STATIONEERS_MOD_FRAMEWORK':'launchpad'})
        self.assertEqual(old.read_bytes(),b'operator original framework')
    def test_framework_preserves_nested_resources_and_operator_changes(self):
        (self.root/'.voltra/stationeers').mkdir(parents=True,exist_ok=True);archive=self.root/'framework.zip'
        with zipfile.ZipFile(archive,'w')as source:
            source.writestr('StationeersMods/Loader.dll',b'loader');source.writestr('StationeersMods/resources/settings.json',b'{"publisher":true}');source.writestr('LICENSE',b'publisher license')
        receipt=installer.framework_overlay(self.root,archive,'stationeersmods',{})
        resource=self.root/'BepInEx/plugins/stationeersmods/StationeersMods/resources/settings.json';self.assertEqual(resource.read_bytes(),b'{"publisher":true}');resource.write_bytes(b'operator setting')
        installer.framework_overlay(self.root,archive,'stationeersmods',receipt);self.assertEqual(resource.read_bytes(),b'operator setting');self.assertTrue((self.root/'BepInEx/plugins/stationeersmods/LICENSE').is_file())
    def test_framework_prevalidates_all_members_before_publication(self):
        (self.root/'.voltra/stationeers').mkdir(parents=True,exist_ok=True);archive=self.root/'unsafe.zip'
        with zipfile.ZipFile(archive,'w')as source:source.writestr('Loader.dll',b'loader');source.writestr('../escape',b'bad')
        with self.assertRaisesRegex(ValueError,'Unsafe framework'):installer.framework_overlay(self.root,archive,'launchpad',{})
        self.assertFalse((self.root/'BepInEx').exists());self.assertFalse((self.root/'escape').exists())
    def test_wurm_original_settings_preserve_comments(self):
        target=self.root/'LaunchConfig.ini';target.write_text('# original\nUnknown=keep\nCleanLogsOnStart=true\n')
        argv,_,_,secrets,_=runtime.configure(self.root,'wurm',{**self.env,'SERVERNAME':'literal ; $safe','ADMINPWD':'private-admin','SERVERPWD':'private-server','EPIC':'true','PVP':'false','SERVER_CLEAN_LOGS_ON_START':'false'})
        self.assertIn('servername=literal ; $safe',argv);self.assertIn('adminpwd=private-admin',argv);self.assertIn('private-server',secrets);self.assertIn('Unknown=keep',target.read_text());self.assertIn('CleanLogsOnStart=false',target.read_text())
    def test_wurm_update_preserves_inode_and_permissions(self):
        path,database=self.world();before=database.stat()
        def publisher():
            self.assertFalse(path.exists());path.mkdir(parents=True);(path/'sqlite.db').write_bytes(b'publisher seed');return {'buildid':1}
        result=installer.preserve_wurm_update(self.root,{},publisher)
        self.assertEqual(result,{'buildid':1});self.assertEqual(database.read_bytes(),b'actual operator world');self.assertEqual(database.stat().st_ino,before.st_ino);self.assertEqual(database.stat().st_mode,before.st_mode);self.assertEqual(database.stat().st_uid,before.st_uid);self.assertEqual(database.stat().st_gid,before.st_gid)
        self.assertTrue(list((self.root/'.voltra/wurm/update-backups').rglob('publisher-new/dist/Adventure/sqlite.db')))
    def test_wurm_failed_acquisition_restores_world(self):
        _,database=self.world()
        def failure():raise RuntimeError('publisher unavailable')
        with self.assertRaisesRegex(RuntimeError,'publisher unavailable'):installer.preserve_wurm_update(self.root,{},failure)
        self.assertEqual(database.read_bytes(),b'actual operator world');self.assertFalse((self.root/'.voltra/wurm/preservation-pending.json').exists())
    def test_wurm_failed_second_quarantine_rolls_first_world_back(self):
        _,adventure=self.world();_,creative=self.world('dist/Creative');original=Path.rename;called=[]
        def rename(path,destination):
            if path==creative.parent:raise OSError('simulated second quarantine failure')
            return original(path,destination)
        with patch.object(Path,'rename',rename),self.assertRaisesRegex(OSError,'second quarantine'):
            installer.preserve_wurm_update(self.root,{},lambda:called.append(True))
        self.assertEqual(called,[]);self.assertEqual(adventure.read_bytes(),b'actual operator world');self.assertEqual(creative.read_bytes(),b'actual operator world')
    def test_wurm_mount_rejected_before_any_world_moves(self):
        _,database=self.world();called=[]
        with patch.object(installer.os.path,'ismount',return_value=True),self.assertRaisesRegex(ValueError,'mount'):
            installer.preserve_wurm_update(self.root,{},lambda:called.append(True))
        self.assertTrue(database.exists());self.assertEqual(called,[])
    def test_wurm_prevalidates_all_worlds_before_mutation(self):
        path,database=self.world();bad=self.root/'dist/Creative';bad.mkdir();(bad/'outside').symlink_to('/etc/passwd');called=[]
        with self.assertRaises(ValueError):installer.preserve_wurm_update(self.root,{},lambda:called.append(True))
        self.assertEqual(called,[]);self.assertTrue(database.exists());self.assertTrue(path.exists())
    def test_wurm_protected_and_overlapping_world_rejected(self):
        self.world()
        for name in ('../outside','.voltra/wurm','dist','/etc','WurmServerLauncher'):
            with self.subTest(name=name),self.assertRaises(ValueError):installer.preserve_wurm_update(self.root,{'SERVER_WORLD':name},lambda:None)
    def test_wurm_nested_world_collapses_into_preserved_parent(self):
        _,nested=self.world('dist/Creative/Nested');before=nested.stat().st_ino
        installer.preserve_wurm_update(self.root,{'SERVER_WORLD':'dist/Creative/Nested'},lambda:None)
        self.assertEqual(nested.read_bytes(),b'actual operator world');self.assertEqual(nested.stat().st_ino,before)
    def test_wurm_confined_absolute_and_backup_world_paths(self):
        self.assertEqual(installer.world_relative(self.root,'/home/container/dist/Adventure'),'dist/Adventure')
        self.assertEqual(installer.world_relative(self.root,str(self.root/'custom world')),'custom world')
        self.assertEqual(installer.world_relative(self.root,'backup/Adventure'),'backup/Adventure')
        with self.assertRaises(ValueError):installer.world_relative(self.root,'/etc')
    def test_starbound_json_unknown_fields_and_backups(self):
        target=self.root/'storage/starbound_server.config';target.parent.mkdir();target.write_text(json.dumps({'gameServerPort':21025,'serverUsers':{'operator':{'admin':True}},'operatorExtra':[1,2]}))
        runtime.configure(self.root,'starbound',self.env);data=json.loads(target.read_text());self.assertEqual(data['gameServerPort'],28010);self.assertTrue(data['serverUsers']['operator']['admin']);self.assertEqual(data['operatorExtra'],[1,2]);self.assertEqual(target.stat().st_mode&0o777,0o600);self.assertEqual(len(list((self.root/'.voltra/starbound/config-backups').glob('*.json'))),1)
    def test_starbound_missing_entitlement_fail_closed(self):
        with patch.object(installer,'update',side_effect=AssertionError('must not acquire without entitlement')):
            with self.assertRaisesRegex(ValueError,'entitled Steam account'):installer.install(self.root,'starbound',{})
    def test_workshop_links_preserve_operator_mods(self):
        mods=self.root/'mods';mods.mkdir();operator=mods/'operator.pak';operator.write_bytes(b'operator');source=self.root/'steamapps/workshop/content/211820/123';source.mkdir(parents=True);(source/'mod.pak').write_bytes(b'workshop')
        installer.workshop_links(self.root,'1');link=mods/'123_0.pak';self.assertTrue(link.is_symlink());self.assertEqual(link.read_bytes(),b'workshop');installer.workshop_links(self.root,'0');self.assertFalse(link.exists());self.assertEqual(operator.read_bytes(),b'operator')
    def test_workshop_conflict_and_external_directory_rejected(self):
        mods=self.root/'mods';mods.mkdir();source=self.root/'steamapps/workshop/content/211820/123';source.mkdir(parents=True);(source/'mod.pak').write_bytes(b'workshop');operator=mods/'123_0.pak';operator.write_bytes(b'operator')
        with self.assertRaisesRegex(ValueError,'operator'):installer.workshop_links(self.root,'1')
        self.assertEqual(operator.read_bytes(),b'operator');operator.unlink();mods.rmdir();mods.symlink_to('/tmp')
        with self.assertRaises(ValueError):installer.workshop_links(self.root,'0')


if __name__=='__main__':unittest.main()
