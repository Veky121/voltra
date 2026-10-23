import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('trucks',Path('internal/panel/game_library/scripts/truck-trackmania-native.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SII='SiiNunit\n{\nserver_config : _nameless.1 {\n connection_dedicated_port: 27015\n query_dedicated_port: 27016\n server_logon_token: ""\n lobby_name: "Original" // operator comment\n moderator_list: 1\n moderator_list[0]: 12345\n}\n}\n'
XML='<dedicated><!-- operator -->\n<masterserver_account><login></login><password></password></masterserver_account><server_options><name>old</name><comment>old</comment><password></password><max_players>32</max_players></server_options><system_config><server_port>2350</server_port><xmlrpc_port>5000</xmlrpc_port><xmlrpc_allowremote>False</xmlrpc_allowremote></system_config><authorization_levels><level><password>operator-secret</password></level></authorization_levels></dedicated>'

class Native(unittest.TestCase):
 def test_sii_preserves_moderators_comments_literal_strings(self):
  result=m.patch_sii('# operator prefix\n'+SII,{'connection_dedicated_port':28000,'query_dedicated_port':28001,'server_logon_token':'','lobby_name':'$ + " \\ &'})
  self.assertIn('lobby_name: "$ + \\" \\\\ &" // operator comment',result);self.assertIn('moderator_list[0]: 12345',result)
 def test_sii_duplicate_missing_and_wrong_units_fail(self):
  for content in [SII.replace(' lobby_name:', ' lobby_name: "duplicate"\n lobby_name:'),SII.replace(' lobby_name:',' ignored:'),SII.replace('server_config :','other :')]:
   with self.assertRaises(ValueError):m.patch_sii(content,{'lobby_name':'x'})
 def test_xml_managed_text_escaped_unknown_admin_rpc_preserved(self):
  result=m.patch_xml(XML,{'server_options':{'name':'$ + < & "'}})
  self.assertIn('<name>$ + &lt; &amp; "</name>',result);self.assertIn('operator-secret',result);self.assertIn('<xmlrpc_allowremote>False</xmlrpc_allowremote>',result);self.assertIn('<!-- operator -->',result)
 def test_xml_external_entity_duplicate_field_and_comment_spoof_rejected(self):
  for content in ['<dedicated>broken','<!DOCTYPE dedicated [<!ENTITY a SYSTEM "file:///etc/passwd">]>'+XML,XML.replace('<name>old</name>','<name>one</name><name>two</name>'),XML.replace('<name>old</name>','<!-- <name>fake</name> --><name>old</name>')]:
   with self.assertRaises(ValueError):m.patch_xml(content,{'server_options':{'name':'x'}})
 def test_ports_are_distinct_allocated_and_validate_ranges(self):
  self.assertEqual(m.ports({'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001'}),(28000,28001))
  for extra in [{'QUERY_PORT':'28000'},{'QUERY_PORT':'28002'},{'VOLTRA_ALLOCATED_PORTS':'28000,65536'}]:
   with self.assertRaises(ValueError):m.ports({'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001',**extra})
 def test_packages_and_metadata_restore_even_failed_update(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);file=root/'.local/share/American Truck Simulator/server_packages.dat';file.parent.mkdir(parents=True);file.write_bytes(b'operator\x00\xff');file.chmod(0o640);os.utime(file,ns=(123456789000,987654321000))
   with self.assertRaises(RuntimeError):
    with m.preserve(root):file.write_bytes(b'replaced');file.chmod(0o777);raise RuntimeError('real install failed')
   self.assertEqual(file.read_bytes(),b'operator\x00\xff');self.assertEqual(file.stat().st_mode&0o777,0o640);self.assertEqual(file.stat().st_mtime_ns,987654321000)
 def test_symlinks_are_rejected_before_native_config_writes(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'escape').symlink_to('/tmp')
   with self.assertRaises(ValueError):m.confined(root,root/'escape/server.cfg')
 def test_operator_executable_and_bom_xml_are_preserved(self):
  self.assertIn('operator',m.patch_xml('\ufeff<?xml version="1.0"?>\n'+XML,{'server_options':{'name':'operator'}}))
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);script=root/'operator.sh';script.write_bytes(b'#!/bin/sh\noperator-content\n');script.chmod(0o750)
   with m.preserve(root):script.write_bytes(b'publisher-overwrite');script.chmod(0o600)
   self.assertEqual(script.read_bytes(),b'#!/bin/sh\noperator-content\n');self.assertEqual(script.stat().st_mode&0o777,0o750)
 def test_missing_scs_config_uses_native_firstboot_not_fake_exports(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);argv,secrets=m.configure(root,'ats',{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001'})
   self.assertTrue(argv[0].endswith('/bin/linux_x64/amtrucks_server'));self.assertFalse(list(root.rglob('server_packages*')))
 def test_trackmania_settings_path_cannot_escape_and_password_not_in_argv(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);f=root/'UserData/Config/dedicated_cfg.txt';f.parent.mkdir(parents=True);f.write_text(XML)
   env={'SERVER_PORT':'28000','MASTERSERVER_LOGIN':'','MASTERSERVER_PASSWORD':'','SERVER_PASSWORD':'private'}
   argv,secrets=m.configure(root,'trackmania',env);self.assertNotIn('private',' '.join(argv));self.assertIn('private',secrets)
   for path in ['../escape','/tmp/escape','C:\\escape']:
    with self.assertRaises(ValueError):m.configure(root,'trackmania',{**env,'GAME_CONFIG':path})
   (root/'UserData/Maps').mkdir();(root/'UserData/Maps/escape').symlink_to('/tmp')
   with self.assertRaises(ValueError):m.configure(root,'trackmania',{**env,'GAME_CONFIG':'escape/operator.txt'})

unittest.main()
