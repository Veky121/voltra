"""Offline tests execute emitted installer bytes in isolated Python processes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
EMITTED = ROOT / 'artifacts/game-parity-20261029/levilamina-owner/installer-modules.json'
DRIVER = '''import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('levi',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
from pathlib import Path
config=json.loads(sys.argv[5])
print(json.dumps(m.stage(Path(sys.argv[2]),Path(sys.argv[3]),config['env'],config['arch'],[sys.executable,sys.argv[4]])))
'''


def hashes(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


class EmittedInstaller(unittest.TestCase):
    def exercise(self, change=None, failure=False, missing_binary=False):
        with tempfile.TemporaryDirectory(prefix='levi-offline-') as temporary:
            base = Path(temporary)
            module = base / 'levilamina_stage.py'
            module.write_text(json.loads(EMITTED.read_text())['levilamina_stage.py'], encoding='utf-8')
            root = base / 'operator'; root.mkdir()
            for name, data in {'worlds/level/db/data': b'world', 'mods/custom.bin': b'mod',
                               'plugins/Custom/plugin.dll': b'plugin',
                               'plugins/LeviLamina/config/Config.json': b'{"unknown":true}',
                               'server.properties': b'\xef\xbb\xbf# keep\r\nserver-name=Operator\r\n',
                               'permissions.json': b'[]', 'operator.unknown': b'private'}.items():
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            fake = base / 'fake_lip.py'
            fake.write_text('from pathlib import Path\nimport sys\n'
                            + ('' if missing_binary else 'Path("bedrock_server.exe").write_bytes(b"MZfixture")\n') +
                            'Path("server.properties").write_text("corrupt")\n'
                            'Path("plugins/Custom/plugin.dll").write_bytes(b"changed")\n'
                            'Path("plugins/LeviLamina/config/Config.json").write_text("{}")\n'
                            'sys.exit(' + ('9' if failure else '0') + ')\n')
            config = {'env': {'BEDROCK_TERMS_ACCEPTED': 'true', 'VERSION': '26.51.7'}, 'arch': 'x86_64'}
            if change: change(config, root)
            before = hashes(root)
            result = subprocess.run([sys.executable, '-I', '-B', '-c', DRIVER, str(module), str(root),
                                     str(base / 'stage'), str(fake), json.dumps(config)], capture_output=True, text=True)
            self.assertEqual(before, hashes(root), result.stderr)
            if failure or change or missing_binary:
                self.assertNotEqual(result.returncode, 0)
                if not failure and not missing_binary: self.assertFalse((base / 'stage').exists(), result.stderr)
            else:
                self.assertEqual(result.returncode, 0, result.stderr)
                receipt = json.loads(result.stdout)
                self.assertFalse(receipt['published'])
                self.assertFalse(receipt['native_verified'])
                staged = hashes(base / 'stage')
                for name, digest in before.items(): self.assertEqual(staged[name], digest, name)

    def test_success_preserves_operator_bytes(self): self.exercise()
    def test_failed_lip_preserves_original(self): self.exercise(failure=True)
    def test_missing_binary_is_not_success(self): self.exercise(missing_binary=True)
    def test_no_consent(self): self.exercise(lambda c, r: c['env'].pop('BEDROCK_TERMS_ACCEPTED'))
    def test_arm64_refused(self): self.exercise(lambda c, r: c.update(arch='aarch64'))
    def test_version_injection(self): self.exercise(lambda c, r: c['env'].update(VERSION='1.2.3;echo bad'))
    def test_world_traversal(self): self.exercise(lambda c, r: c['env'].update(WORLDNAME='../other'))
    def test_invalid_enum(self): self.exercise(lambda c, r: c['env'].update(GAMEMODE='unknown'))
    def test_multiline_name(self): self.exercise(lambda c, r: c['env'].update(SERVERNAME='a\nb'))
    def test_invalid_players(self): self.exercise(lambda c, r: c['env'].update(MAXPLAYERS='0'))
    def test_packages_require_review(self): self.exercise(lambda c, r: (r / 'lip-install.txt').write_text('github.com/example/Plugin'))


if __name__ == '__main__': unittest.main()
