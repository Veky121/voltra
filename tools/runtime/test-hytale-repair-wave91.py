"""Hytale handled-error fixtures; all acquisition/process boundaries mocked."""
import runpy
import pathlib
import tempfile
import unittest
import io
import os
import json
import zipfile
from unittest.mock import patch
runpy.run_path(str(pathlib.Path(__file__).with_name('test-hytale-resume-wave4.py')), run_name='fixture_import')
import hytale_runtime as r
if os.environ.get('HYTALE_BEFORE'):
    exec(pathlib.Path(os.environ['HYTALE_BEFORE']).read_text(), r.__dict__)
    r.acquire = r.publisher.acquire

class Repair(unittest.TestCase):
    def put(self, root, name, data=b'old'):
        p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    def publish(self, root, name, writer, mode=0o600):
        out=io.BytesIO();writer(out);self.put(root,name,out.getvalue());os.chmod(root/name,mode)
    def stage(self, root):
        for name in ('Server/HytaleServer.jar','Assets.zip'):
            self.put(root,name)
            self.put(root,'updater/staging/'+name,b'new')
        self.put(root,'updater/staging/Server/HytaleServer.aot',b'new')
        self.put(root,'Server/config.json',b'private')
    def check_old(self, root):
        for name in ('Server/HytaleServer.jar','Assets.zip'):self.assertEqual((root/name).read_bytes(),b'old')
        self.assertFalse((root/'Server/HytaleServer.aot').exists())
        self.assertEqual((root/'Server/config.json').read_bytes(),b'private')
    def test_second_publication_and_repeat_repair(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);self.stage(root);failed=False
            def publish(root,name,writer,mode=0o600):
                nonlocal failed
                if name=='Assets.zip' and not failed:failed=True;raise OSError('injected second/later write')
                self.publish(root,name,writer,mode)
            with patch.object(r.publisher,'_publish',side_effect=publish):
                with self.assertRaises(OSError):r.apply_update(root)
                self.check_old(root)
                self.assertTrue((root/'updater/staging').exists())
                self.assertTrue(r.apply_update(root));self.assertFalse(r.apply_update(root))
    def test_stage_rename_failure(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);self.stage(root)
            with patch.object(r.publisher,'_publish',side_effect=self.publish),patch.object(pathlib.Path,'rename',side_effect=OSError('rename')):
                with self.assertRaises(OSError):r.apply_update(root)
            self.check_old(root)
    def test_rollback_failure_truthful(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);self.stage(root);count=0
            def publish(root,name,writer,mode=0o600):
                nonlocal count
                if not name.startswith('.voltra'):count+=1
                if count>=2:raise OSError('persistent IO')
                self.publish(root,name,writer,mode)
            with patch.object(r.publisher,'_publish',side_effect=publish):
                with self.assertRaisesRegex(RuntimeError,'rollback incomplete'):r.apply_update(root)
    def acquisition(self, fail=False):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);self.put(root,'hytale-downloader/hytale-downloader-linux')
            self.put(root,'Server/config.json',b'private');self.put(root,'unknown.bin',b'operator')
            def run(root,argv,*a,**kw):
                with zipfile.ZipFile(argv[-1],'w') as z:
                    for name in ('Server/HytaleServer.jar','Assets.zip','unknown.bin'):z.writestr(name,b'new')
                return 0
            with patch.object(r.publisher,'run',side_effect=run),patch.object(r.publisher,'_publish',side_effect=self.publish),patch('os.chown',create=True),patch('os.geteuid',return_value=1000,create=True),patch('publisher_install._publish',side_effect=self.publish):
                r.acquire(root,dict(VOLTRA_PUBLISHER='hytale'))
                receipt=root/'.voltra/publisher/hytale-files.json';old=receipt.read_bytes()
                self.assertEqual((root/'unknown.bin').read_bytes(),b'operator')
                def changed(root,argv,*a,**kw):
                    with zipfile.ZipFile(argv[-1],'w') as z:
                        for name in ('Server/HytaleServer.jar','Assets.zip'):z.writestr(name,b'changed')
                    return 0
                def publish(root,name,writer,mode=0o600):
                    if fail and name.endswith('hytale-files.json'):
                        nonlocal_failed[0]+=1
                        if nonlocal_failed[0]==1:raise OSError('receipt failure')
                    self.publish(root,name,writer,mode)
                nonlocal_failed=[0]
                with patch.object(r.publisher,'run',side_effect=changed),patch.object(r.publisher,'_publish',side_effect=publish):
                    if fail:
                        with self.assertRaises(OSError):r.acquire(root,dict(VOLTRA_PUBLISHER='hytale'))
                        self.assertEqual(receipt.read_bytes(),old)
                        for name in ('Server/HytaleServer.jar','Assets.zip'):self.assertEqual((root/name).read_bytes(),b'new')
                    r.acquire(root,dict(VOLTRA_PUBLISHER='hytale'))
                    self.assertEqual((root/'Assets.zip').read_bytes(),b'changed')
                self.assertEqual((root/'Server/config.json').read_bytes(),b'private')
    def test_initial_and_changed_acquisition(self):self.acquisition()
    def test_receipt_failure_and_repeat_repair(self):self.acquisition(True)
if __name__=='__main__':unittest.main()
