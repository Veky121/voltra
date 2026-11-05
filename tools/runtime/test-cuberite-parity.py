import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('runtime',Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts/cuberite-parity-runtime.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
ENV={'SERVER_PORT':'28000','WEB_PORT':'28001','SERV_DESC':'seed','ADMIN_PASS':'private-fixture-value'}
class FileAuthority(unittest.TestCase):
 def test_native_alias_values_preserved_with_literal_port_name(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)
   (root/'settings.ini').write_bytes(b'; operator\r\n[server]\r\nports=28000\r\ndescription=operator\r\n')
   (root/'webadmin.ini').write_bytes(b'[webadmin]\nports=28001\n[user:admin]\npassword=operator-private-existing\n')
   before={p.name:p.read_bytes() for p in root.iterdir()}
   r.configure(root,{**ENV,'SERV_DESC':'must not replace','ADMIN_PASS':'must-not-replace-this'})
   self.assertEqual({name:body.replace(b'ports=',b'Ports=') for name,body in before.items()},
                    {p.name:p.read_bytes() for p in root.iterdir()})
 def test_publisher_port_upgrade_enumerator_requires_literal_ports(self):
  # Pinned IniFile.cpp755-789 enumerates names and compares pair.first to
  # literal Ports; general case-insensitive GetValue does not apply here.
  def selected(text,section,default):
   return next((value for (s,k),items in r.values(text).items()
                if r.native_case(s)==r.native_case(section) and k=='Ports' for value in items),default)
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)
   (root/'settings.ini').write_bytes(b'; keep\r\n[sErVeR]\r\npOrTs=28000\r\ndescription=operator\r\n')
   (root/'webadmin.ini').write_bytes(b'[webadmin]\nPORTS=28001\n[User:admin]\npassword=operator-private-existing\n')
   before={p.name:p.read_bytes() for p in root.iterdir()}
   self.assertEqual(selected(before['settings.ini'].decode(),'Server','25565'),'25565')
   self.assertEqual(selected(before['webadmin.ini'].decode(),'WebAdmin','8080'),'8080')
   r.configure(root,{**ENV,'SERV_DESC':'ignored','ADMIN_PASS':'ignored-long-password'})
   self.assertEqual((root/'settings.ini').read_bytes(),before['settings.ini'].replace(b'pOrTs=',b'Ports='))
   self.assertEqual((root/'webadmin.ini').read_bytes(),before['webadmin.ini'].replace(b'PORTS=',b'Ports='))
   self.assertEqual(selected((root/'settings.ini').read_text(),'Server','25565'),'28000')
   self.assertEqual(selected((root/'webadmin.ini').read_text(),'WebAdmin','8080'),'28001')
 def test_mixed_case_managed_duplicates_refuse_before_writes(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);r.configure(root,ENV)
   p=root/'settings.ini';p.write_bytes(p.read_bytes()+b'[server]\nports=28000\n')
   before={p.name:p.read_bytes() for p in root.iterdir()}
   with self.assertRaises(ValueError):r.configure(root,ENV)
   self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir()})
 def test_missing_key_seeds_original_case_section_with_bom_and_comments(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)
   original=b'\xef\xbb\xbf[server] ; operator header\r\nports=28000\r\n[Plugins]\r\nPlugin=Core\r\nPlugin=ChatLog\r\n'
   (root/'settings.ini').write_bytes(original)
   (root/'webadmin.ini').write_bytes(b'[webadmin]\nports=28001\n[user:admin]\npassword=operator-private-existing\n')
   web=(root/'webadmin.ini').read_bytes();r.configure(root,ENV)
   self.assertEqual((root/'settings.ini').read_bytes(),original.replace(b'header\r\n',b'header\r\nDescription=seed\r\n').replace(b'ports=',b'Ports='))
   self.assertEqual((root/'webadmin.ini').read_bytes(),web.replace(b'ports=',b'Ports='))
 def test_padded_managed_port_refuses_without_writes(self):
  for key in ('Ports ', ' Ports', 'ports\t'):
   with self.subTest(key=key),tempfile.TemporaryDirectory() as d:
    root=Path(d);r.configure(root,ENV);file=root/'settings.ini'
    file.write_bytes(file.read_bytes().replace(b'Ports=',key.encode()+b'='))
    before={p.name:p.read_bytes() for p in root.iterdir()}
    with self.assertRaises(ValueError):r.configure(root,ENV)
    self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir()})
 def test_padded_private_key_refuses_without_writes(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);r.configure(root,ENV);file=root/'webadmin.ini'
   file.write_bytes(file.read_bytes().replace(b'Password=',b'Password ='))
   before={p.name:p.read_bytes() for p in root.iterdir()}
   with self.assertRaises(ValueError):r.configure(root,ENV)
   self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir()})
 def test_case_alias_port_mismatch_refuses_without_changes(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)
   (root/'settings.ini').write_bytes(b'[SERVER]\npOrTs=28002\ndescription=operator\n')
   before={p.name:p.read_bytes() for p in root.iterdir()}
   with self.assertRaises(ValueError):r.configure(root,ENV)
   self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir()})
 def test_lowercase_native_password_keeps_minimum_validation(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);r.configure(root,ENV)
   (root/'webadmin.ini').write_bytes(b'[webadmin]\nports=28001\n[user:admin]\npassword=short\n')
   before={p.name:p.read_bytes() for p in root.iterdir()}
   with self.assertRaises(ValueError):r.configure(root,ENV)
   self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir()})
 def test_seed_and_byte_preservation(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);r.configure(root,ENV)
   p=root/'settings.ini';p.write_text(p.read_text()+'[Plugins]\nPlugin=Core\nPlugin=ChatLog\n[Unknown]\nKey=opaque $ value\n')
   before={f.name:f.read_bytes() for f in root.iterdir()}
   r.configure(root,{**ENV,'SERV_DESC':'must not replace','ADMIN_PASS':''})
   self.assertEqual(before,{f.name:f.read_bytes() for f in root.iterdir()})
 def test_failures_do_not_rewrite(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);r.configure(root,ENV);p=root/'settings.ini';before=p.read_bytes()
   with self.assertRaises(ValueError):r.configure(root,{**ENV,'SERVER_PORT':'28002'})
   self.assertEqual(before,p.read_bytes())
   p.write_bytes(before+b'[Server]\nPorts=28000\n');before=p.read_bytes()
   with self.assertRaises(ValueError):r.configure(root,ENV)
   self.assertEqual(before,p.read_bytes())
 def test_fresh_installer_seed_and_existing_file(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'settings.ini').write_text('[Server]\nPorts=25565\nDescription=publisher\n[Plugins]\nPlugin=Core\nPlugin=ChatLog\n')
   r.configure(root,ENV,['settings.ini']);self.assertIn('Description=seed',(root/'settings.ini').read_text())

