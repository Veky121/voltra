"""DST wave38 source-only regressions. No game or network processes."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'internal/panel/game_library/scripts'
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
ini = load('native_config', 'native-config.py')
steam = load('steam_template', 'steam-template.py')
shards = load('native_shards', 'native-shards.py')
config = load('dst_config', 'dst-config.py')
install = load('dst_install', 'dst-install.py')
runtime = load('dst_runtime', 'dst-runtime.py')
ENV = dict(SERVER_PORT='10998', VOLTRA_ALLOCATED_PORTS='10998,10999,23563,23565,23567,23569', ONLINE_MODE='0')

def snapshot(root):
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}

class DSTWave38(unittest.TestCase):
    def test_all_ini_preflight_preserves_bytes_on_late_failure(self):
        for relative, content in [('Caves/server.ini', '[NETWORK]\nserver_port=1\nserver_port=2\n'), ('Master/server.ini', '[network]\nserver_port=1\nSERVER_PORT=2\n')]:
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                target = root / 'DoNotStarveTogether/config/server' / relative
                target.parent.mkdir(parents=True); target.write_text(content)
                before = snapshot(root)
                with self.assertRaises(ValueError): config.configure(root, ENV)
                self.assertEqual(snapshot(root), before)

    def test_seed_once_keeps_operator_bytes_and_mods(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); config.configure(root, ENV)
            cluster = root / 'DoNotStarveTogether/config/server'
            path = cluster / 'cluster.ini'
            content = path.read_text().replace('max_players = 16', 'max_players = 7').replace('cluster_password = ', 'cluster_password = operator-secret')
            content += '\n; keep unknown\n[Operator]\ncustom=bytes\n'
            path.write_bytes(content.replace('\n', '\r\n').encode())
            for shard in ('Master', 'Caves'):
                (cluster / shard / 'modoverrides.lua').write_bytes(b'return { custom = true }\r\n')
            before = snapshot(root)
            config.configure(root, {**ENV, 'MAX_PLAYERS': '22', 'CLUSTER_PASSWORD': 'env-secret'})
            self.assertEqual(snapshot(root), before)
            binary = root / install.BINARY; binary.parent.mkdir(); binary.write_bytes(b'fixture')
            self.assertIn('operator-secret', runtime.launch(root, ENV)[2])

    def test_invalid_auto_update_never_acquires_or_runs(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(runtime, 'update_game') as update, patch.object(runtime, 'run') as run:
            root = Path(directory)
            with self.assertRaises(ValueError): runtime.main(root, {**ENV, 'AUTO_UPDATE': '1', 'MAX_PLAYERS': '32'})
            update.assert_not_called(); run.assert_not_called(); self.assertEqual(snapshot(root), {})

    def test_positive_auto_update_boundaries_mocked(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(runtime, 'update_game') as update, patch.object(runtime, 'run', return_value=0) as run:
            root = Path(directory); binary = root / install.BINARY; binary.parent.mkdir(); binary.write_bytes(b'fixture only')
            self.assertEqual(runtime.main(root, {**ENV, 'AUTO_UPDATE': '1'}), 0)
            update.assert_called_once_with(root, validate=False); run.assert_called_once()
            self.assertEqual([x['name'] for x in run.call_args.args[1]], ['Master', 'Caves'])

    def test_mod_setup_restored_success_and_failure(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); target = root / 'mods/dedicated_server_mods_setup.lua'
                target.parent.mkdir(); target.write_bytes(b'-- operator\r\nServerModSetup("123")\n')
                before = target.read_bytes()
                def update(*args, **kwargs):
                    self.assertEqual(kwargs['required'], (install.BINARY,))
                    target.write_bytes(b'publisher')
                    if fail: raise RuntimeError('mock failure')
                    return {'mock': True}
                with patch.object(install, 'update', side_effect=update):
                    if fail:
                        with self.assertRaises(RuntimeError): install.update_game(root)
                    else: self.assertEqual(install.update_game(root), {'mock': True})
                self.assertEqual(target.read_bytes(), before)

    def test_worldgen_preflight_and_fetch_failure_no_partial_publish(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(install.urllib.request, 'urlopen', side_effect=RuntimeError('network mock')) as fetch:
            root = Path(directory)
            with self.assertRaises(ValueError): install.worldgen(root, dict(MASTER_WORLDGEN='https://example.test/master', CAVES_WORLDGEN='http://example.test/cave'))
            fetch.assert_not_called(); self.assertEqual(snapshot(root), {})
            with self.assertRaises(RuntimeError): install.worldgen(root, dict(MASTER_WORLDGEN='https://example.test/master'))
            self.assertEqual(snapshot(root), {})

    def test_worldgen_positive_and_existing_files_no_acquisition(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(install.urllib.request, 'urlopen') as fetch:
            root = Path(directory); bundled = root / '.voltra'; bundled.mkdir()
            for shard in ('master', 'caves'): (bundled / ('dst-worldgen-' + shard + '.lua')).write_text('return {}')
            env = {key: 'https://raw.githubusercontent.com/ptero-eggs/game-eggs/main/dont_starve/worldgenoverride.' + shard + '.lua' for key, shard in [('MASTER_WORLDGEN','master'), ('CAVES_WORLDGEN','caves')]}
            install.worldgen(root, env); before = snapshot(root)
            install.worldgen(root, dict(MASTER_WORLDGEN='invalid', CAVES_WORLDGEN='invalid'))
            self.assertEqual(snapshot(root), before); fetch.assert_not_called()

if __name__ == '__main__': unittest.main(verbosity=2)
