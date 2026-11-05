"""Offline pending-only TD/RA component fixtures; no native server or network."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
def load(name, file):
    spec = importlib.util.spec_from_loader(name, loader=None)
    module = importlib.util.module_from_spec(spec)
    module.__file__ = str(file)
    sys.modules[name] = module
    exec(compile(file.read_text(), str(file), 'exec'), module.__dict__)
    return module
runtime = load('openra_td_pending', ROOT/'artifacts/game-parity-20261029/openra-td-wave10-shared-runtime.py.pending')
family = load('openra_td_family', ROOT/'internal/panel/game_library/scripts/openra-family.py')

def greeting(mod, version='release-20250330'):
    return struct.pack('<ii', 7, 0)+b'\xfeHandshakeRequest\n\tMod: '+mod.encode()+b'\n\tVersion: '+version.encode()+b'\n'

class Tests(unittest.TestCase):
    def test_cnc_publisher_asset_is_distinct(self):
        value = family.selected('release-20250330', 'cnc')
        self.assertEqual(value['bytes'], 55323128)
        self.assertEqual(value['sha256'], 'b3d202d1bf701be5989c41c256d19bd2b1788694df01e343ade865cf1190706b')
        self.assertTrue(value['url'].endswith('/OpenRA-Tiberian-Dawn-x86_64.AppImage'))
    def test_mod_specific_native_greetings(self):
        self.assertTrue(runtime.greeting_identity(greeting('cnc'), 'release-20250330', 'cnc'))
        self.assertTrue(runtime.greeting_identity(greeting('ra'), 'release-20250330'))
        for mod in ['ra', 'd2k']:
            self.assertFalse(runtime.greeting_identity(greeting(mod), 'release-20250330', 'cnc'))
        self.assertFalse(runtime.greeting_identity(greeting('cnc', 'release-20240101'), 'release-20250330', 'cnc'))
        self.assertFalse(runtime.greeting_identity(b'Starting dedicated server for mod: cnc', None, 'cnc'))
    def test_each_fragment_is_not_ready(self):
        value=greeting('cnc')
        for length in range(1,len(value)):
            self.assertFalse(runtime.greeting_identity(value[:length], 'release-20250330', 'cnc'))
    def fixture(self, root, mod='cnc'):
        (root/'.voltra/openra').mkdir(parents=True)
        (root/'.voltra/openra/release.json').write_text(json.dumps({'game':'openra','mod':mod,'version':'release-20250330'}))
    def test_shared_arguments_keep_startup_authority(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            argv,port,version=runtime.prepare(root, {'SERVER_PORT':'29101','AUTH':'true','PASSWORD':'synthetic'},family,'cnc')
            self.assertEqual(port,29101);self.assertEqual(version,'release-20250330')
            self.assertIn('Game.Mod=cnc',argv);self.assertIn('Server.RequireAuthentication=true',argv)
            self.assertIn('Server.Password=synthetic',argv)
            self.assertFalse(any('EnableSyncReports=' in value for value in argv))
    def test_wrong_receipt_and_invalid_control_refuse_without_creation(self):
        for change in [{'AUTH':'yes'}, {'SERVER_PORT':'0'}, {'PASSWORD':'bad\nvalue'}, {'SERVER_MAP':'../bad'}]:
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);self.fixture(root);env={'SERVER_PORT':'29101',**change}
                with self.assertRaises(ValueError):runtime.prepare(root,env,family,'cnc')
                self.assertFalse((root/'OpenRAData').exists())
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root,'ra')
            with self.assertRaises(ValueError):runtime.prepare(root,{'SERVER_PORT':'29101'},family,'cnc')
            self.assertFalse((root/'OpenRAData').exists())
    def test_modified_cnc_metadata_is_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root);metadata=root/'openra/mods/cnc/mod.yaml';metadata.parent.mkdir(parents=True)
            metadata.write_bytes(b'Metadata:\n\tVersion: custom-cnc-operator\n')
            receipt=root/'.voltra/openra/release.json';value=json.loads(receipt.read_text());value['files']={'mods/cnc/mod.yaml':hashlib.sha256(b'stock metadata').hexdigest()};receipt.write_text(json.dumps(value))
            before=metadata.read_bytes();argv,_,expected=runtime.prepare(root,{'SERVER_PORT':'29101'},family,'cnc')
            self.assertIsNone(expected);self.assertEqual(metadata.read_bytes(),before)
            self.assertTrue(runtime.greeting_identity(greeting('cnc','custom-cnc-operator'),expected,'cnc'))
    def test_shared_seed_preserves_existing_operator_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.assertTrue(runtime.seed_settings(root,'release-20250330'))
            target=root/'OpenRAData/settings.yaml';target.write_bytes(b'# operator\nUnknown:\n\tKeep: yes\n');before=target.read_bytes();mode=target.stat().st_mode
            self.assertFalse(runtime.seed_settings(root,'release-20250330'));self.assertEqual(target.read_bytes(),before);self.assertEqual(target.stat().st_mode,mode)

if __name__=='__main__':unittest.main()
