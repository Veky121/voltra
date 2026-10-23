"""Offline GTA configuration fixtures, separate from native acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name):
    spec=importlib.util.spec_from_file_location(name,BASE/(name+'.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
runtime=load('gta-runtime');installer=load('gta-install')

class GTAFixtures(unittest.TestCase):
    def test_openmp_preserves_scripts_plugins_native_options(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'openmp').mkdir();path=root/'openmp/config.json'
            original={'network':{'custom':'operator'},'pawn':{'main_scripts':['custom-mode 1'],'side_scripts':['fs'],'legacy_plugins':['plugin.so']},'artwork':{'enable':True,'cdn':'https://example.invalid/models'}}
            path.write_text(json.dumps(original))
            config,password=runtime.configure_openmp(root,{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000','SERVER_NAME':'quotes " $ +','RCON_PASSWORD':'fixture-local-only'})
            self.assertEqual(config['pawn'],original['pawn']);self.assertEqual(config['network']['custom'],'operator');self.assertEqual(config['artwork']['cdn'],original['artwork']['cdn'])
            self.assertEqual(config['name'],'quotes " $ +');self.assertEqual(config['artwork']['port'],28000);self.assertEqual(password,'fixture-local-only')

    def test_generated_local_rcon_is_private_and_persistent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'openmp').mkdir();(root/'openmp/config.json').write_text('{}');env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000'}
            first=runtime.configure_openmp(root,env)[1];second=runtime.configure_openmp(root,env)[1]
            self.assertEqual(first,second);self.assertEqual(len(first),32);self.assertEqual((root/'.voltra/openmp/rcon-password').stat().st_mode&0o777,0o600)

    def test_managed_port_must_be_allocated(self):
        with self.assertRaises(ValueError):runtime.allocated({'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28001'})

    def test_mta_config_comments_acl_resources_and_custom_http_retained(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);path=root/'mtasa/mods/deathmatch/mtaserver.conf';path.parent.mkdir(parents=True)
            path.write_text('<config><!-- operator --><resource src="my-resource" startup="1"/><acl>acl-custom.xml</acl><httpserver>0</httpserver></config>')
            result=runtime.configure_mtasa(root,{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28030','SERVER_WEBPORT':'28030','SERVER_NAME':'quotes " < & $'})
            self.assertEqual(result,{'primary':28000,'http':28030,'ase':None});self.assertIn('<!-- operator -->',path.read_text())
            xml=ET.fromstring(path.read_text());self.assertEqual(xml.findtext('httpserver'),'0');self.assertEqual(xml.find('resource').attrib['src'],'my-resource');self.assertEqual(xml.findtext('servername'),'quotes " < & $')

    def test_mta_ase_offset_and_http_are_distinct_even_when_ase_sorts_first(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);path=root/'mtasa/mods/deathmatch/mtaserver.conf';path.parent.mkdir(parents=True);path.write_text('<config/>')
            result=runtime.configure_mtasa(root,{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28123,29000','ASE_ENABLED':'1','SERVER_WEBPORT':'0'})
            self.assertEqual(result['http'],29000);self.assertEqual(result['ase'],28123)
            for ports in ['28000,28001','28000,28123']:
                with self.assertRaises(ValueError):runtime.configure_mtasa(root,{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':ports,'ASE_ENABLED':'1'})

    def test_xml_entities_and_duplicate_managed_fields_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);path=root/'mtasa/mods/deathmatch/mtaserver.conf';path.parent.mkdir(parents=True)
            for xml in ['<!DOCTYPE config [<!ENTITY x SYSTEM "file:///etc/passwd">]><config/>','<config><serverport>1</serverport><serverport>2</serverport></config>']:
                path.write_text(xml)
                with self.assertRaises(ValueError):runtime.configure_mtasa(root,{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001'})

    def test_invalid_numeric_and_control_values_rejected(self):
        for value in ['-1','1;exit','１２','65536','0']:
            with self.assertRaises(ValueError):runtime.number({'PORT':value},'PORT',7777)
        with self.assertRaises(ValueError):runtime.text({'NAME':'x\nexit'},'NAME')

    def test_pinned_release_without_network_and_bad_version_not_silently_fallback(self):
        with patch.object(installer.urllib.request,'urlopen',side_effect=AssertionError('network')):
            self.assertEqual(installer.resolve_openmp('v1.6.7.3218'),installer.OPENMP)
            with self.assertRaises(ValueError):installer.resolve_openmp('$(touch x)')

    def test_legacy_import_copies_custom_resource_and_native_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'.voltra/mtasa').mkdir(parents=True);(root/'mods/deathmatch/resources/custom').mkdir(parents=True)
            source=root/'mods/deathmatch/resources/custom/server.lua';source.write_text('operator-marker');source.chmod(0o640)
            installer.migrate(root,'mtasa',['mods']);target=root/'mtasa/mods/deathmatch/resources/custom/server.lua'
            self.assertEqual(target.read_text(),'operator-marker');self.assertEqual(target.stat().st_mode&0o777,0o640);self.assertTrue(source.exists())
            target.write_text('updated');installer.migrate(root,'mtasa',['mods']);self.assertEqual(target.read_text(),'updated')

    def test_shared_console_receives_bytes_ready_markers(self):
        class Console:
            def run(self,root,argv,environment,stop,**options):
                self_test.assertIsInstance(options['ready_marker'],bytes)
                self_test.assertIn(stop,['exit','shutdown']);return 0
        self_test=self
        for game in ['openmp','mtasa']:
            with patch.object(runtime,'configure_openmp',return_value=({},'fixture')),patch.object(runtime,'configure_mtasa',return_value={}),patch.object(runtime,'module',return_value=Console()):
                self.assertEqual(runtime.run(game,Path('/tmp'),{}),0)

    def test_cache_and_installer_state_cannot_escape_volume(self):
        with tempfile.TemporaryDirectory() as temporary,tempfile.TemporaryDirectory() as outside:
            root=Path(temporary);(root/'.voltra').symlink_to(outside)
            with self.assertRaises(ValueError):installer.identified_download_cache(root,installer.MTA)
            self.assertFalse((Path(outside)/'public-cache').exists())
            with self.assertRaises(ValueError):installer.install('mtasa',root,{})

if __name__=='__main__':unittest.main()
