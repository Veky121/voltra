#!/usr/bin/env python3
"""MIT. Offline transaction failure/rollback and driver policy checks."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('readonly_driver_test',HERE/'readonly-once.py')
driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)


class TransactionTests(unittest.TestCase):
    def make(self, root):
        (root/'.voltra').mkdir()
        mod=root/driver.ORIGINAL
        (mod/'Scripts').mkdir(parents=True)
        (mod/'enabled.txt').write_bytes(b'original-marker')
        (root/'DSSettings.txt').write_bytes(b'original-config')
        return mod

    def test_success_and_exception_restore(self):
        for fail in (False,True):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);mod=self.make(root)
                try:
                    with driver.transaction(root,b'-- metadata-only'):
                        self.assertFalse((mod/'enabled.txt').exists())
                        self.assertTrue((root/driver.PROBE/'enabled.txt').exists())
                        (root/'DSSettings.txt').write_bytes(b'changed')
                        (root/'.pteroignore').write_bytes(b'temporary')
                        if fail: raise RuntimeError('fixture interruption')
                except RuntimeError:
                    self.assertTrue(fail)
                self.assertEqual((root/'DSSettings.txt').read_bytes(),b'original-config')
                self.assertEqual((mod/'enabled.txt').read_bytes(),b'original-marker')
                self.assertFalse((root/'.pteroignore').exists())
                self.assertFalse((root/driver.PROBE).exists())

    def test_requests_and_unknown_mods_rejected_without_mutation(self):
        for case in ('request','mod','registry','probe'):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);mod=self.make(root)
                if case=='request': (mod/'request.bin').write_bytes(b'never-read')
                if case=='mod':
                    p=root/driver.MODBASE/'Other';p.mkdir();(p/'enabled.txt').touch()
                if case=='registry': (root/driver.MODBASE/'mods.txt').write_bytes(b'Other : 1')
                if case=='probe': (root/driver.PROBE).mkdir()
                with self.assertRaises(ValueError):
                    with driver.transaction(root,b'probe'): self.fail('Boundary accepted')
                self.assertEqual((mod/'enabled.txt').read_bytes(),b'original-marker')
                self.assertFalse((root/'.voltra/star-readonly').exists())

    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.make(root)
            try: (root/'alias').symlink_to(root/'DSSettings.txt')
            except OSError: self.skipTest('Host does not grant symlink creation')
            with self.assertRaises(ValueError):driver.owned(root,'alias')

    def test_partial_probe_install_restores(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);mod=self.make(root)
            original=Path.write_bytes
            def fail_probe(path, body):
                if path == root/driver.PROBE/'Scripts/main.lua': raise OSError('Synthetic install failure')
                return original(path,body)
            with patch.object(Path,'write_bytes',fail_probe):
                with self.assertRaises(OSError):
                    with driver.transaction(root,b'probe'): self.fail('Injected failure missed')
            self.assertEqual((mod/'enabled.txt').read_bytes(),b'original-marker')
            self.assertEqual((root/'DSSettings.txt').read_bytes(),b'original-config')
            self.assertFalse((root/driver.PROBE).exists())

    def test_policy(self):
        code=(HERE/'readonly-once.py').read_text()
        self.assertIn('timeout=90,stop_after=75',code)
        self.assertIn("'START_NEW':'false','LOAD_SAVE':'false'",code)
        self.assertNotIn('protected_input(',code)
        self.assertNotIn('run_once(',code)
        self.assertNotIn('CallFunction(',code)
        controller=(HERE/'readonly-controller.mjs').read_text()
        self.assertIn('timeout:105000',controller)
        self.assertNotIn("'--publish'",controller)
        self.assertNotIn("'--privileged'",controller)


if __name__=='__main__':unittest.main()
