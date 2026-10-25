#!/usr/bin/env python3
"""MIT. Real file snapshots/rollback and race fixtures; no native invocation."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('retention_driver_test',HERE/'retention-once.py')
driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)

class RetentionTests(unittest.TestCase):
    def make(self,root):
        (root/'.voltra').mkdir();mod=root/driver.ORIGINAL;(mod/'Scripts').mkdir(parents=True)
        (mod/'enabled.txt').write_bytes(b'original-marker');(root/'DSSettings.txt').write_bytes(b'original-config')
        hashes={}
        for name in driver.EXPECTED_PASSWORD_HASHES:
            body=json.dumps({'Password':'fixture-'+name}).encode();(root/name).write_bytes(body);(root/name).chmod(0o644)
            hashes[name]=hashlib.sha256(body).hexdigest()
        return mod,hashes

    def test_rotation_restore_on_success_and_failure(self):
        for fail in (False,True):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);mod,hashes=self.make(root)
                before={name:((root/name).read_bytes(),(root/name).stat()) for name in hashes}
                with patch.dict(driver.EXPECTED_PASSWORD_HASHES,hashes,clear=True):
                    try:
                        with driver.transaction(root,b'probe') as private:
                            driver.rotate_passwords_for_trial(root)
                            self.assertTrue(all(not (root/name).exists() for name in hashes))
                            for name in hashes:(root/name).write_bytes(b'new-native-output')
                            (root/'DSSettings.txt').write_bytes(b'temporary-config')
                            if fail:raise RuntimeError('fixture interruption')
                    except RuntimeError:self.assertTrue(fail)
                    self.assertEqual(len(driver.verify_existing_passwords(root)),2)
                for name,(body,info) in before.items():
                    self.assertEqual((root/name).read_bytes(),body)
                    after=(root/name).stat();self.assertEqual(after.st_mode&0o777,info.st_mode&0o777)
                    self.assertEqual((after.st_uid,after.st_gid),(info.st_uid,info.st_gid))
                self.assertEqual((mod/'enabled.txt').read_bytes(),b'original-marker')
                self.assertEqual((root/'DSSettings.txt').read_bytes(),b'original-config')
                self.assertFalse((root/driver.PROBE).exists())
                self.assertTrue(json.loads((private/'restoration.json').read_text())['restored'])

    def test_mismatch_blocks_before_snapshot_or_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);mod,hashes=self.make(root);(root/'PlayerPassword.json').write_bytes(b'drift')
            with patch.dict(driver.EXPECTED_PASSWORD_HASHES,hashes,clear=True):
                with self.assertRaises(ValueError):
                    with driver.transaction(root,b'probe'):self.fail('Drift admitted')
            self.assertEqual((mod/'enabled.txt').read_bytes(),b'original-marker')
            self.assertFalse((root/'.voltra/star-retention').exists())

    def test_between_snapshot_and_rotation_race_fails_closed_then_restores(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);mod,hashes=self.make(root);admin=(root/'Password.json').read_bytes()
            with patch.dict(driver.EXPECTED_PASSWORD_HASHES,hashes,clear=True):
                with self.assertRaises(ValueError):
                    with driver.transaction(root,b'probe'):
                        (root/'PlayerPassword.json').write_bytes(b'injected-race')
                        try:driver.rotate_passwords_for_trial(root)
                        finally:self.assertEqual((root/'Password.json').read_bytes(),admin)
                self.assertEqual(len(driver.verify_existing_passwords(root)),2)

    def test_existing_request_and_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);mod,hashes=self.make(root);(mod/'request.bin').write_bytes(b'unread')
            with patch.dict(driver.EXPECTED_PASSWORD_HASHES,hashes,clear=True):
                with self.assertRaises(ValueError):
                    with driver.transaction(root,b'probe'):self.fail('Request admitted')
            self.assertEqual((mod/'request.bin').read_bytes(),b'unread')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);mod,hashes=self.make(root);target=root/'PlayerPassword.json';target.unlink()
            try:target.symlink_to(root/'Password.json')
            except OSError:self.skipTest('Host denies symlink creation')
            with patch.dict(driver.EXPECTED_PASSWORD_HASHES,hashes,clear=True):
                with self.assertRaises(ValueError):driver.verify_existing_passwords(root)

    def test_driver_policy_and_commitment_order(self):
        code=(HERE/'retention-once.py').read_text();controller=(HERE/'retention-controller.mjs').read_text()
        self.assertLess(code.index('persist_random_test_commitments(private/'),code.index('fixture.supervise('))
        self.assertIn('audit.audit_files(root,credentials,commitments)',code)
        self.assertIn('timeout=90,stop_after=75',code)
        self.assertLess(controller.index("fs.writeFileSync(directory+'/random-test-commitments.json'"),controller.index("try{result=spawnSync('docker',args,"))
        self.assertIn("state.container+'-bound'",controller)
        self.assertIn('oceanArchive',controller);self.assertIn('oceanExecution',controller)
        self.assertNotIn("'--publish'",controller)

if __name__=='__main__':unittest.main()
