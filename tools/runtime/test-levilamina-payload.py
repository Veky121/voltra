"""Exercise the entire proposed installer, then its actual emitted helper."""
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/levilamina-installer-followup'
RECIPE = 'minecraft/bedrock/LeviLamina/egg-levi-lamina.json'


def hashes(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


class Installer(unittest.TestCase):
    def exercise(self, fault=None):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            payload = base / 'payload'; payload.mkdir()
            root = base / 'operator'; root.mkdir()
            pe = bytearray(128); pe[:2] = b'MZ'; struct.pack_into('<I', pe, 60, 64)
            pe[64:68] = b'PE\0\0'; struct.pack_into('<H', pe, 68, 0x8664)
            for name, data in {'bedrock_server_mod.exe': pe, 'bedrock_server.exe': pe,
                               'plugins/LeviLamina/LeviLamina.dll': b'fixture-only',
                               'server.properties': b'publisher-default',
                               'plugins/Custom/config.json': b'{}'}.items():
                path = payload / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            for name, data in {'server.properties': b'\xef\xbb\xbf# keep\r\nlevel-name=Operator',
                               'worlds/Operator/db/data': b'world',
                               'plugins/Custom/config.json': b'{"secret":"keep"}',
                               'lip-install.txt': b'github.com/operator/package'}.items():
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            inventory = base / 'inventory.json'; inventory.write_text(json.dumps(hashes(payload)))
            env = dict(os.environ, BEDROCK_TERMS_ACCEPTED='true', LEVI_PAYLOAD_DIR=str(payload), LEVI_PAYLOAD_SHA256_FILE=str(inventory))
            if fault == 'consent': env.pop('BEDROCK_TERMS_ACCEPTED')
            if fault == 'tamper': (payload / 'bedrock_server_mod.exe').write_bytes(b'bad')
            if fault == 'conflict': (root / 'bedrock_server.exe').write_bytes(b'operator-binary')
            if fault == 'directory': (root / 'plugins/LeviLamina').write_bytes(b'file')
            if fault == 'helper':
                (root / '.voltra').mkdir(); (root / '.voltra/levilamina_payload.py').write_text('operator')
            if fault == 'bad-pe':
                (payload / 'bedrock_server_mod.exe').write_bytes(b'MZbad')
                inventory.write_text(json.dumps(hashes(payload)))
            script = base / 'install.py'
            profile = json.loads((OUT / 'profile.pending.json').read_text())[RECIPE]
            script.write_text(profile['egg']['scripts']['installation']['script'], encoding='utf-8')
            before = hashes(root)
            result = subprocess.run([sys.executable, '-I', '-B', str(script)], cwd=root, env=env, capture_output=True, text=True)
            if fault:
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertEqual(before, hashes(root), result.stderr)
                return
            self.assertEqual(result.returncode, 0, result.stderr)
            for name, sha in before.items(): self.assertEqual(hashes(root)[name], sha)
            installed = hashes(root)
            repeat = subprocess.run([sys.executable, '-I', '-B', str(script)], cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(repeat.returncode, 0, repeat.stderr)
            self.assertEqual(installed, hashes(root))
            # Actual startup entry helper must refuse before Wine without consent.
            env.pop('BEDROCK_TERMS_ACCEPTED')
            start = subprocess.run([sys.executable, '-I', '-B', '.voltra/levilamina_payload.py', 'run'], cwd=root, env=env, capture_output=True, text=True)
            self.assertNotEqual(start.returncode, 0)
            self.assertIn('acceptance required', start.stderr)
            self.assertEqual(installed, hashes(root))

    def test_full_install_repeat_start_refusal(self): self.exercise()
    def test_consent(self): self.exercise('consent')
    def test_integrity(self): self.exercise('tamper')
    def test_managed_conflict(self): self.exercise('conflict')
    def test_file_directory_conflict(self): self.exercise('directory')
    def test_existing_helper(self): self.exercise('helper')
    def test_pe_architecture(self): self.exercise('bad-pe')


if __name__ == '__main__': unittest.main()