import runpy
import sys
from types import ModuleType
from unittest.mock import Mock, patch

class InstallPreflight(unittest.TestCase):
 def invoke(self, root, env, acquire):
  module=ModuleType('cuberite_install');module.install=acquire
  with patch.dict(sys.modules, {'cuberite_install':module,'cuberite_parity_runtime':r}), patch.dict('os.environ',env,clear=True), patch('pathlib.Path.cwd',return_value=root):
   runpy.run_path(str(Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts/cuberite-parity-install.py'),run_name='__main__')
 def test_invalid_settings_never_acquire_or_publish(self):
  for existing in (False,True):
   for invalid in ({'WEB_PORT':'invalid'},{'ADMIN_PASS':'short'},{'SERVER_PORT':'28002'}):
    if not existing and 'SERVER_PORT' in invalid:continue
    with self.subTest(existing=existing,invalid=list(invalid)),tempfile.TemporaryDirectory() as d:
     root=Path(d)
     if existing:
      r.configure(root,ENV)
      (root/'Cuberite').write_bytes(b'original binary');(root/'.voltra/cuberite').mkdir(parents=True);(root/'.voltra/cuberite/release.json').write_bytes(b'original receipt')
      if 'ADMIN_PASS' in invalid:
       (root/'webadmin.ini').write_text('[WebAdmin]\nPorts=28001\n[User:admin]\nPassword=short\n')
     before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
     paths={str(p.relative_to(root)) for p in root.rglob('*')}
     acquire=Mock()
     with self.assertRaises(ValueError):self.invoke(root,{**ENV,**invalid},acquire)
     acquire.assert_not_called()
     self.assertEqual(before,{str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})
     self.assertEqual(paths,{str(p.relative_to(root)) for p in root.rglob('*')})
 def test_case_alias_duplicate_preflight_never_acquires(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);r.configure(root,ENV)
   p=root/'settings.ini';p.write_bytes(p.read_bytes()+b'[server]\nPORTS=28000\n')
   before={p.name:p.read_bytes() for p in root.iterdir()};acquire=Mock()
   with self.assertRaises(ValueError):self.invoke(root,ENV,acquire)
   acquire.assert_not_called();self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir()})
 def test_padded_native_keys_never_acquire(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);r.configure(root,ENV);file=root/'settings.ini'
   file.write_bytes(file.read_bytes().replace(b'Ports=',b'Ports ='))
   before={p.name:p.read_bytes() for p in root.iterdir()};acquire=Mock()
   with self.assertRaises(ValueError):self.invoke(root,ENV,acquire)
   acquire.assert_not_called();self.assertEqual(before,{p.name:p.read_bytes() for p in root.iterdir()})
 def test_valid_fresh_defaults_then_repeat_preserves_authority(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)
   def defaults(root):
    for name,content in [('settings.ini','[Server]\nPorts=25565\nDescription=publisher\n[Plugins]\nPlugin=Core\nPlugin=ChatLog\n'),('webadmin.ini','[WebAdmin]\nPorts=8080\nEnabled=1\n[User:admin]\nPassword=\n')]:
     if not (root/name).exists():(root/name).write_text(content)
   acquire=Mock(side_effect=defaults);self.invoke(root,ENV,acquire);acquire.assert_called_once_with(root)
   self.assertIn('Ports=28000',(root/'settings.ini').read_text())
   before={p.name:(p.read_bytes(),p.stat().st_mode) for p in root.iterdir()}
   self.invoke(root,{**ENV,'SERV_DESC':'ignored','ADMIN_PASS':''},acquire)
   self.assertEqual(before,{p.name:(p.read_bytes(),p.stat().st_mode) for p in root.iterdir()})

 def test_valid_real_checked_installer_control_flow(self):
  spec=importlib.util.spec_from_file_location('ownership_fixture',Path(__file__).with_name('test-cuberite-install.py'))
  fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
  case=fixture.CuberiteOwnership();case.setUp()
  try:
   with tempfile.TemporaryDirectory() as d:
    root=Path(d)
    acquire=Mock(side_effect=lambda root:fixture.c.install(root,case.fetch))
    self.invoke(root,ENV,acquire)
    self.assertTrue((root/'.voltra/cuberite/release.json').is_file())
    before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
    self.invoke(root,{**ENV,'ADMIN_PASS':'','SERV_DESC':'ignored'},acquire)
    self.assertEqual(before,{str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})
  finally:case.doCleanups()
 def test_directory_refused_before_acquisition(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'webadmin.ini').mkdir();acquire=Mock()
   with self.assertRaises(ValueError):self.invoke(root,ENV,acquire)
   acquire.assert_not_called();self.assertEqual(['webadmin.ini'],[p.name for p in root.iterdir()])

if __name__=='__main__':unittest.main()
