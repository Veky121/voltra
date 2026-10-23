"""Offline settings and preservation fixtures; native evidence is separate."""
import importlib.util
import hashlib
import itertools
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'internal/panel/game_library/scripts'
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/file);value=importlib.util.module_from_spec(spec);sys.modules[name]=value;spec.loader.exec_module(value);return value
load('steam_template','steam-template.py');load('additional_survival_install','additional-survival-install.py');load('native_console','native-console.py')
installer=load('strategy_survival_install','strategy-survival-install.py');cryo=load('cryofall_runtime','cryofall-runtime.py');nss=load('private_nss','private-nss.py');avo=load('avorion_runtime','avorion-runtime.py')

class StrategySurvivalTests(unittest.TestCase):
    def test_private_nss_verified_cache_needs_no_apt_and_tampering_cannot_hit_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);target=root/'.voltra/nss';target.mkdir(parents=True)
            contents={'libnss_wrapper.so':b'library fixture','copyright':b'license fixture'}
            files={name:('unused/'+name,hashlib.sha256(content).hexdigest()) for name,content in contents.items()}
            for name,content in contents.items():(target/name).write_bytes(content)
            (target/'package.txt').write_bytes(nss.PACKAGE_RECEIPT)
            with patch.object(nss,'FILES',files),patch.object(nss.subprocess,'run',side_effect=RuntimeError('APT fixture intercepted')) as apt:
                nss.provision(root);apt.assert_not_called()
                (target/'libnss_wrapper.so').write_bytes(b'tampered')
                with self.assertRaisesRegex(RuntimeError,'APT fixture intercepted'):nss.provision(root)
                apt.assert_called_once()
    def test_private_nss_confines_identity_preloads_and_leaves_parent_environment_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/'bin/AvorionServer';binary.parent.mkdir();binary.write_bytes(b'fixture')
            library=root/'.voltra/nss/libnss_wrapper.so';library.parent.mkdir(parents=True);library.write_bytes(b'fixture')
            original={'LD_PRELOAD':'untrusted-parent.so','KEEP':'yes'}
            result=nss.native_environment(root,original,binary,'bin/AvorionServer')
            self.assertEqual(original['LD_PRELOAD'],'untrusted-parent.so');self.assertEqual(result['LD_PRELOAD'],str(library))
            self.assertEqual((library.parent/'passwd').read_text(),f'voltra:x:{os.getuid()}:{os.getgid()}:Native server:{root}:/bin/sh\n')
            self.assertEqual((library.parent/'passwd').stat().st_mode&0o777,0o600)
            with self.assertRaises(ValueError):nss.native_environment(root,original,binary,'bin/Other')
            with self.assertRaises(ValueError):nss.native_environment(root,original,binary,'bin/AvorionServer',['/lib/global.so'])
    def test_cryofall_preserves_native_guid_unknown_comments_operators_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'Data/SettingsServer.xml';path.parent.mkdir()
            path.write_text('<settings version="20"><!-- operator --><network><server_private_guid>private-fixture-guid</server_private_guid></network><server><name>old</name><server_operators_list>ExistingOperator</server_operators_list><custom_native_option>preserved</custom_native_option></server></settings>');path.chmod(0o640)
            argv,env=cryo.configure(root,{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','SERVER_NAME':'Literal $ & " name'})
            tree=ET.fromstring(path.read_bytes())
            self.assertEqual(tree.find('server/name').text,'Literal $ & " name');self.assertEqual(tree.find('network/port').text,'28010')
            self.assertEqual(tree.find('network/server_private_guid').text,'private-fixture-guid');self.assertEqual(tree.find('server/server_operators_list').text,'ExistingOperator')
            self.assertIn('<!-- operator -->',path.read_text());self.assertEqual(path.stat().st_mode&0o777,0o640)
            self.assertEqual(argv[-1],'loadOrNew');self.assertEqual(env['DOTNET_ROLL_FORWARD'],'LatestPatch')
            self.assertTrue(list((root/'.voltra/cryofall/config-backups').glob('*')))
    def test_cryofall_rejects_unallocated_ports_duplicate_xml_and_dtd(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'Data/SettingsServer.xml';path.parent.mkdir()
            for content in ['<settings><network><port>1</port><port>2</port></network></settings>','<!DOCTYPE settings [<!ENTITY test "bad">]><settings/>']:
                path.write_text(content)
                with self.assertRaises(ValueError):cryo.configure(root,{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010'})
            path.write_bytes('<?xml version="1.0" encoding="utf-16"?><!DOCTYPE settings><settings/>'.encode('utf-16'))
            with self.assertRaises(ValueError):cryo.configure(root,{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010'})
            path.unlink()
            with self.assertRaises(ValueError):cryo.configure(root,{'SERVER_PORT':'28011','VOLTRA_ALLOCATED_PORTS':'28010'})
    def test_avorion_explicit_secondary_allocations_are_reserved_before_auto_assignment(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for explicit in (28011,28012,28013):
                args,_=avo.arguments(root,{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013','STEAM_QUERY_PORT':str(explicit)})
                self.assertEqual(args[args.index('--steam-query-port')+1],str(explicit))
                ports=[int(args[args.index(key)+1]) for key in ('--port','--query-port','--steam-master-port','--steam-query-port')]
                self.assertEqual(set(ports),{28010,28011,28012,28013})
    def test_avorion_original_controls_are_separate_tokens_without_shell_interpolation(self):
        with tempfile.TemporaryDirectory() as directory:
            env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013','GALAXY_NAME':'Galaxy $ literal','SERVER_NAME':'Name "; /stop; " $literal','ADMIN_ID':'76561198000000000','MAX_PLAYERS':'4','DIFFICULTY':'-3','COLLISION_DMG':'0.5','SAVE_INTERVAL':'17','SAME_START_SECTOR':'false','GAME_THREADS':'2','SERVER_LISTED':'false'}
            args,child=avo.arguments(Path(directory),env)
            for key,value in [('--galaxy-name',env['GALAXY_NAME']),('--server-name',env['SERVER_NAME']),('--admin',env['ADMIN_ID']),('--difficulty','-3'),('--collision-damage','0.5'),('--save-interval','17'),('--same-start-sector','false'),('--threads','2'),('--listed','false')]:self.assertEqual(args[args.index(key)+1],value)
            self.assertNotIn('PYTHONHOME',child)
    def test_avorion_rejects_bad_ports_paths_nonfinite_values_and_invalid_admin(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);base={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013'}
            for change in [{'QUERY_PORT':'28010'},{'QUERY_PORT':'28011','STEAM_QUERY_PORT':'28011'},{'GALAXY_NAME':'../escape'},{'COLLISION_DMG':'nan'},{'ADMIN_ID':'not-a-steam-id'},{'SERVER_LISTED':'yes'},{'VOLTRA_NATIVE_LIBRARY_PATH':'/etc'}]:
                with self.assertRaises(ValueError):avo.arguments(root,{**base,**change})
    def test_steam_failure_restores_operator_content_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'Data/SettingsServer.xml';path.parent.mkdir();path.write_bytes(b'operator-data');path.chmod(0o640)
            original=installer.update
            def fail(*args,**kwargs):path.write_bytes(b'publisher-default');path.chmod(0o644);raise RuntimeError('Fixture failure')
            installer.update=fail
            try:
                with self.assertRaises(RuntimeError):installer.install(root,'cryofall',{})
            finally:installer.update=original
            self.assertEqual(path.read_bytes(),b'operator-data');self.assertEqual(path.stat().st_mode&0o777,0o640)
    def test_profiles_preserve_every_original_variable_and_existing_root_status(self):
        catalog=json.loads((ROOT/'internal/panel/game_library/upstream/catalog.json').read_text());previous=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())
        profiles=json.loads((ROOT/'.local/strategy-survival-games/profiles.json').read_text())
        for path,profile in profiles.items():
            entry=next(x for x in catalog['entries'] if x['path']==path)
            self.assertEqual(profile['upstream_sha256'],entry['sha256']);self.assertEqual(profile['verification'],previous.get(path,{}).get('verification','not_verified'))
            names={v['env_variable'] for v in profile['egg']['variables']};self.assertTrue(all(v['env_variable'] in names for v in entry['egg']['variables']))
        avorion=profiles['avorion/egg-avorion.json']
        self.assertEqual(avorion['required_ports'],4)
        self.assertEqual(next(v for v in avorion['egg']['variables'] if v['env_variable']=='QUERY_PORT')['default_value'],'27003')
        self.assertEqual({r['environment'] for r in avorion['port_rules'] if r['allocated_value']},{'QUERY_PORT','STEAM_MASTER_PORT','STEAM_QUERY_PORT'})

if __name__=='__main__':unittest.main()
