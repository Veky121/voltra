import hashlib,importlib.util,json,sys,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'internal/panel/game_library/scripts'
archive=ROOT/'.local/space-survival/pyyaml.tar.gz';pin=json.loads((BASE/'space-survival-pins.json').read_text())['pyyaml']
if hashlib.sha256(archive.read_bytes()).hexdigest()!=pin['sha256']:raise ValueError('Pinned cached YAML fixture differs')
vendor=tempfile.TemporaryDirectory();tarfile.open(archive).extractall(vendor.name,filter='data');sys.path.insert(0,str(Path(vendor.name)/'pyyaml-6.0.3/lib'))
spec=importlib.util.spec_from_file_location('empyrion_candidate',BASE/'empyrion-parity.py');adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
ENV={'SERVER_PORT':'29110','VOLTRA_ALLOCATED_PORTS':'29110,29111,29112,29113,29114','SERVER_NAME':'Seed','GAME_NAME':'SeedWorld','MAX_PLAYERS':'8','SERVER_PUBLIC':'false','EAC_ACTIVE':'true'}
def put(root,text):
 p=root/'dedicated.yaml';p.write_text(text);return p
class EmpyrionTests(unittest.TestCase):
 def test_native_authority_and_exact_comments_unknown_arrays(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);adapter.configure(root,ENV)
   p=root/'dedicated.yaml';text=p.read_text().replace('Srv_Name: Seed','Srv_Name: Operator').replace('GameName: SeedWorld','GameName: OperatorWorld').replace('Srv_MaxPlayers: 8','Srv_MaxPlayers: 17')
   text+='\n# operator comment\nCustom:\n  Mods: [one, two]\n';p.write_text(text)
   before=p.read_bytes();adapter.configure(root,{**ENV,'SERVER_NAME':'DifferentStartup','GAME_NAME':'DifferentWorld','MAX_PLAYERS':'2'})
   self.assertEqual(p.read_bytes(),before)
   self.assertIn('OperatorWorld',p.read_text());self.assertIn('Srv_MaxPlayers: 17',p.read_text())
 def test_proves_legacy_overwrite_while_candidate_preserves(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);adapter.configure(root,ENV);p=root/'dedicated.yaml';p.write_text(p.read_text().replace('GameName: SeedWorld','GameName: OperatorWorld'));before=p.read_bytes()
   _,legacy_text=adapter.preview(root,ENV);self.assertNotIn('GameName: OperatorWorld',legacy_text)
   adapter.configure(root,ENV);self.assertEqual(p.read_bytes(),before)
 def test_runtime_port_private_telnet_and_stable_secret(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);first=adapter.configure(root,ENV);second=adapter.configure(root,ENV)
   self.assertEqual(first[1],second[1]);self.assertGreaterEqual(len(first[1][1]),24)
   self.assertIn('Srv_Port: 29110',(root/'dedicated.yaml').read_text())
   for env in ({'TELNET_PORT':'29110'},{'VOLTRA_ALLOCATED_PORTS':'29110,29111'},{'SERVER_PORT':'29111'}):
    before=(root/'dedicated.yaml').read_bytes()
    with patch.object(adapter,'BASE_INSTALL')as install:
     with self.assertRaises(ValueError):adapter.install(root,{**ENV,**env})
     install.assert_not_called();self.assertEqual((root/'dedicated.yaml').read_bytes(),before)
 def test_invalid_environment_refuses_before_acquisition_and_writes(self):
  for changes in ({'SERVER_NAME':'bad\nInjected=yes'},{'MAX_PLAYERS':'no'},{'GAME_NAME':'../outside'},{'WINDOWS_INSTALL':'0'},{'SRCDS_APPID':'1'}):
   with self.subTest(changes=changes),tempfile.TemporaryDirectory()as d,patch.object(adapter,'BASE_INSTALL')as install:
    root=Path(d)
    with self.assertRaises(ValueError):adapter.install(root,{**ENV,**changes})
    install.assert_not_called();self.assertEqual(list(root.iterdir()),[])
 def test_unsafe_native_yaml_refuses_before_acquisition(self):
  for content in ('ServerConfig:\n  Srv_Name: a\n  Srv_Name: b\n','ServerConfig: &x {Srv_Name: a}\nGameConfig: *x\n','!!python/object:bad {}','ServerConfig:\n  Srv_MaxPlayers: true\n'):
   with self.subTest(content=content),tempfile.TemporaryDirectory()as d,patch.object(adapter,'BASE_INSTALL')as install:
    root=Path(d);p=put(root,content);before=p.read_bytes()
    with self.assertRaises(Exception):adapter.install(root,ENV)
    install.assert_not_called();self.assertEqual(p.read_bytes(),before)
 def test_fresh_install_seeds_setup_then_reinstall_preserves_operator(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d)
   def publisher(base,game,values):put(Path(base),'ServerConfig:\n  Srv_Name: PublisherDefault\nGameConfig:\n  GameName: PublisherWorld\n')
   with patch.object(adapter,'BASE_INSTALL',side_effect=publisher):adapter.install(root,ENV)
   data=adapter.legacy.yaml_module(root).safe_load((root/'dedicated.yaml').read_text());self.assertEqual(data['ServerConfig']['Srv_Name'],'Seed');self.assertEqual(data['GameConfig']['GameName'],'SeedWorld')
   p=root/'dedicated.yaml';p.write_text(p.read_text().replace('GameName: "SeedWorld"','GameName: "OperatorWorld"'));before=p.read_bytes()
   with patch.object(adapter,'BASE_INSTALL'):adapter.install(root,{**ENV,'GAME_NAME':'OtherStartup'})
   self.assertEqual(p.read_bytes(),before)
 def test_preview_restores_shared_hooks_after_failure(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);previous=adapter.legacy.shared.write_config
   with patch.object(adapter,'BASE_CONFIGURE',side_effect=ValueError('fixture')):
    with self.assertRaises(ValueError):adapter.preview(root,ENV)
   self.assertIs(adapter.legacy.shared.write_config,previous)
if __name__=='__main__':unittest.main()

