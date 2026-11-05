"""Pure managed-path preflight fixtures. No download, package install or game."""
from pathlib import Path
import hashlib
import os
import subprocess
import tempfile
import unittest

SOURCE=Path(__file__).with_name('mindustry-wave9-installer-preflight.sh.pending').read_text()
PARENTS=('.voltra','.voltra/classes','.voltra/classes/mindustry','.voltra/classes/mindustry/server')
LEAVES=('.voltra/VoltraMindustry.java','.voltra/Mindustry-LICENSE','.voltra/mindustry-native-start.sh','.voltra/classes/mindustry/server/VoltraMindustry.class','server-release.jar')

class InstallerPreflight(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
    def snapshot(self):
        return {str(p.relative_to(self.root)):('link',os.readlink(p)) if p.is_symlink() else ('file',hashlib.sha256(p.read_bytes()).hexdigest(),p.stat().st_mode,p.stat().st_uid,p.stat().st_gid) if p.is_file() else ('directory',p.stat().st_mode) for p in self.root.rglob('*')}
    def run_preflight(self):
        return subprocess.run(['/bin/bash','-c',SOURCE+'\nmindustry_validate_managed_paths'],cwd=self.root,capture_output=True,timeout=10).returncode
    def test_fresh_preflight_is_read_only(self):
        before=self.snapshot();self.assertEqual(self.run_preflight(),0);self.assertEqual(self.snapshot(),before)
    def test_existing_operator_and_managed_files_untouched(self):
        for name in LEAVES:
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator/old code bytes\0\xff')
        (self.root/'config').mkdir();(self.root/'config/settings.bin').write_bytes(b'opaque administrator and player data')
        before=self.snapshot();self.assertEqual(self.run_preflight(),0);self.assertEqual(self.snapshot(),before)
    def test_each_linked_parent_refuses_without_mutation(self):
        for name in PARENTS:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);target=root/'target';target.mkdir();(target/'keep').write_bytes(b'untouched');p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.symlink_to(target,target_is_directory=True)
                result=subprocess.run(['/bin/bash','-c',SOURCE+'\nmindustry_validate_managed_paths'],cwd=root,capture_output=True,timeout=10);self.assertEqual(result.returncode,2);self.assertEqual((target/'keep').read_bytes(),b'untouched');self.assertTrue(p.is_symlink())
    def test_each_linked_or_directory_target_refuses_without_mutation(self):
        for name in LEAVES:
            for kind in ('link','directory'):
                with self.subTest(name=name,kind=kind),tempfile.TemporaryDirectory() as tmp:
                    root=Path(tmp);target=root/'operator';target.write_bytes(b'preserve me');p=root/name;p.parent.mkdir(parents=True,exist_ok=True)
                    if kind=='link':p.symlink_to(target)
                    else:p.mkdir()
                    result=subprocess.run(['/bin/bash','-c',SOURCE+'\nmindustry_validate_managed_paths'],cwd=root,capture_output=True,timeout=10);self.assertEqual(result.returncode,2);self.assertEqual(target.read_bytes(),b'preserve me')
    def test_atomic_leaf_replacement_does_not_follow_existing_hardlink(self):
        target=self.root/'server-release.jar';operator=self.root/'operator.jar';operator.write_bytes(b'operator bytes');os.link(operator,target);stage=self.root/'new.jar';stage.write_bytes(b'reviewed publisher bytes')
        self.assertEqual(self.run_preflight(),0);subprocess.run(['/bin/bash','-c','mv -Tf -- new.jar server-release.jar'],cwd=self.root,check=True,timeout=10)
        self.assertEqual(operator.read_bytes(),b'operator bytes');self.assertEqual(target.read_bytes(),b'reviewed publisher bytes')

if __name__=='__main__':unittest.main()
