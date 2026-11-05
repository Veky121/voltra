"""Synthetic ZIP fixtures; acquisition is mocked and no game process runs."""
import importlib.util
import io
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/file)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
native=load('native_release','native-release.py')
ziprelease=load('native_zip_release','native-zip-release.py')

class ZipTests(unittest.TestCase):
    def archive(self, entries):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as z:
            for name,kind,body in entries:
                info=zipfile.ZipInfo(name);info.create_system=3;info.external_attr=(kind|0o755)<<16
                z.writestr(info,body)
        data.seek(0);return data
    def special(self,kind):
        for name,prefix,paths in [('excluded',None,['wanted']),('wanted',None,None),('top/','top',None)]:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as t:
                with self.assertRaises(ValueError):ziprelease.extract(self.archive([(name,kind,b'x')]),Path(t),prefix,paths)
    def test_symlink(self):self.special(stat.S_IFLNK)
    def test_char_device(self):self.special(stat.S_IFCHR)
    def test_fifo(self):self.special(stat.S_IFIFO)
    def test_socket(self):self.special(stat.S_IFSOCK)
    def test_regular_directory_and_exclusion(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            ziprelease.extract(self.archive([('top/',stat.S_IFDIR,b''),('top/data/',stat.S_IFDIR,b''),('top/data/file',stat.S_IFREG,b'yes'),('top/skip',0,b'no')]),root,'top',['data/'])
            self.assertEqual((root/'data/file').read_bytes(),b'yes');self.assertFalse((root/'skip').exists())
    def test_traversal_duplicate_and_size_excluded(self):
        for entries in [[('../escape',0,b'x')],[('same',0,b'a'),('./same',0,b'b')]]:
            with tempfile.TemporaryDirectory() as t,self.assertRaises(ValueError):ziprelease.extract(self.archive(entries),Path(t),None,[])
        with tempfile.TemporaryDirectory() as t,zipfile.ZipFile(self.archive([('excluded',0,b'x')])) as z:
            z.infolist()[0].file_size=4*1024**3+1
            with patch.object(ziprelease.zipfile,'ZipFile',return_value=z),self.assertRaises(ValueError):ziprelease.extract(None,Path(t),None,[])
    def test_reinstall_and_rollback(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);release=dict(version='synthetic',sha256='fixture',prefix=None)
            payload=self.archive([('server',stat.S_IFREG,b'first'),('operator.cfg',stat.S_IFREG,b'default')]).getvalue()
            def acquire(release,target):target.write_bytes(payload)
            # Windows has no Unix ownership API; publication bytes/rollback are
            # tested here, while Linux ownership remains a separate boundary.
            with patch.object(ziprelease,'download',side_effect=acquire) as download, patch.object(ziprelease,'preserve_identity',side_effect=lambda source,dest:shutil.copymode(dest,source)):
                ziprelease.install_release(root,release,'engine','server')
                (root/'engine/operator.cfg').write_bytes(b'operator')
                ziprelease.install_release(root,release,'engine','server');self.assertEqual(download.call_count,1)
                receipt=(root/'.voltra/engine/release.json').read_bytes()
                payload=self.archive([('server',stat.S_IFREG,b'second')]).getvalue()
                replace=ziprelease.os.replace
                def fail_receipt(source,dest):
                    if Path(source).name=='receipt.json':raise OSError('synthetic publication failure')
                    return replace(source,dest)
                with patch.object(ziprelease.os,'replace',side_effect=fail_receipt),self.assertRaises(OSError):ziprelease.install_release(root,{**release,'sha256':'second'},'engine','server')
                self.assertEqual((root/'engine/server').read_bytes(),b'first');self.assertEqual((root/'engine/operator.cfg').read_bytes(),b'operator');self.assertEqual((root/'.voltra/engine/release.json').read_bytes(),receipt)

if __name__=='__main__':unittest.main(verbosity=2)
