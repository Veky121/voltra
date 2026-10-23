import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('tools/runtime/managed-steam-native-inspect.py','utf8');
const tests=`
import tempfile,unittest,types
from pathlib import Path
module=types.ModuleType('native_inspect');exec(SOURCE,module.__dict__)
class NativeEvidenceTests(unittest.TestCase):
 def test_password_never_leaves_configuration_evidence(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'serverconfig.xml').write_text('<ServerSettings><property name="GameDifficulty" value="3"/><property name="TelnetPassword" value="private fixture"/></ServerSettings>')
   value=module.config(root,'7days')
   self.assertEqual(value['GameDifficulty'],['3']);self.assertTrue(value['TelnetPassword_configured']);self.assertNotIn('private fixture',str(value))
 def test_snapshot_preserves_exact_metadata_without_contents(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);file=root/'serverconfig.xml';file.write_text('private fixture');file.chmod(0o600)
   value=module.snapshot(root,'7days')['serverconfig.xml']
   self.assertEqual(value['mode'],0o600);self.assertEqual(value['size'],15);self.assertEqual(len(value['sha256']),64);self.assertNotIn('private fixture',str(value))
 def test_opaque_private_console_configuration_is_compared_without_export(self):
  with tempfile.TemporaryDirectory() as d:
   import json
   root=Path(d);(root/'.voltra').mkdir();secret='  +quit "quoted" \\\\ value  '
   import xml.etree.ElementTree as ET
   document=ET.Element('ServerSettings');ET.SubElement(document,'property',name='TelnetPassword',value=secret);ET.ElementTree(document).write(root/'serverconfig.xml')
   (root/'.voltra/sevendays-console.yaml').write_text(json.dumps({'default':{'password':secret}}))
   value=module.config(root,'7days',{'console_password':secret})
   self.assertTrue(value['expected_console_matches_native_xml']);self.assertTrue(value['expected_console_matches_client_config']);self.assertNotIn(secret,str(value))
 def test_cleared_client_configuration_matches_empty_console_without_export(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'.voltra').mkdir()
   (root/'serverconfig.xml').write_text('<ServerSettings><property name="TelnetPassword" value=""/></ServerSettings>')
   (root/'.voltra/sevendays-console.yaml').write_text('{}')
   value=module.config(root,'7days',{'console_password':''})
   self.assertFalse(value['TelnetPassword_configured']);self.assertTrue(value['expected_console_matches_native_xml']);self.assertTrue(value['expected_console_matches_client_config'])
 def test_protected_root_and_child_links_or_special_files_fail(self):
  for kind in ['root','child','fifo']:
   with tempfile.TemporaryDirectory() as d:
    root=Path(d);outside=root/'outside';outside.mkdir();(outside/'secret').write_text('not evidence')
    if kind=='root':(root/'saves').symlink_to(outside,target_is_directory=True)
    else:
     (root/'saves').mkdir()
     if kind=='child':(root/'saves'/'link').symlink_to(outside/'secret')
     else:module.os.mkfifo(root/'saves'/'pipe')
    with self.assertRaises(ValueError):module.snapshot(root,'7days')
 def test_native_removed_game_ini_is_explicit_absence_not_default_success(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);directory=root/'FactoryGame/Saved/Config/LinuxServer';directory.mkdir(parents=True)
   (directory/'Engine.ini').write_text('[/Script/FactoryGame.FGSaveSession]\\n'+ 'mNumRotatingAutosaves=2\\n')
   value=module.config(root,'satisfactory')
   self.assertEqual(value['Game.ini'],{'missing':True});self.assertEqual(value['Engine.ini']['/Script/FactoryGame.FGSaveSession']['mNumRotatingAutosaves'],['2'])
 def test_ini_reads_only_selected_native_keys_and_retains_ambiguity(self):
  value=module.native_ini(b'[Allowed]\\nKey=1\\nKey=2\\nOther=private\\n[Unrelated]\\nKey=3\\n',{'Allowed':{'Key'}})
  self.assertEqual(value,{'Allowed':{'Key':['1','2']}})
unittest.main()
`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','64m','--cpus','1','python:3.13-slim','python3','-B','-'],{input:'SOURCE='+JSON.stringify(source)+'\n'+tests,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status??1;
