#!/usr/bin/env python3
"""MIT. Actual Python audits and staged adapter configuration; no native boot."""
import importlib.util
import json
from pathlib import Path
import secrets
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
audit=load('native_audit_v2_test','native-password-audit-v2.py')
native=load('native_audit_helpers','native-once.py')
game=native.shared_adapter()
exec(compile((HERE/'password-prerequisite-candidate.py').read_text(),'staged-password-prerequisite','exec'),game.__dict__)

class AuditTests(unittest.TestCase):
    def test_exact_schemas_and_rejections(self):
        self.assertEqual(audit.schema({'Password':'cipher'}),'native_uppercase')
        self.assertEqual(audit.schema({'password':'cipher'}),'published_legacy_lowercase')
        for value in ({'PASSWORD':'cipher'},{'PassWord':'cipher'},{'Password':'a','password':'b'},{'Password':''},{'Password':None},{'Password':123},[],{},'cipher'):
            self.assertEqual(audit.schema(value),'invalid')

    def test_plaintext_precedes_invalid_shape_and_parse(self):
        credential=secrets.token_urlsafe(32).encode();commitments=audit.random_test_commitments([credential])
        for body in (b'{bad '+credential,json.dumps({'UNKNOWN':credential.decode()}).encode(),json.dumps({'Password':credential.decode()}).encode()):
            result=audit.audit_body(body,[],commitments)
            self.assertTrue(result['plaintext_detected']);self.assertTrue(result['plaintext_audit_complete'])
        malformed=audit.audit_body(b'{bad '+credential,[],commitments)
        self.assertFalse(malformed['json_valid']);self.assertEqual(malformed['schema'],'invalid')

    def test_decoded_escaped_values_and_keys(self):
        credential=secrets.token_urlsafe(32).encode();commitments=audit.random_test_commitments([credential])
        escaped=''.join('\\u%04x'%b for b in credential)
        for body in ('{"UNKNOWN":"'+escaped+'"}','{"'+escaped+'":"x"}'):
            self.assertTrue(audit.audit_body(body.encode(),[],commitments)['plaintext_detected'])

    def test_clean_files_and_invalid_commitments_fail_closed(self):
        credential=secrets.token_urlsafe(32).encode();commitments=audit.random_test_commitments([credential])
        result=audit.audit_body(b'{"Password":"native-ciphertext-placeholder"}',[],commitments)
        self.assertFalse(result['plaintext_detected']);self.assertTrue(result['plaintext_audit_complete'])
        for bad in ([{'random_test_only':False,'length':43,'algorithm':'sha256','sha256':'a'*64}],[{'random_test_only':True,'length':4,'algorithm':'sha256','sha256':'a'*64}]):
            with self.assertRaises(ValueError):audit.audit_body(b'file',[],bad)
        with self.assertRaises(ValueError):audit.random_test_commitments([b'ordinary-user-password'])
        self.assertFalse(audit.audit_body(b'x'*(audit.MAXIMUM+1))['plaintext_audit_complete'])
        self.assertFalse(audit.audit_body(b'{"Password":"\\ud800"}')['plaintext_audit_complete'])
        absent=audit.audit_body(b'{"Password":"native-generated"}')
        self.assertFalse(absent['plaintext_reference_available']);self.assertIsNone(absent['plaintext_detected']);self.assertFalse(absent['plaintext_audit_complete'])

    def test_staged_adapter_preserves_both_explicit_formats(self):
        for field in ('Password','password'):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);path=root/'Password.json';path.write_text(json.dumps({field:'native-cipher'}));before=path.read_bytes()
                game.configure(root,'starrupture',{'SERVER_PORT':'28010','START_NEW':'false','LOAD_SAVE':'false'})
                self.assertEqual(path.read_bytes(),before)
                self.assertEqual(json.loads((root/'DSSettings.txt').read_text())['StartNewGame'],'false')

    def test_staged_adapter_rejects_invalid_before_config_mutation(self):
        for value in ({'PASSWORD':'x'},{'Password':'a','password':'b'},{'Password':''},{}):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);path=root/'Password.json';path.write_text(json.dumps(value));before=path.read_bytes()
                with self.assertRaises(ValueError):game.configure(root,'starrupture',{'SERVER_PORT':'28010'})
                self.assertEqual(path.read_bytes(),before);self.assertFalse((root/'DSSettings.txt').exists())

    def test_before_trial_commitment_receipt_is_exclusive_and_nonplaintext(self):
        credential=secrets.token_urlsafe(32).encode()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);root.chmod(0o700);path=root/'commitments.json'
            references=audit.persist_random_test_commitments(path,[credential])
            self.assertNotIn(credential,path.read_bytes())
            self.assertEqual(json.loads(path.read_text())['commitments'],references)
            self.assertTrue(audit.audit_body(b'{bad '+credential,[],references)['plaintext_detected'])
            before=path.read_bytes()
            with self.assertRaises(FileExistsError):audit.persist_random_test_commitments(path,[credential])
            self.assertEqual(path.read_bytes(),before)

if __name__=='__main__':unittest.main()
