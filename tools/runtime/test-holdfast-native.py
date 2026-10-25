import importlib.util
import io
import os
from pathlib import Path
import tempfile
import time
import types
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('holdfast_candidate',Path('internal/panel/game_library/scripts/steam-native-next.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
console=m.helper('native-console')
class Output:
 def __init__(self):self.buffer=io.BytesIO()
class Holdfast(unittest.TestCase):
 def test_rotations_apply_typed_player_limit_and_retain_operator_lines(self):
  original='# operator\nimport private/global.txt\nmaximum_players 42\n!map_rotation start\nmap_name PalisadeArena\nmaximum_players 150\nunknown_literal $value\n!map_rotation end\n!map_rotation start\nmap_name SnowyPlains\nmaximum_players 90 # operator old managed value\n!map_rotation end\n'
  actual=m.patch_holdfast(original,{'maximum_players':8,'server_name':'native'})
  self.assertEqual(actual.count('maximum_players 8\n'),3)
  self.assertIn('unknown_literal $value\n',actual);self.assertIn('import private/global.txt',actual)
  self.assertIn('map_name PalisadeArena',actual);self.assertIn('map_name SnowyPlains',actual)
  self.assertEqual(m.patch_holdfast(actual,{'maximum_players':8,'server_name':'native'}),actual)
 def test_log_forwards_actual_bytes_redacts_and_ignores_old_file(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);p=root/'logs/output.txt';p.parent.mkdir();p.write_bytes(b'old STEAMAPPS_INTERFACE_VERSION008\n')
   output=Output()
   with patch.object(m.sys,'stdout',output):
    log=m.HoldfastLog(root,p,console,['secret-password']);log.start();time.sleep(.12)
    self.assertEqual(output.buffer.getvalue(),b'')
    p.write_bytes(b'actual STEAMAPPS_INTERFACE_VERSION008 secret-password\n');time.sleep(.12);log.finish()
   result=output.buffer.getvalue();self.assertIn(b'actual STEAMAPPS_INTERFACE_VERSION008',result);self.assertNotIn(b'secret-password',result);self.assertNotIn(b'old ',result)
 def test_log_rotation_truncation_and_symlink_rejection(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);p=root/'output';output=Output()
   with patch.object(m.sys,'stdout',output):
    log=m.HoldfastLog(root,p,console,[]);log.start();p.write_bytes(b'one\n');time.sleep(.12);p.rename(root/'old');p.write_bytes(b'two\n');time.sleep(.12);p.write_bytes(b'3\n');time.sleep(.12);log.finish()
   self.assertEqual(output.buffer.getvalue(),b'one\ntwo\n3\n')
   p.unlink();p.symlink_to(root/'old')
   with self.assertRaises(OSError):m.HoldfastLog(root,p,console,[])
   p.unlink();(root/'directory').mkdir();p.symlink_to(root/'directory',target_is_directory=True)
   with self.assertRaises(OSError):m.HoldfastLog(root,p/'file',console,[])
 def test_prior_ready_marker_is_not_replayed_when_existing_log_is_appended(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);p=root/'output';p.write_bytes(b'old STEAMAPPS_INTERFACE_VERSION008\n');output=Output()
   with patch.object(m.sys,'stdout',output):
    log=m.HoldfastLog(root,p,console,[]);log.start()
    with p.open('ab')as f:f.write(b'new nonready startup\n')
    time.sleep(.12)
    self.assertNotIn(b'STEAMAPPS_INTERFACE_VERSION008',output.buffer.getvalue())
    with p.open('ab')as f:f.write(b'fresh STEAMAPPS_INTERFACE_VERSION008\n')
    time.sleep(.12);log.finish()
   self.assertEqual(output.buffer.getvalue(),b'new nonready startup\nfresh STEAMAPPS_INTERFACE_VERSION008\n')
 def test_actual_redactor_masks_full_character_and_utf8_byte_clips_chunked(self):
  fixtures=['Synthetic-credential-ABCDEFGHIJKL-extra-tail', 'unicode-'+'\u00e9'*30+'tail', 'A'*31+'\u20ac-synthetic-tail', '\U0001f600'*20+'-tail']
  self.assertTrue(any(secret[:32].encode('utf-8')!=secret.encode('utf-8')[:32]for secret in fixtures))
  self.assertTrue(any(len(secret.encode('utf-8')[:32].decode('utf-8',errors='ignore').encode('utf-8'))<len(secret.encode('utf-8')[:32])for secret in fixtures))
  for secret in fixtures:
   values=m.holdfast_redaction_values([secret,''])
   self.assertIn(secret,values);self.assertIn(secret[:32],values)
   complete_prefix=secret.encode('utf-8')[:32].decode('utf-8',errors='ignore')
   self.assertIn(complete_prefix,values)
   for emitted in [secret.encode('utf-8'),secret[:32].encode('utf-8'),secret.encode('utf-8')[:32]]:
    redactor=console.Redactor(values)
    output=b''.join(redactor.feed(bytes([byte]))for byte in b'prefix '+emitted+b' suffix')+redactor.feed(b'',final=True)
    self.assertNotIn(emitted,output);self.assertNotIn(complete_prefix.encode('utf-8'),output);self.assertIn(b'[redacted]',output)
 def test_holdfast_prefixes_do_not_mutate_values_or_original_password_rules(self):
  original=['synthetic-'+'x'*40,'unicode-'+'\u00e9'*30];snapshot=list(original)
  expanded=m.holdfast_redaction_values(original);self.assertEqual(original,snapshot);self.assertTrue(all(isinstance(v,str)for v in expanded))
  with tempfile.TemporaryDirectory()as tmp:
   root=Path(tmp);target=root/'holdfastnaw-dedicated/configs/operator.txt';target.parent.mkdir(parents=True);target.write_text('!map_rotation start\nmap_name operator_map\n!map_rotation end\n')
   argv,secrets=m.configure(root,'holdfast',{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','SERVER_CONFIG_PATH':'operator.txt','ADMIN_PASS':original[0],'SERVER_PASS':original[1]})
   text=target.read_text();self.assertIn('server_admin_password '+original[0],text);self.assertIn('server_password '+original[1],text);self.assertEqual(secrets,original)
 def test_holdfast_run_uses_same_expanded_credentials_for_log_and_console(self):
  from unittest.mock import Mock
  original=['synthetic-'+'x'*40,'unicode-'+'\u00e9'*30];expected=m.holdfast_redaction_values(original)
  fake=Mock();fake.run.return_value=0
  with tempfile.TemporaryDirectory()as tmp,patch.object(m,'configure',return_value=(['native','-logFile',str(Path(tmp)/'native.log')],original)),patch.object(m,'helper',return_value=fake),patch.object(m,'HoldfastLog')as log:
   self.assertEqual(m.run(Path(tmp),'holdfast',{}),0)
   self.assertEqual(fake.run.call_args.args[4],expected);self.assertEqual(log.call_args.args[3],expected)
   log.return_value.start.assert_called_once();log.return_value.finish.assert_called_once()
 def test_other_family_run_contract_unchanged(self):
  from unittest.mock import Mock
  for game in ['colony','hurtworld','rising']:
   fake=Mock();fake.run.return_value=-2
   with tempfile.TemporaryDirectory() as tmp,patch.object(m,'configure',return_value=(['native'],[])),patch.object(m,'helper',return_value=fake) as lookup:
    self.assertEqual(m.run(Path(tmp),game,{}),130);lookup.assert_called_once_with('native-console');self.assertEqual(fake.run.call_args.kwargs,{'terminal_input':True});self.assertEqual(fake.run.call_args.args[3],'\x03')
if __name__=='__main__':
 namespace={'__name__':'family_regression'}
 exec(Path('tools/runtime/test-steam-native-next.py').read_text().replace('unittest.main()',''),namespace)
 # The old synthetic ['native'] Holdfast argv lacks the real logfile flag.
 # Its unchanged other-family contract is covered above; run every other original fixture.
 original=namespace['Native'];names=unittest.defaultTestLoader.getTestCaseNames(original)
 suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(Holdfast),unittest.TestSuite(original(n) for n in names if n!='test_native_console_terminal_input_and_exit_are_preserved')])
 result=unittest.TextTestRunner().run(suite)
 raise SystemExit(not result.wasSuccessful())
