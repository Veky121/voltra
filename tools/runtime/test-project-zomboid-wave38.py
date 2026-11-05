import io
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

BASE = Path(__file__).resolve().parents[2]
steam = types.ModuleType('steam_template')
steam.Redactor = object
steam.update = lambda *a, **k: (_ for _ in ()).throw(AssertionError('unmocked acquisition'))
sys.modules['steam_template'] = steam
spec = importlib.util.spec_from_file_location('pz', BASE/'internal/panel/game_library/scripts/project-zomboid-runtime.py')
pz = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pz)

class OwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'jre64/bin').mkdir(parents=True)
        (self.root/'jre64/bin/java').write_bytes(b'fixture only')
        (self.root/'ProjectZomboid64.json').write_text(json.dumps(dict(mainClass='zombie.network.GameServer', classpath=['java/'], vmArgs=[])))
        self.env = dict(SERVER_PORT='23560',VOLTRA_ALLOCATED_PORTS='23560,23561',SERVER_NAME='Original42',SERVER_MEMORY='6144')
        self.ini = self.root/'.cache/Server/Original42.ini'
        self.ini.parent.mkdir(parents=True)
        self.memory = patch.object(pz,'available_memory',return_value=6144)
        self.memory.start(); self.addCleanup(self.memory.stop)
        self.process = patch.object(pz.subprocess,'Popen',side_effect=AssertionError('process forbidden'))
        self.process.start(); self.addCleanup(self.process.stop)
    def snapshot(self):
        return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
    def test_native_values_seed_once_ports_managed_identity_retained(self):
        original = b'# operator\r\nPublicName=Operator\r\nPassword=private\r\nMaxPlayers=8\r\nMods=one;two\r\nDefaultPort=1\r\nUDPPort=2\r\n'
        self.ini.write_bytes(original)
        argv,_ = pz.configure(self.root,self.env)
        self.assertIn('Original42',argv)
        result = self.ini.read_bytes()
        for line in original.splitlines(keepends=True)[:5]: self.assertIn(line,result)
        self.assertIn(b'DefaultPort=23560\r\n',result)
        before=self.snapshot(); pz.configure(self.root,{**self.env,'PUBLIC_NAME':'stale','SERVER_PASSWORD':'stale'})
        self.assertEqual(before,self.snapshot())
    def test_duplicate_refuses_before_credential_or_backup(self):
        self.ini.write_bytes(b'PublicName=a\nPublicName=b\n')
        before=self.snapshot()
        with self.assertRaises(ValueError): pz.configure(self.root,self.env)
        self.assertEqual(before,self.snapshot())
    def test_invalid_preflight_never_acquires(self):
        before=self.snapshot()
        with patch.object(pz,'update') as update:
            with self.assertRaises(ValueError): pz.run(self.root,{**self.env,'AUTO_UPDATE':'1','SERVER_NAME':'../wrong'})
            update.assert_not_called()
        self.assertEqual(before,self.snapshot())
    def test_update_failure_keeps_operator_state_and_never_starts(self):
        self.ini.write_bytes(b'PublicName=Operator\n')
        before=self.snapshot()
        with patch.object(pz,'update',side_effect=RuntimeError('mock update failed')):
            with self.assertRaises(RuntimeError): pz.run(self.root,{**self.env,'AUTO_UPDATE':'1'})
        self.assertEqual(before,self.snapshot())
    def test_successful_update_dispatch_is_single_and_process_is_mocked(self):
        child=Mock(stdout=io.BytesIO(b'')); child.wait.return_value=0
        with patch.object(pz,'Redactor',return_value=Mock(feed=lambda data, **kw: data)), patch.object(pz,'update') as update, patch.object(pz.subprocess,'Popen',return_value=child), patch.object(pz.threading.Thread,'start'), patch.object(pz.signal,'signal'):
            self.assertEqual(pz.run(self.root,{**self.env,'AUTO_UPDATE':'0','VOLTRA_STEAM_AUTO_UPDATE':'1'}),0)
            update.assert_called_once_with(self.root,380870,{**self.env,'AUTO_UPDATE':'0','VOLTRA_STEAM_AUTO_UPDATE':'1'},validate=False,required=('ProjectZomboid64.json','jre64/bin/java'))

    def test_valid_preflight_has_no_mutation(self):
        before=self.snapshot(); pz.configure(self.root,self.env,preflight=True)
        self.assertEqual(before,self.snapshot())
    def test_corrupt_database_preserved(self):
        db=self.root/'.cache/db/Original42.db'; db.parent.mkdir(); db.write_bytes(b'broken')
        before=self.snapshot()
        with self.assertRaises(ValueError): pz.configure(self.root,self.env)
        self.assertEqual(before,self.snapshot())
    def test_existing_credential_is_validated_before_mutation(self):
        credential=self.root/'.voltra/project-zomboid/admin-password'; credential.parent.mkdir(parents=True); credential.write_bytes(b'bad\nsecret')
        before=self.snapshot()
        with self.assertRaises(ValueError): pz.configure(self.root,self.env)
        self.assertEqual(before,self.snapshot())

if __name__ == '__main__': unittest.main()
