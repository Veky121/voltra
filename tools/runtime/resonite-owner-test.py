"""Offline emitted-package checks, never imports runtime or starts a game."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/resonite-owner'


class Packaging(unittest.TestCase):
    def test_emitted_package(self):
        profile = json.loads((OUT/'profile.pending.json').read_text())['resonite/egg-resonite.json']
        canonical = json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['resonite/egg-resonite.json']
        self.assertEqual(profile['egg']['variables'], canonical['egg']['variables'])
        script = profile['egg']['scripts']['installation']['script']
        import re
        emitted = re.findall(r'cat > "\$stage/([^"\n]+)" <<\'VOLTRA_RESONITE_SOURCE\'\n(.*?)\nVOLTRA_RESONITE_SOURCE\n', script, re.S)
        self.assertEqual(len(emitted), 6)
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory)/'package'
            volume = Path(directory)/'volume'
            package.mkdir(); volume.mkdir()
            for name, content in emitted:
                (package/name).write_text(content, encoding='utf-8')
                if name.endswith('.py'):
                    compile(content, name, 'exec')
            config = volume/'Headless/Config/Config.json'
            config.parent.mkdir(parents=True)
            valid = {'startWorlds': [], 'unknown': {'nested': [1, 2]}, 'loginPassword': 'secret-fixture'}
            env = {**os.environ, 'AUTO_UPDATE':'0', 'SERVER_PORT':'12000', 'VOLTRA_ALLOCATED_PORTS':'12000'}
            env.pop('VOLTRA_STEAM_AUTO_UPDATE', None)
            def run(action='check', changes=None):
                return subprocess.run([sys.executable, '-I', str(package/'resonite_owner.py'), action], cwd=volume, env={**env, **(changes or {})}, capture_output=True)
            config.write_text(json.dumps(valid), encoding='utf-8')
            before = config.read_bytes()
            self.assertEqual(run().returncode, 0)
            self.assertEqual(config.read_bytes(), before)
            cases = ['{"startWorlds":[],"StartWorlds":[]}', '{"startWorlds":[],"tickRate":NaN}', '{"startWorlds":[],"tickRate":true}', '{"startWorlds":[{"saveOnExit":"false"}]}', '{"startWorlds":[{"forcePorts":{"lnl":12001}}]}', '{"startWorlds":[],"dataFolder":"../../escape"}']
            for content in cases:
                config.write_text(content, encoding='utf-8'); before=config.read_bytes()
                self.assertNotEqual(run().returncode, 0, content)
                self.assertEqual(config.read_bytes(), before)
            config.write_text(json.dumps(valid), encoding='utf-8')
            for changes in ({'AUTO_UPDATE':'1'}, {'ENABLE_MODLOADER':'yes'}, {'SRCDS_APPID':'1'}, {'SERVER_PORT':'0'}):
                self.assertNotEqual(run(changes=changes).returncode, 0)
            result=run('install')
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(b'secret-fixture', result.stderr)
            self.assertFalse((volume/'.voltra').exists())


if __name__ == '__main__':
    unittest.main()
