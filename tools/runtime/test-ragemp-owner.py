import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json
S=Path('internal/panel/game_library/scripts')
def load(name):
 s=importlib.util.spec_from_file_location(name,S/(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class RageMP(unittest.TestCase):
 def setUp(self):
  self.runtime=load('ragemp-runtime');self.env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011','SERVER_NAME':'Literal " $ &','MAX_PLAYERS':'12'}
 def test_invalid_bytes_unchanged(self):
  for raw in ['[]','{"name":1,"name":2}','{"plugin":{"a":1,"a":2}}','{"x":NaN}','{"x":1e999}','{"Port":1}','{broken']:
   with self.subTest(raw=raw),tempfile.TemporaryDirectory() as t:
    root=Path(t);(root/'ragemp').mkdir();p=root/'ragemp/conf.json';p.write_text(raw)
    with self.assertRaises(ValueError):self.runtime.configure(root,self.env)
    self.assertEqual(p.read_text(),raw);self.assertFalse((root/'.voltra').exists())
 def test_allocations_before_write(self):
  for ports,port in [('28010','28010'),('65535','65535'),('28011','28010')]:
   with tempfile.TemporaryDirectory() as t:
    root=Path(t)
    with self.assertRaises(ValueError):self.runtime.configure(root,dict(self.env,VOLTRA_ALLOCATED_PORTS=ports,SERVER_PORT=port))
    self.assertEqual(list(root.iterdir()),[])
 def test_preserve_unknown_and_legacy(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);raw={'custom':{'password':'secret','array':[1,2]},'huge':123456789012345678901234,'csharp':True};(root/'conf.json').write_text(json.dumps(raw))
   config=self.runtime.configure(root,self.env)
   for k,v in raw.items():self.assertEqual(config[k],v)
   self.assertEqual(config['maxplayers'],12);self.assertEqual(config['name'],self.env['SERVER_NAME'])
 def test_install_refuses_before_acquisition(self):
  installer=load('ragemp-install')
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);(root/'conf.json').write_text('{bad');before=list(root.iterdir())
   with self.assertRaises(ValueError):installer.install(root,self.env)
   self.assertEqual(before,list(root.iterdir()))
 def test_archive_merge_preserves_assets(self):
  installer=load('ragemp-install');real=installer.module
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);(root/'ragemp/client_packages').mkdir(parents=True);p=root/'ragemp/client_packages/index.js';p.write_text('operator');(root/'ragemp/ragemp-server').write_text('old')
   release=real('native-release')
   def fake(stage,*args):
    (stage/'ragemp/client_packages').mkdir(parents=True);(stage/'ragemp/client_packages/index.js').write_text('publisher');(stage/'ragemp/ragemp-server').write_text('new')
   release.install_release=fake
   release.preserve_identity=lambda source,destination: None
   with patch.object(installer,'module',side_effect=lambda name:release if name=='native-release' else real(name)):
    installer.install(root,dict(self.env,DEDICATED_ARCHIVE_URL='https://example.test/archive',DEDICATED_ARCHIVE_SHA256='a'*64))
   self.assertEqual(p.read_text(),'operator');self.assertEqual((root/'ragemp/ragemp-server').read_text(),'new')
if __name__=='__main__':unittest.main()

