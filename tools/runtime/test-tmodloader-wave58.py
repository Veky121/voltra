"""Offline tModLoader entrypoint preflight; no game execution or publisher access."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
spec=importlib.util.spec_from_file_location('tml_existing',Path(__file__).with_name('test-tmodloader-runtime.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
m=f.m
class Preflight(unittest.TestCase):
 def test_conflicts_refuse_before_any_shared_install_or_writes(self):
  for name in ('saves','mods','serverconfig.txt','mods/enabled.json'):
   with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);p=root/name;p.parent.mkdir(parents=True,exist_ok=True)
    if name.endswith('.txt') or name.endswith('.json'):p.mkdir()
    else:p.write_bytes(b'operator')
    before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
    with mock.patch.object(f.installer,'install',side_effect=AssertionError('publisher boundary reached')) as boundary:
     with self.assertRaises(ValueError):m.install(root,{'VOLTRA_TERRARIA_KIND':'tmodloader'})
    boundary.assert_not_called()
    self.assertEqual(before,{str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()})
    self.assertFalse((root/'.voltra').exists())
 def test_valid_paths_delegate_once_and_preserve_operator_config(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);config=root/'serverconfig.txt';config.write_bytes(b'# operator\r\nunknown=yes\r\npassword=secret\r\n')
   before=config.read_bytes();env={'VOLTRA_TERRARIA_KIND':'tmodloader'}
   with mock.patch.object(f.installer,'install',return_value='fixture') as boundary:
    self.assertEqual('fixture',m.install(root,env,machine='x86_64'))
   boundary.assert_called_once_with(root,env,machine='x86_64');self.assertEqual(before,config.read_bytes())
 def test_failed_acquisition_leaves_config_unchanged(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);config=root/'serverconfig.txt';config.write_bytes(b'unknown=keep\n')
   with mock.patch.object(f.installer,'install',side_effect=ValueError('fixture acquisition failure')):
    with self.assertRaisesRegex(ValueError,'acquisition'):m.install(root,{'VOLTRA_TERRARIA_KIND':'tmodloader'})
   self.assertEqual(b'unknown=keep\n',config.read_bytes())
 def test_synthetic_full_install_and_reinstall_keep_operator_bytes(self):
  import zipfile
  with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as payload:
   root=Path(tmp);content=Path(payload);f.fixture(content)
   def download(release,destination,cache):
    with zipfile.ZipFile(destination,'w') as archive:
     for item in content.rglob('*'):
      if item.is_file() and '.voltra' not in item.relative_to(content).parts:
       archive.write(item,item.relative_to(content).as_posix())
    return f.installer.digest(destination)
   boundary=mock.Mock(side_effect=AssertionError('external boundary reached'))
   env={'VOLTRA_TERRARIA_KIND':'tmodloader','VERSION':'v2026.08.3.0'}
   with mock.patch.object(f.installer.urllib.request,'build_opener',boundary),mock.patch.object(m.subprocess,'run',boundary):
    m.install(root,env,read_metadata=boundary,download=download,machine='x86_64')
    self.assertTrue((root/'tModLoader.dll').is_file())
    self.assertEqual('[]\n',(root/'mods/enabled.json').read_text())
    config=root/'serverconfig.txt';config.write_bytes(b'# operator\r\nunknown=yes\r\npassword=secret\r\n')
    before=config.read_bytes()
    m.install(root,env,read_metadata=boundary,download=download,machine='x86_64')
    self.assertEqual(before,config.read_bytes())
   boundary.assert_not_called()
if __name__=='__main__':unittest.main()
