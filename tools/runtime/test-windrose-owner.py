"""Offline emitted-installer tests; no Wine, Steam, network or game execution."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/windrose-owner'


if '--emitted' not in sys.argv:
    with tempfile.TemporaryDirectory(prefix='windrose-emitted-') as tmp:
        profile = json.loads((OUT / 'profile-proposal.json').read_text())['windrose/egg-windrose.json']
        script = profile['egg']['scripts']['installation']['script']
        emitted = re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE\n", script, re.S)
        assert len(emitted) == 11, len(emitted)
        for name, body in emitted: (Path(tmp) / name).write_bytes(body.encode())
        result = subprocess.run([sys.executable, '-B', '-I', str(Path(__file__).resolve()), '--emitted', tmp], capture_output=True, text=True)
        (OUT / 'offline-tests.txt').write_text(result.stdout + result.stderr)
        print(result.stdout + result.stderr)
        sys.exit(result.returncode)

sys.path.insert(0, sys.argv[2])
import windrose_owner as game
sys.argv = [sys.argv[0]]


class WindroseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'R5/ServerDescription.json'
        self.path.parent.mkdir()
        self.initial = b'\xef\xbb\xbf{\r\n "unknown": [1e+09, {"escaped":"\\u0041"},1,1],\r\n "ServerDescription_Persistent": {"PersistentServerId":"fixture-server", "WorldIslandId":"fixture-world", "ServerName":"Operator", "Password":"secret", "IsPasswordProtected":true, "MaxPlayerCount":8, "P2pProxyAddress":"127.0.0.1", "UseDirectConnection":false, "InviteCode":"Abc123"}\r\n}\r\n'
        self.path.write_bytes(self.initial)
        if os.name == 'nt':
            for name in ('fchown', 'chown'):
                context = patch.object(os, name, create=True)
                context.start()
                self.addCleanup(context.stop)

    def test_native_authority_lossless_allocation_and_idempotence(self):
        game.configure(self.root, {'SERVER_NAME': 'Old environment', 'SERVER_PORT':'28010'})
        after = self.path.read_bytes()
        self.assertTrue(after.startswith(b'\xef\xbb\xbf'))
        self.assertIn(b'"unknown": [1e+09, {"escaped":"\\u0041"},1,1]', after)
        self.assertIn(b'"ServerName":"Operator"', after)
        self.assertIn(b'"Password":"secret"', after)
        game.configure(self.root, {'SERVER_PORT':'28010'})
        self.assertEqual(after, self.path.read_bytes())
        game.configure(self.root, {'SERVER_PORT':'28011'})
        self.assertEqual(after.replace(b'28010',b'28011'), self.path.read_bytes())

    def test_seed_once_preserves_later_native_edit(self):
        self.path.write_bytes(b'{"ServerDescription_Persistent":{"PersistentServerId":"fixture","WorldIslandId":"fixture"}}')
        game.configure(self.root, {'SERVER_NAME':'Seed'})
        self.path.write_bytes(self.path.read_bytes().replace(b'Seed', b'User'))
        game.configure(self.root, {'SERVER_NAME':'Second seed'})
        self.assertIn(b'User', self.path.read_bytes())
        self.assertNotIn(b'Second seed', self.path.read_bytes())

    def test_all_invalid_prerequisites_refuse_without_changes_or_acquisition(self):
        for env in ({'SERVER_PORT':'70000'}, {'VOLTRA_ALLOCATED_PORTS':'123'}, {'AUTO_UPDATE':'bad'}, {'WINEARCH':'win32'}, {'STEAM_PASS':'secret'}, {'INSTALL_FLAGS':'+quit'}):
            with self.subTest(env=env), patch.object(game.shared, 'update') as acquire:
                with self.assertRaises(ValueError): game.install(self.root, env)
                acquire.assert_not_called()
                self.assertEqual(self.path.read_bytes(), self.initial)
                self.assertFalse((self.root / '.voltra').exists())
        for body in (b'{"x":1,"x":2}', b'{"x":NaN}', b'/*comment*/{}', self.initial.replace(b'"IsPasswordProtected":true', b'"IsPasswordProtected":false')):
            self.path.write_bytes(body)
            with self.assertRaises(ValueError): game.configure(self.root, {})
            self.assertEqual(self.path.read_bytes(), body)

    def test_missing_identity_before_acquisition(self):
        self.path.unlink()
        with patch.object(game.shared, 'update') as acquire:
            with self.assertRaises(ValueError): game.install(self.root, {})
            acquire.assert_not_called()
        self.assertFalse(self.path.exists())

    def test_update_failure_and_success_retains_native_world_backup_mods(self):
        names=['R5/Saved/SaveProfiles/Default/RocksDB_v2/world/db','R5/Saved/SaveProfiles/Default/RocksDB_v2_Backups/world/db','R5/Content/Paks/~mods/operator.pak','R5/Plugins/config.ini']
        for name in names:
            p=self.root/name
            p.parent.mkdir(parents=True,exist_ok=True)
            p.write_bytes(b'operator\x00\xff')
        paths=[self.path]+[self.root/n for n in names]
        before={p:p.read_bytes() for p in paths}
        for failure in (True, False):
            def update(*args, **kwargs):
                for p in paths: p.write_bytes(b'publisher replacement')
                if failure: raise RuntimeError('simulated update failure')
                return {'fixture_only': True}
            with patch.object(game.shared, 'update', side_effect=update):
                if failure:
                    with self.assertRaises(RuntimeError): game.install(self.root, {})
                else: game.install(self.root, {})
            self.assertEqual(before,{p:p.read_bytes() for p in paths})


unittest.main(verbosity=2)
