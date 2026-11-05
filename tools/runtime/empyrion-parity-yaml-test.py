import hashlib,importlib.util,json,sys,tarfile,tempfile,types,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'internal/panel/game_library/scripts';archive=ROOT/'.local/space-survival/pyyaml.tar.gz';pin=json.loads((BASE/'space-survival-pins.json').read_text())['pyyaml'];assert hashlib.sha256(archive.read_bytes()).hexdigest()==pin['sha256'];vendor=tempfile.TemporaryDirectory();tarfile.open(archive).extractall(vendor.name,filter='data');sys.path.insert(0,str(Path(vendor.name)/'pyyaml-6.0.3/lib'))
def load(source,name):
 m=types.ModuleType(name);m.__file__=str(BASE/'space-survival.py');exec(compile(source,m.__file__,'exec'),m.__dict__);return m
old=load((ROOT/'tools/runtime/empyrion-parity-yaml-legacy.py.fixture').read_text(),'old_space');fixed=load((BASE/'space-survival.py').read_text(),'fixed_space')
class YAMLIndentTests(unittest.TestCase):
 def test_actual_four_space_publisher_shape_proves_original_failure(self):
  text='# publisher-style comments\nServerConfig:\n    Srv_Port: 30000\n    Srv_Name: Original\n\nGameConfig:\n    GameName: Original\n'
  with tempfile.TemporaryDirectory()as d:
   with self.assertRaises(old.yaml_module(Path(d)).YAMLError):old.patch_yaml(Path(d),text,{'ServerConfig':{'Tel_Enabled':True,'Tel_Port':1030}})
   result=fixed.patch_yaml(Path(d),text,{'ServerConfig':{'Tel_Enabled':True,'Tel_Port':1030}});self.assertIn('    Tel_Port: 1030\n',result);self.assertIn('# publisher-style comments',result);self.assertIn('    Srv_Name: Original',result)
 def test_two_four_and_eight_space_indent_keep_unknown_values_comments_and_types(self):
  for n in (2,4,8):
   indent=' '*n;text='ServerConfig:\n'+indent+'Srv_Port: 30000\n'+indent+'Unknown: [one, two]\n'+indent+'# keep\nGameConfig:\n'+indent+'GameName: save\n'
   with tempfile.TemporaryDirectory()as d:
    result=fixed.patch_yaml(Path(d),text,{'ServerConfig':{'Srv_Port':29106,'Tel_Enabled':True,'Srv_Name':'literal: # value'}});value=fixed.yaml_module(Path(d)).safe_load(result);self.assertEqual(value['ServerConfig']['Unknown'],['one','two']);self.assertEqual(value['ServerConfig']['Srv_Port'],29106);self.assertIs(value['ServerConfig']['Tel_Enabled'],True);self.assertIn(indent+'# keep',result);self.assertIn(indent+'Srv_Name:',result)
 def test_mixed_section_indents_derive_independent_field_prefixes(self):
  text='ServerConfig:\n    Srv_Port: 30000\nGameConfig:\n  GameName: save\n'
  with tempfile.TemporaryDirectory()as d:
   result=fixed.patch_yaml(Path(d),text,{'ServerConfig':{'Tel_Port':1030},'GameConfig':{'Seed':123}});self.assertIn('    Tel_Port: 1030\n',result);self.assertIn('  Seed: 123\n',result)
 def test_duplicates_and_aliases_remain_refused(self):
  for text in ['ServerConfig:\n    Srv_Port: 30000\n    Srv_Port: 30001\n','ServerConfig:\n    First: &first [one]\n    Second: *first\n']:
   with tempfile.TemporaryDirectory()as d:
    with self.assertRaises(ValueError):fixed.patch_yaml(Path(d),text,{'ServerConfig':{'Tel_Port':1030}})
 def test_final_mapping_without_newline_has_complete_line_boundary(self):
  text='ServerConfig:\n    Srv_Port: 30000'
  with tempfile.TemporaryDirectory()as d:
   result=fixed.patch_yaml(Path(d),text,{'ServerConfig':{'Tel_Port':1030}});self.assertEqual(fixed.yaml_module(Path(d)).safe_load(result)['ServerConfig'],{'Srv_Port':30000,'Tel_Port':1030})
 def test_publisher_capture_roundtrip_without_mutating_owned_native_bytes(self):
  p=ROOT/'.local/game-parity-20261029/empyrion-native/14c3a416-0f1d-47a5-bc9b-adb2372b2049/publisher-dedicated.yaml'
  if not p.exists():self.skipTest('Private current native publisher capture unavailable; minimal4-space fixture remains mandatory')
  before=p.read_bytes();self.assertEqual(hashlib.sha256(before).hexdigest(),'8065f95cb655961e0168728b5965c8d9a5ac23c6b86edb4cb07a897dc8f1f2c1')
  with tempfile.TemporaryDirectory()as d:
   result=fixed.patch_yaml(Path(d),before.decode('utf-8-sig'),{'ServerConfig':{'Srv_Name':'ParityEmpyrion','Tel_Enabled':True,'Tel_Port':1030,'Srv_Description':'fixture','Srv_Password':''}});value=fixed.yaml_module(Path(d)).safe_load(result);self.assertEqual(value['ServerConfig']['Tel_Port'],1030);self.assertEqual(value['ServerConfig']['Srv_Password'],'')
  self.assertEqual(p.read_bytes(),before)
if __name__=='__main__':unittest.main()
