import importlib.util,importlib.machinery,tempfile,unittest,hashlib,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];loader=importlib.machinery.SourceFileLoader('q',str(ROOT/'tools/runtime/empyrion-parity-quarantine.py.pending'));spec=importlib.util.spec_from_loader(loader.name,loader);q=importlib.util.module_from_spec(spec);loader.exec_module(q)
class QuarantineTests(unittest.TestCase):
 def fixture(self,root):
  (root/'.voltra').mkdir();(root/'dedicated.yaml').write_bytes(b'publisher');return {'expected_sha':hashlib.sha256(b'publisher').hexdigest(),'expected_bytes':9}
 def test_exact_private_move_preserves_payload_mode_and_bytes(self):
  with tempfile.TemporaryDirectory()as d:
   r=Path(d);opts=self.fixture(r);(r/'dedicated.yaml').chmod(0o640);(r/'steamapps').mkdir();(r/'steamapps/appmanifest_530870.acf').write_bytes(b'payload receipt');dry=q.quarantine(r,**opts);self.assertFalse(dry['applied']);result=q.quarantine(r,True,**opts);self.assertTrue(result['applied']);self.assertEqual((r/q.RELATIVE_BACKUP).read_bytes(),b'publisher');self.assertEqual(result['protected_before'],result['protected_after']);self.assertEqual(result['source_mode'],result['destination_mode']);self.assertFalse((r/'dedicated.yaml').exists())
 def test_changed_file_refuses_unchanged(self):
  with tempfile.TemporaryDirectory()as d:
   r=Path(d);opts=self.fixture(r);(r/'dedicated.yaml').write_bytes(b'operator!')
   with self.assertRaises(ValueError):q.quarantine(r,True,**opts)
   self.assertEqual((r/'dedicated.yaml').read_bytes(),b'operator!');self.assertFalse((r/q.RELATIVE_BACKUP).parent.exists())
 def test_existing_quarantine_or_authority_receipt_refuses(self):
  for authority in (False,True):
   with tempfile.TemporaryDirectory()as d:
    r=Path(d);opts=self.fixture(r);p=r/('.voltra/empyrion-parity/native-authority.json'if authority else q.RELATIVE_BACKUP);p.parent.mkdir(parents=True);p.write_bytes(b'operator')
    with self.assertRaises(ValueError):q.quarantine(r,True,**opts)
    self.assertEqual((r/'dedicated.yaml').read_bytes(),b'publisher');self.assertEqual(p.read_bytes(),b'operator')
 @unittest.skipUnless(os.name=='posix','Linux path safety')
 def test_symlink_parent_refuses_without_outside_writes(self):
  with tempfile.TemporaryDirectory()as d,tempfile.TemporaryDirectory()as out:
   r=Path(d);opts=self.fixture(r);(r/'.voltra/empyrion-parity-quarantine').symlink_to(out,target_is_directory=True)
   with self.assertRaises(ValueError):q.quarantine(r,True,**opts)
   self.assertEqual(list(Path(out).iterdir()),[]);self.assertTrue((r/'dedicated.yaml').is_file())
if __name__=='__main__':unittest.main()
