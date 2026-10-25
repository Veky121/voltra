import importlib.util,tempfile,unittest,configparser,sys
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name):
 s=importlib.util.spec_from_file_location(name.replace('-','_'),BASE/(name+'.py'));m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);return m
for n in('steam-template','native-config','native-console','enshrouded-proton','unreal-survival-install'):load(n)
r=load('unreal-survival-runtime')
class Alias(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001'}
 def binary(self,modern=True):
  p=self.root/('HumanitZServer/Binaries/Linux/HumanitZServer-Linux-Shipping'if modern else'TSSGame/Binaries/Linux/TSSGameServer-Linux-Shipping');p.parent.mkdir(parents=True);p.write_bytes(b'fixture');return p
 def reference(self,body):
  p=self.root/'HumanitZServer/REF_GameServerSettings.ini';p.parent.mkdir(exist_ok=True);p.write_text(body);return p
 def parse(self,modern=True):
  p=self.root/('HumanitZServer/GameServerSettings.ini'if modern else'TSSGame/GameServerSettings.ini');c=configparser.ConfigParser(interpolation=None);c.optionxform=str;c.read(p);return c,p.read_text()
 def test_modern_alias_preserves_legacy_key_and_unknown(self):
  self.binary();self.reference('[Host Settings]\nNoDeathFeedback=true\nVersion=39\n');p=self.root/'HumanitZServer/GameServerSettings.ini';p.write_text('; operator comment\n[Unknown]\nLiteral=keep\n');r.configure(self.root,'humanitz',{**self.env,'NO_DEATH_FEEDBACK':'0'});c,t=self.parse();self.assertEqual(c['Host Settings']['NoDeathFeedback'],'0');self.assertEqual(c['World Settings']['NoDeathFeedback'],'0');self.assertIn('; operator comment',t);self.assertEqual(c['Unknown']['Literal'],'keep')
 def test_modern_true_stays_literal(self):
  self.binary();self.reference('[Host Settings]\nNoDeathFeedback=true\n');r.configure(self.root,'humanitz',{**self.env,'NO_DEATH_FEEDBACK':'1'});c,_=self.parse();self.assertEqual(c['Host Settings']['NoDeathFeedback'],'1');self.assertEqual(c['World Settings']['NoDeathFeedback'],'1')
 def test_no_reference_does_not_guess_alias(self):
  self.binary();r.configure(self.root,'humanitz',self.env);c,_=self.parse();self.assertFalse(c.has_option('Host Settings','NoDeathFeedback'));self.assertEqual(c['World Settings']['NoDeathFeedback'],'0')
 def test_missing_host_key_does_not_alias(self):
  self.binary();self.reference('[World Settings]\nNoDeathFeedback=true\n');r.configure(self.root,'humanitz',self.env);c,_=self.parse();self.assertFalse(c.has_option('Host Settings','NoDeathFeedback'))
 def test_legacy_layout_never_aliases(self):
  self.binary(False);self.reference('[Host Settings]\nNoDeathFeedback=true\n');r.configure(self.root,'humanitz',self.env);c,_=self.parse(False);self.assertFalse(c.has_option('Host Settings','NoDeathFeedback'));self.assertEqual(c['World Settings']['NoDeathFeedback'],'0')
 def test_malformed_reference_preserves_previous_config(self):
  self.binary();self.reference('malformed without section\n');p=self.root/'HumanitZServer/GameServerSettings.ini';p.write_text('; previous operator config\n')
  with self.assertRaises(configparser.Error):r.configure(self.root,'humanitz',self.env)
  self.assertEqual(p.read_text(),'; previous operator config\n')
 def test_reference_symlink_rejected_before_write(self):
  self.binary();outside=self.root/'outside';outside.write_text('[Host Settings]\nNoDeathFeedback=true\n');(self.root/'HumanitZServer/REF_GameServerSettings.ini').symlink_to(outside)
  with self.assertRaises(ValueError):r.configure(self.root,'humanitz',self.env)
  self.assertFalse((self.root/'HumanitZServer/GameServerSettings.ini').exists())
if __name__=='__main__':unittest.main()
