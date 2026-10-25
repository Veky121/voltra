"""Private publication boundaries; actual27-symbol loader proof is separate."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name,file):
    s=importlib.util.spec_from_file_location(name,BASE/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
load('steam_template','steam-template.py');compat=load('onset_compat','onset-mariadb-compat.py')
class Compat(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.addCleanup(self.temp.cleanup)
    def extraction(self,args,**kwargs):
        target=Path(args[-1]);library=target/'usr/lib/x86_64-linux-gnu/libmariadb.so.3';library.parent.mkdir(parents=True);library.write_bytes(b'fixture library')
        license=target/'usr/share/doc/libmariadb3/copyright';license.parent.mkdir(parents=True);license.write_bytes(b'fixture copyright retained')
        return types.SimpleNamespace(returncode=0)
    def provision(self):
        with patch.object(compat,'download'),patch.object(compat.subprocess,'run',side_effect=self.extraction),patch.object(compat,'validate',return_value={'resolved_sql_symbols':27}),patch.object(compat,'LIBRARY_SHA256',hashlib.sha256(b'fixture library').hexdigest()):return compat.provision(self.root)
    def test_private_copy_receipt_copyright_and_idempotency(self):
        self.provision();target=self.root/compat.RELATIVE;before=target.stat();self.assertFalse(target.is_symlink());self.assertEqual(target.read_bytes(),b'fixture library');self.assertTrue((self.root/'.voltra/onset-mariadb/copyright').is_file())
        with patch.object(compat,'download') as download,patch.object(compat,'LIBRARY_SHA256',hashlib.sha256(b'fixture library').hexdigest()):compat.provision(self.root)
        download.assert_not_called();self.assertEqual(target.stat().st_ino,before.st_ino)
    def test_operator_library_is_never_overwritten(self):
        target=self.root/compat.RELATIVE;target.parent.mkdir(parents=True);target.write_bytes(b'operator private dll');target.chmod(0o640);os.chown(target,988,988)
        with patch.object(compat,'download') as download,self.assertRaises(ValueError):compat.provision(self.root)
        download.assert_not_called();self.assertEqual(target.read_bytes(),b'operator private dll');self.assertEqual((target.stat().st_mode&0o777,target.stat().st_uid,target.stat().st_gid),(0o640,988,988))
    def test_changed_copyright_or_receipt_fails_closed(self):
        self.provision();(self.root/'.voltra/onset-mariadb/copyright').write_text('operator changed license')
        with patch.object(compat,'LIBRARY_SHA256',hashlib.sha256(b'fixture library').hexdigest()),self.assertRaises(ValueError):compat.provision(self.root)
    def test_missing_or_changed_runtime_library_requires_review(self):
        with self.assertRaises(ValueError):compat.location(self.root)
        target=self.root/compat.RELATIVE;target.parent.mkdir(parents=True);target.write_bytes(b'tamper')
        with self.assertRaises(ValueError):compat.location(self.root)
    def test_untrusted_library_rejected_before_dynamic_load(self):
        target=self.root/'library';target.write_bytes(b'untrusted')
        with patch.object(compat.ctypes,'CDLL') as load,self.assertRaises(ValueError):compat.validate(target)
        load.assert_not_called()
    def test_failed_extraction_publishes_no_compat_client(self):
        with patch.object(compat,'download'),patch.object(compat.subprocess,'run',return_value=types.SimpleNamespace(returncode=1)),self.assertRaises(ValueError):compat.provision(self.root)
        self.assertFalse((self.root/compat.RELATIVE).exists())
    def test_partial_publication_rolls_back_only_new_files(self):
        original=compat._publish;calls=[]
        def publish(*args,**kwargs):
            calls.append(args[1])
            if len(calls)==2:raise OSError('fixture publication failure')
            return original(*args,**kwargs)
        with patch.object(compat,'_publish',side_effect=publish),self.assertRaises(OSError):self.provision()
        self.assertFalse((self.root/compat.RELATIVE).exists());self.assertFalse((self.root/'.voltra/onset-mariadb/copyright').exists())
    def test_private_state_symlink_rejected_before_download(self):
        (self.root/'.voltra').mkdir();outside=self.root/'outside';outside.mkdir();(self.root/'.voltra/onset-mariadb').symlink_to(outside)
        with patch.object(compat,'download') as download,self.assertRaises(ValueError):compat.provision(self.root)
        download.assert_not_called()
if __name__=='__main__':unittest.main()
