"""Offline RA readiness/validation fixtures, no Docker/network/native acquisition."""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/file); value=importlib.util.module_from_spec(spec);sys.modules[name]=value;spec.loader.exec_module(value);return value
ra=load('openra_ra_runtime_fixture','openra-ra-runtime.py');family=load('openra_ra_family_fixture','openra-family.py')
def greeting(mod='ra',version='release-20250330',protocol=7,client=0):
    return struct.pack('<ii',protocol,client)+b'\xfeHandshakeRequest\n\tMod: '+mod.encode()+b'\n\tVersion: '+version.encode()+b'\n'

class RARuntimeTests(unittest.TestCase):
    def test_publisher_startup_line_is_not_readiness(self):
        self.assertFalse(ra.greeting_identity(b'Starting dedicated server for mod: ra','release-20250330'))
    def test_matching_actual_greeting_shape_only(self):
        self.assertTrue(ra.greeting_identity(greeting(),'release-20250330'))
        for data in [greeting('cnc'),greeting(version='release-20240101'),greeting(protocol=8),greeting(client=-1),greeting()+b'\n\tMod: ra\n',greeting()[:8],greeting()+b'x'*131072]:
            with self.subTest(data=data[:32]):self.assertFalse(ra.greeting_identity(data,'release-20250330'))
    def test_fragmented_greeting_waits_for_identity(self):
        data=greeting()
        for index in range(1,len(data)):
            self.assertFalse(ra.greeting_identity(data[:index],'release-20250330'))
    def test_invalid_controls_refuse_before_support_creation(self):
        for extra in [dict(AUTH='yes'),dict(PASSWORD='bad\nvalue'),dict(SERVER_MAP='../bad'),dict(SERVER_PORT='0')]:
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as d:
                root=Path(d)
                with self.assertRaises(ValueError):ra.prepare(root,dict(SERVER_PORT='29101')|extra,family)
                self.assertEqual(list(root.iterdir()),[])
    def test_valid_args_and_literal_secret_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'.voltra/openra').mkdir(parents=True);(root/'.voltra/openra/release.json').write_text(json.dumps(dict(game='openra',mod='ra',version='release-20250330')))
            args,port,version=ra.prepare(root,dict(SERVER_PORT='29101',PASSWORD='literal; $(value)'),family)
            self.assertIn('Server.Password=literal; $(value)',args);self.assertIn('Game.Mod=ra',args);self.assertEqual(port,29101);self.assertEqual(version,'release-20250330')
    def test_wrong_receipt_refuses_before_support_creation(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'.voltra/openra').mkdir(parents=True);(root/'.voltra/openra/release.json').write_text(json.dumps(dict(game='openra',mod='cnc',version='release-20250330')))
            with self.assertRaises(ValueError):ra.prepare(root,dict(SERVER_PORT='29101'),family)
            self.assertFalse((root/'OpenRAData').exists())
    def test_real_shared_dependency_loading_and_raw_return_delegation(self):
        for raw in (-9,130):
            with self.subTest(raw=raw),tempfile.TemporaryDirectory() as d:
                root=Path(d);(root/'.voltra/openra').mkdir(parents=True);(root/'.voltra/openra/release.json').write_text(json.dumps(dict(game='openra',mod='ra',version='release-20250330')))
                original=ra.load;calls=[]
                def fixture_loader(name,file):
                    module=original(name,file)
                    if file=='native-console.py':
                        def run(*args,**kwargs):calls.append((args,kwargs));return raw
                        module.run=run
                    return module
                with patch.object(ra,'load',side_effect=fixture_loader),patch.object(ra,'native_greeting',return_value=True),patch('builtins.print'):
                    actual=ra.launch(root,dict(SERVER_PORT='29101',PASSWORD='SYNTHETIC-private'))
                self.assertEqual(actual,raw);self.assertEqual(len(calls),1)
                self.assertEqual(calls[0][0][0],root/'openra');self.assertEqual(calls[0][1]['stop_signal'],ra.signal.SIGINT);self.assertEqual(calls[0][1]['credentials'],('SYNTHETIC-private',))

if __name__=='__main__':unittest.main()
