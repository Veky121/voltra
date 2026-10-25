#!/usr/bin/env python3
import importlib.util,tempfile,unittest,subprocess,sys,json,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('standalone',Path(__file__).with_name('standalone.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ClosedInputs(unittest.TestCase):
 def test_optimization_rejected(self):
  p=subprocess.run([sys.executable,"-O",str(Path(__file__).with_name("standalone.py")),"--help"],stdout=subprocess.PIPE,stderr=subprocess.PIPE);self.assertNotEqual(p.returncode,0);self.assertIn(b"optimized Python",p.stderr)
 def test_closed_world(self):
  with tempfile.TemporaryDirectory()as d:
   r=Path(d);(r/'approved.cs').write_text('approved');module.closed_tree(r,{'approved.cs'})
   for name in ('unlisted.cs','Directory.Build.targets'):
    (r/name).write_text('unlisted')
    with self.assertRaises(ValueError):module.closed_tree(r,{'approved.cs'})
    (r/name).unlink()
   (r/'unexpected').mkdir()
   with self.assertRaises(ValueError):module.closed_tree(r,{'approved.cs'})
 def test_cli_rejects_before_build(self):
  with tempfile.TemporaryDirectory()as d:
   r=Path(d);src=r/'source';src.mkdir();(src/'approved.cs').write_text('approved');inputs=r/'inputs.json';inputs.write_text(json.dumps({'sources':[{'path':'tools/runtime/steam-private-content/approved.cs','sha256':hashlib.sha256(b'approved').hexdigest()}]}))
   for name in ('unlisted.cs','Directory.Build.targets'):
    (src/name).write_text('reject before SDK/build');out=r/('build-'+name);args=[sys.executable,str(Path(__file__).with_name('standalone.py')),'--source-root',str(src),'--inputs',str(inputs),'--sdk',str(r/'missing-sdk'),'--sdk-archive',str(r/'missing-archive'),'--packages',str(r/'missing-feed'),'--build-dir',str(out)];p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE);self.assertNotEqual(p.returncode,0);self.assertIn(b'unlisted input file',p.stderr);self.assertFalse(out.exists());(src/name).unlink()
 def test_symlink(self):
  with tempfile.TemporaryDirectory()as d:
   r=Path(d);(r/'actual').mkdir();(r/'actual/approved.cs').write_text('approved');(r/'link').symlink_to(r/'actual',target_is_directory=True)
   with self.assertRaises(ValueError):module.closed_tree(r/'link',{'approved.cs'})
   (r/'actual/foreign.cs').symlink_to(r/'actual/approved.cs')
   with self.assertRaises(ValueError):module.closed_tree(r/'actual',{'approved.cs','foreign.cs'})
if __name__=='__main__':unittest.main()
