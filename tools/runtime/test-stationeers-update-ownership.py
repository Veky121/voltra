"""Linux metadata retention for the actual vanilla update preservation path."""
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
for name in ('steam_template','native_config','valheim_vrising_install','stationeers_wurm_starbound_install'):
    spec=importlib.util.spec_from_file_location(name,BASE/(name.replace('_','-')+'.py'))
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
installer=sys.modules['stationeers_wurm_starbound_install']

@unittest.skipUnless(os.name=='posix' and os.geteuid()==0,'requires Linux root to exercise nonroot ownership')
class Ownership(unittest.TestCase):
    def snapshot(self,root):
        result={}
        for name in ('setting.xml','saves','saves/world','saves/world/world.save','mods','mods/custom'):
            path=root/name;info=path.stat()
            result[name]=(info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode),hashlib.sha256(path.read_bytes()).hexdigest()if path.is_file()else None)
        return result
    def prepare(self,root):
        (root/'.voltra/stationeers').mkdir(parents=True)
        for name in ('saves/world','mods/custom'):(root/name).mkdir(parents=True)
        for name in ('setting.xml','saves/world/world.save'):(root/name).write_bytes(b'operator bytes\r\n')
        for index,name in enumerate(('setting.xml','saves','saves/world','saves/world/world.save','mods','mods/custom')):
            path=root/name;os.chown(path,988+index,988+index)
            path.chmod(0o640 if path.is_file()else 0o2750)
    def test_success_and_failure_preserve_files_and_directory_owners(self):
        for failed in (False,True):
            with self.subTest(failed=failed),tempfile.TemporaryDirectory()as temporary:
                root=Path(temporary);self.prepare(root);before=self.snapshot(root)
                def operation():
                    backup=next((root/'.voltra/stationeers').glob('preserve-*'))
                    self.assertEqual(self.snapshot(backup),before)
                    (root/'setting.xml').write_bytes(b'publisher');shutil.rmtree(root/'saves');(root/'saves').mkdir()
                    if failed:raise RuntimeError('publisher failed')
                    return 'published'
                if failed:
                    with self.assertRaisesRegex(RuntimeError,'publisher failed'):installer.preserve_stationeers_update(root,operation)
                else:self.assertEqual(installer.preserve_stationeers_update(root,operation),'published')
                self.assertEqual(self.snapshot(root),before)
                self.assertFalse(list((root/'.voltra/stationeers').glob('preserve-*')))
    def test_unpreservable_ownership_refuses_before_publisher(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);self.prepare(root);calls=[]
            with patch.object(installer.os,'chown',side_effect=PermissionError('ownership refused')):
                with self.assertRaises(PermissionError):installer.preserve_stationeers_update(root,lambda:calls.append(True))
            self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
