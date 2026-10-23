"""Desired shared Steam publication contract; intentionally exposes unfixed bugs.
No Steam process/network: publisher result is mocked, filesystem behavior is real.
Root owns steam-template.py fixes. Run as root in an isolated Linux container.
"""
import importlib.util,pathlib,tempfile,unittest,os,io,json,types
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('steam_publication',pathlib.Path('/helpers/steam-template.py'));steam=importlib.util.module_from_spec(spec);spec.loader.exec_module(steam)
class Publication(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)/'server';self.root.mkdir();(self.root/'.voltra').mkdir();self.outside=pathlib.Path(self.temp.name)/'outside';self.outside.write_bytes(b'outside unchanged')
 def tearDown(self):self.temp.cleanup()
 def update(self):
  process=types.SimpleNamespace(stdout=io.BytesIO(b''),wait=lambda:0)
  with patch.object(steam,'bootstrap'),patch.object(steam.subprocess,'Popen',return_value=process),patch.object(steam,'manifest',return_value={'appid':3930080,'StateFlags':4,'buildid':2}):return steam.update(self.root,3930080,{})
 def owned(self,path):
  path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'old payload');path.chmod(0o640);os.chown(path,988,988)
 def test_receipt_new_data_preserves_existing_numeric_ownership_mode(self):
  target=self.root/'.voltra/steam-template-release.json';self.owned(target);self.update();self.assertEqual(json.loads(target.read_text())['buildid'],2);self.assertEqual((target.stat().st_uid,target.stat().st_gid,target.stat().st_mode&0o777),(988,988,0o640))
 def test_sdk_new_payload_preserves_existing_numeric_ownership_mode(self):
  source=self.root/'.voltra/steamcmd/linux64/steamclient.so';source.parent.mkdir(parents=True);source.write_bytes(b'new publisher sdk');source.chmod(0o755)
  target=self.root/'.steam/sdk64/steamclient.so';self.owned(target);self.update();self.assertEqual(target.read_bytes(),b'new publisher sdk');self.assertEqual((target.stat().st_uid,target.stat().st_gid,target.stat().st_mode&0o777),(988,988,0o640))
 def test_receipt_predictable_temporary_symlink_never_changes_outside(self):
  (self.root/'.voltra/steam-template-release.new').symlink_to(self.outside)
  try:self.update()
  except (ValueError,OSError):pass
  self.assertEqual(self.outside.read_bytes(),b'outside unchanged')
 def test_sdk_predictable_temporary_symlink_never_changes_outside(self):
  source=self.root/'.voltra/steamcmd/linux64/steamclient.so';source.parent.mkdir(parents=True);source.write_bytes(b'new publisher sdk')
  target=self.root/'.steam/sdk64/steamclient.voltra-new';target.parent.mkdir(parents=True);target.symlink_to(self.outside)
  try:self.update()
  except (ValueError,OSError):pass
  self.assertEqual(self.outside.read_bytes(),b'outside unchanged')
if __name__=='__main__':unittest.main()
