import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('beammp',Path('internal/panel/game_library/scripts/beammp-native.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class BeamMP(unittest.TestCase):
 def test_seed_native_roundtrip_and_preservation(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);env={'AUTHKEY':'fixture-only-not-an-entitlement','NAME':'Initial','SERVER_PORT':'30814'}
   data=b.configure(root,env);self.assertTrue(data['General']['Private'])
   p=root/'ServerConfig.toml';p.write_text('# operator comment\n'+p.read_text().replace('Initial','Native edit')+'\n[Operator]\nSecret = "retained"\n')
   before=p.read_text();b.configure(root,env);self.assertEqual(p.read_text(),before)
   data=b.configure(root,{**env,'SERVER_PORT':'31000'});self.assertEqual(data['General']['Name'],'Native edit');self.assertEqual(data['General']['Port'],31000);self.assertEqual(data['Operator']['Secret'],'retained')
 def test_bad_key_and_controls_do_not_write(self):
  for env in [{},{'AUTHKEY':'fixture','ALLOW_GUESTS':'bad'},{'AUTHKEY':'fixture','RESOURCE_FOLDER':'../escape'},{'AUTHKEY':'fixture','SERVER_PORT':'0'}]:
   with tempfile.TemporaryDirectory() as tmp:
    with self.assertRaises(ValueError):b.configure(Path(tmp),env)
    self.assertFalse((Path(tmp)/'ServerConfig.toml').exists())
 def test_launch_contract_and_exit_status(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);env={'AUTHKEY':'fixture-key','BEAMMP_PORT':'9999','BEAMMP_PROVIDER_PORT_ENV':'UNTRUSTED','SERVER_PORT':'30814'}
   class Console:
    def run(self,root,argv,child,stop,**options):
     self_result=(child,stop,options);Console.result=self_result;return 23
   original=b.helper
   with patch.object(b,'helper',side_effect=lambda name:Console() if name=='native-console' else original(name)):
    self.assertEqual(b.launch(root,env),23)
   child,stop,options=Console.result
   self.assertEqual(child['BEAMMP_PROVIDER_DISABLE_CONFIG'],'true');self.assertEqual(child['BEAMMP_PORT'],'30814');self.assertNotIn('BEAMMP_PROVIDER_PORT_ENV',child)
   self.assertEqual(stop,'exit');self.assertEqual(options['ready_marker'],b'Vehicle data network online');self.assertIn('fixture-key',options['credentials']);self.assertTrue(options['terminal_input'])
 def test_operator_bytes_and_allocation_comment_survive(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);env={'AUTHKEY':'fixture-only','SERVER_PORT':'30814'}
   b.configure(root,env)
   p=root/'ServerConfig.toml'
   original=p.read_text().replace('Name = "BeamMP Server"', "Name = 'Operator name' # keep spelling").replace('Port = 30814','Port = 30_814 # allocation comment')
   original=original.replace('\n','\r\n')+'\r\n[Operator]\r\nPayload = "unknown" # untouched\r\n'
   p.write_bytes(original.encode())
   b.configure(root,env);self.assertEqual(p.read_bytes(),original.encode())
   b.configure(root,{**env,'SERVER_PORT':'31000'})
   self.assertEqual(p.read_bytes(),original.replace('30_814','31000').encode())
   backups=list((root/'.voltra/beammp/config-backups').iterdir())
   self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_bytes(),original.encode())
 def test_unsupported_port_and_malformed_toml_preserve_bytes(self):
  for content in ['[General]\nAuthKey="fixture"\n"Port"=30814 # quoted key\n', '[General]\nAuthKey="fixture"\nPort=30814\nPort=31000\n']:
   with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);p=root/'ServerConfig.toml';p.write_bytes(content.encode())
    with self.assertRaises(ValueError):b.configure(root,{'SERVER_PORT':'31001'})
    self.assertEqual(p.read_bytes(),content.encode());self.assertFalse((root/'.voltra').exists())
if __name__=='__main__':unittest.main()

