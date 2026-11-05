"""Offline subprocess tests of the actual emitted installer module. No native code."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[2]
REPORT = BASE / 'artifacts/game-parity-20261029/liteloader-bootstrap-followup'
RECIPE = 'minecraft/bedrock/LiteLoader-bedrock/egg-LiteLoader-bedrock.json'


class OfflinePayload(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'server'
        self.payload = self.base / 'payload'
        self.root.mkdir(); self.payload.mkdir()
        self.env = {**os.environ, 'BEDROCK_TERMS_ACCEPTED': 'true', 'LL_VERSION': '2.15.0', 'BDS_VERSION': '1.20.11.01'}
        self.files = ('bedrock_server.exe', 'bedrock_server_mod.exe', 'LiteLoader.dll', 'server.properties')
        for name in self.files:
            (self.payload / name).write_bytes(b'fixture only ' + name.encode())
        self.manifest = {'loader': '2.15.0', 'bds': '1.20.11.01', 'platform': 'win-x64', 'sha256': {n: hashlib.sha256((self.payload/n).read_bytes()).hexdigest() for n in self.files}}
        (self.payload / 'manifest.json').write_text(json.dumps(self.manifest))
        for name in ('worlds/world/db/CURRENT', 'world/legacy', 'plugins/config.json', 'operator.ini', 'allowlist.json', 'permissions.json', 'server.properties'):
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'\xef\xbb\xbf# operator\r\nunknown=kept\r\n' + name.encode())
        self.before = self.snapshot()
        profile = json.loads((REPORT/'profile.pending.json').read_text())[RECIPE]
        self.module = profile['egg']['scripts']['installation']['script'].split("<<'VOLTRA_LITE'\n", 1)[1].rsplit('\nVOLTRA_LITE', 1)[0]

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def run_module(self, injection=''):
        code = self.module.replace('\nimport sys\n', '\n' + injection + '\nimport sys\n')
        return subprocess.run([sys.executable, '-I', '-c', code, str(self.root), str(self.payload)], env=self.env, capture_output=True, text=True)

    def test_emitted_bootstrap_and_canonical_controls(self):
        import runpy
        stager = runpy.run_path(str(BASE/'tools/runtime/stage-liteloader-offline.py'))
        first = stager['stage']()
        second = stager['stage']()
        self.assertEqual(first, second)
        canonical = json.loads((BASE/'internal/panel/game_library/overrides.json').read_text())[RECIPE]
        shell = first['egg']['scripts']['installation']
        self.assertEqual(shell['container'], canonical['egg']['scripts']['installation']['container'])
        self.assertEqual(shell['entrypoint'], 'ash')
        script = shell['script']
        self.assertLess(script.index('command -v python3'), script.index('apk add --no-cache python3'))
        self.assertLess(script.index('apk add --no-cache python3'), script.index('python3 - /mnt/server'))
        self.assertNotIn('apt-get', script)
        self.assertNotIn('wine PeEditor', script)
        self.assertEqual(first['egg']['variables'][:-1], canonical['egg']['variables'])
        self.assertEqual(first['egg']['startup'], canonical['egg']['startup'])
        self.assertEqual(first['defaults'], canonical['defaults'])
        self.assertEqual(first['egg']['config'], canonical['egg']['config'])

    def test_invalid_manifest_schema_no_writes(self):
        for manifest in ([], {}, {**self.manifest, 'extra': True}, {**self.manifest, 'sha256': {}}):
            (self.payload/'manifest.json').write_text(json.dumps(manifest))
            self.assertNotEqual(self.run_module().returncode, 0)
            self.assertEqual(self.snapshot(), self.before)

    def test_changed_staged_bytes_no_publication(self):
        injection = """
original_copy = shutil.copyfile
def corrupt_copy(source, target):
    result = original_copy(source, target)
    Path(target).write_bytes(b'changed during copy')
    return result
shutil.copyfile = corrupt_copy
"""
        self.assertNotEqual(self.run_module(injection).returncode, 0)
        self.assertEqual(self.snapshot(), self.before)

    def test_success_preserves_all_operator_bytes_and_repeated_update(self):
        for _ in range(2):
            result = self.run_module(); self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(json.loads(result.stdout)['native_ready'])
            for name, data in self.before.items(): self.assertEqual((self.root/name).read_bytes(), data)
        self.assertFalse(list(self.root.glob('.liteloader-update-*')))

    def test_seed_once(self):
        (self.root/'server.properties').unlink()
        self.assertEqual(self.run_module().returncode, 0)
        (self.root/'server.properties').write_bytes(b'changed unknown key')
        self.assertEqual(self.run_module().returncode, 0)
        self.assertEqual((self.root/'server.properties').read_bytes(), b'changed unknown key')

    def test_refusal_before_writes(self):
        cases = [('BEDROCK_TERMS_ACCEPTED', 'false'), ('BEDROCK_TERMS_ACCEPTED', ''), ('LL_VERSION', 'latest'), ('BDS_VERSION', 'latest'), ('BDS_VERSION', '1.26.50')]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                old = self.env[key]; self.env[key] = value
                self.assertNotEqual(self.run_module().returncode, 0)
                self.assertEqual(self.snapshot(), self.before)
                self.env[key] = old

    def test_corrupt_payload_no_writes(self):
        (self.payload/'LiteLoader.dll').write_bytes(b'bad')
        self.assertNotEqual(self.run_module().returncode, 0)
        self.assertEqual(self.snapshot(), self.before)

    def test_arm_refusal(self):
        result = self.run_module("platform.machine = lambda: 'aarch64'")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unsupported architecture', result.stderr)
        self.assertEqual(self.snapshot(), self.before)

    def test_destination_directory_refusal(self):
        (self.root/'LiteLoader.dll').mkdir()
        self.assertNotEqual(self.run_module().returncode, 0)
        self.assertEqual(self.snapshot(), self.before)

    def test_partial_publication_rollback(self):
        for n in self.files[:3]: (self.root/n).write_bytes(b'previous binary ' + n.encode())
        before = self.snapshot()
        injection = """
original_replace = os.replace
replace_count = 0
def fail_second(source, target):
    global replace_count
    replace_count += 1
    if replace_count == 2: raise OSError('simulated update failure')
    return original_replace(source, target)
os.replace = fail_second
"""
        result = self.run_module(injection)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('simulated update failure', result.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(list(self.root.glob('.liteloader-update-*')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
