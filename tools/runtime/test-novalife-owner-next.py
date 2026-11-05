"""Scoped offline tests; no Docker, downloads or native process."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, BASE / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod
for filename in ('steam-template.py','native-config.py','native-console.py','fantasy-worlds-runtime.py','fantasy-worlds-install.py','fantasy-worlds-wine-build.py','fantasy-worlds-wine.py','sandbox-servers-release.py','sandbox-servers.py'):
    load(filename[:-3].replace('-', '_'), filename)
app = load('novalife_owner_next', 'novalife-owner-next.py')
shared = app.shared
shared.defaults = lambda: json.loads((BASE / 'sandbox-servers-defaults.json').read_text())
class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='voltra-nova-offline-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.env = {'SERVER_NAME':'TestRP','SERVER_PORT':'7777','VOLTRA_ALLOCATED_PORTS':'7777,27015,27016','SERVER_LIST_NAME':'Old environment','SERVER_SLOTS':'25'}
        self.path = self.root / 'Servers/TestRP/Config/server.json'
        self.path.parent.mkdir(parents=True)
    def write(self, data):
        self.path.write_bytes(data)
        return data
    def test_native_authority_no_rewrite_or_mode_change(self):
        data = self.write(b'{ "serverPort":7777,"serverListName":"Operator","serverSlot":12,"future":{"rows":[1,1],"password":"private"}}\r\n')
        mode = self.path.stat().st_mode
        with patch.object(shared, 'nova', app.nova):
            argv, env, secrets, marker = shared.configure(self.root, 'nova', self.env)
        self.assertEqual(self.path.read_bytes(), data)
        self.assertEqual(self.path.stat().st_mode, mode)
        self.assertIn('private', secrets)
        self.assertEqual(argv[-2:], ['-logFile','-'])
    def test_conflicts_and_ambiguous_json_refuse_without_change(self):
        for data, change in [(b'{"serverPort":7778}',{}),(b'{"serverPort":7777,"serverSlot":1,"serverSlot":2}',{}),(b'{"serverPort":7777,"future":{"x":1,"x":2}}',{}),(b'{"serverPort":7777}',{'QUERY_PORT':'27015'}),(b'{bad',{})]:
            self.write(data)
            with self.assertRaises((ValueError, json.JSONDecodeError)):
                app.nova(self.root, {**self.env, **change})
            self.assertEqual(self.path.read_bytes(), data)
    def test_missing_file_seed_and_literal_profile(self):
        updates, argv, _, _ = app.nova(self.root, self.env)
        self.assertEqual(updates[0][1]['serverSlot'],25)
        self.assertEqual(updates[0][1]['serverListName'],'Old environment')
        self.assertFalse(self.path.exists())
        with self.assertRaises(ValueError): app.nova(self.root,{**self.env,'SERVER_NAME':'../escape'})
    def test_update_cannot_bypass_prerequisites(self):
        with patch.object(app, '_original_install', return_value='offline') as install:
            self.assertEqual(app.install(self.root,'nova',self.env,validate=False),'offline')
            self.assertTrue(install.call_args.kwargs['validate'])
    def test_real_preflight_refuses_before_update(self):
        for change in ({'STEAM_USER':'owner'},{'STEAM_PASS':'private'},{'EXTRA_FLAGS':'+quit'},{'SERVER_PORT':'9999'}):
            with patch.object(shared,'nova',app.nova), patch.object(shared.steam_template,'update',side_effect=AssertionError('must not acquire')):
                with self.assertRaises(ValueError): app.install(self.root,'nova',{**self.env,**change},validate=False)
            self.assertFalse(self.path.exists())
if __name__ == '__main__': unittest.main(verbosity=2)
