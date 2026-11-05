import importlib.util
import json
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'artifacts/game-parity-20261029/puck-file-authority-source'

class AuthorityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        profile = json.loads((OUT/'profiles.fragment.json').read_text())['puck/egg-puck.json']
        canonical = json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['puck/egg-puck.json']
        self.assertEqual(profile['egg']['variables'], canonical['egg']['variables'])
        self.assertEqual(profile['egg']['config'], canonical['egg']['config'])
        sources = re.findall(r"cat > \.voltra/([^ ]+) <<'([^']+)'\n(.*?)\n\2", profile['egg']['scripts']['installation']['script'], re.S)
        self.modules = {}
        for name, _, source in sources:
            if name.endswith('.py'):
                compile(source, name, 'exec')
                (self.root/name).write_text(source)
        sys.path.insert(0, str(self.root))
        self.addCleanup(lambda: sys.path.remove(str(self.root)))
        for name in ['native_config','native_console','steam_template','light_games_next_runtime','light_games_next_install','puck_file_authority','puck_readiness']:
            previous = sys.modules.pop(name, None)
            self.addCleanup(lambda n=name, p=previous: sys.modules.__setitem__(n,p) if p else sys.modules.pop(n,None))
        import puck_file_authority
        self.adapter = puck_file_authority
        self.env = dict(SERVER_PORT='28011', QUERY_PORT='28012', VOLTRA_ALLOCATED_PORTS='28011,28012', MAX_PLAYERS='10', CLIENT_TICK_RATE='360', SRV_PASSWORD='environment')

    def write(self, name, obj):
        (self.root/name).write_text(json.dumps(obj))

    def test_seed_and_precedence(self):
        docs, env = self.adapter.prepare(self.root, self.env)
        self.assertEqual(docs[1][1]['password'], 'environment')
        self.write('server_configuration.json', dict(kickTimeout=41,targetFrameRate=90,serverTickRate=60,clientTickRate=100,name='legacy',maxPlayers=5,password='legacy'))
        self.write('server_config.json', dict(name='native',password='native',maxPlayers=8,tickRate=200,useWhitelist=True,mods=[],unknown={'x':[1,2]}))
        self.write('public_game_mode_config.json', dict(phaseDurationMap={'Play':17}, unknown=True))
        docs, env = self.adapter.prepare(self.root, self.env)
        self.assertEqual((docs[1][1]['name'],docs[1][1]['password'],docs[1][1]['maxPlayers']), ('native','native',8))
        self.assertEqual(env['CLIENT_TICK_RATE'], '200')
        self.assertEqual(env['KICK_TIMEOUT'], '41')
        self.assertEqual(docs[1][1]['mods'], [])
        self.assertEqual(docs[2][1]['phaseDurationMap'], {'Play':17})
        self.assertEqual(docs[1][1]['unknown'], {'x':[1,2]})
        self.assertEqual(docs[1][1]['port'],28011)

    def test_refusal_before_acquisition(self):
        for filename, content in [('server_config.json','{"tickRate":1,"tickRate":2}'),('public_game_mode_config.json','{"x":NaN}'),('server_configuration.json','[]'),('server_config.json','{"useWhitelist":"yes"}'),('server_configuration.json','{"kickTimeout":true}')]:
            with self.subTest(filename=filename,content=content):
                path=self.root/filename
                path.write_text(content)
                update=Mock(side_effect=AssertionError('acquisition reached'))
                with patch.dict(sys.modules, {'light_games_next_install':types.SimpleNamespace(install=update)}):
                    with self.assertRaises(ValueError): self.adapter.install(self.root,self.env)
                update.assert_not_called()
                self.assertEqual(path.read_text(),content)
                path.unlink()

    def test_second_boot_retains_files_and_refuses_unallocated_ports(self):
        docs, _ = self.adapter.prepare(self.root, self.env)
        for path, value, _ in docs: path.write_text(json.dumps(value))
        originals = {path:path.read_bytes() for path, _, _ in docs}
        changed = dict(self.env, MAX_PLAYERS='23', SRV_PASSWORD='changed', CLIENT_TICK_RATE='400')
        next_docs, _ = self.adapter.prepare(self.root, changed)
        self.assertEqual(next_docs[1][1]['maxPlayers'], 10)
        self.assertEqual(next_docs[1][1]['password'], 'environment')
        self.assertEqual(next_docs[1][1]['tickRate'], 360)
        with self.assertRaises(ValueError): self.adapter.prepare(self.root, dict(changed,QUERY_PORT='28013'))
        for path, content in originals.items(): self.assertEqual(path.read_bytes(), content)

    def test_mocked_update_preserves_exact_bytes_success_and_failure(self):
        import light_games_next_install as installer
        for failure in [False,True]:
            originals={name:b'{ "unknown": [1, 2] }\n' for name in ['server_configuration.json','server_config.json','public_game_mode_config.json']}
            for name, content in originals.items(): (self.root/name).write_bytes(content)
            def update(*args,**kwargs):
                for name in originals: (self.root/name).write_text('{}')
                if failure: raise RuntimeError('mock update failed')
                return {'mock':True}
            with patch.object(installer.steam_template,'arguments'),patch.object(installer.steam_template,'update',side_effect=update),patch.object(installer,'build_puck_plugin'):
                if failure:
                    with self.assertRaises(RuntimeError): self.adapter.install(self.root,self.env)
                else: self.assertEqual(self.adapter.install(self.root,self.env),{'mock':True})
            for name, content in originals.items(): self.assertEqual((self.root/name).read_bytes(),content)

if __name__ == '__main__': unittest.main()
