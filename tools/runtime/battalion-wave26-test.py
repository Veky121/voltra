"""Battalion config preservation regressions; publisher acquisition is mocked."""
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('battalion_wave4', ROOT / 'tools/runtime/battalion-parity-wave4-test.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
installer = base.load('tactical_next_install')
RECIPE = 'battalion_legacy/egg-b-a-t-t-a-l-i-o-n--legacy.json'


class BattalionConfigurationPreservation(unittest.TestCase):
    def test_exact_emitted_module_names_and_imports(self):
        profile = json.loads((ROOT / 'internal/panel/game_library/overrides.json').read_text())[RECIPE]
        script = profile['egg']['scripts']['installation']['script']
        emitted = {}
        for name, marker, source in re.findall(r"cat > \.voltra/([^ ]+\.py) <<'([^']+)'\n(.*?)\n\2", script, re.S):
            emitted[name] = source
        self.assertIn('battalion_preflight.py', emitted)
        self.assertTrue(profile['egg']['startup'].endswith('.voltra/battalion_preflight.py'))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, source in emitted.items():
                (root / name).write_text(source, encoding='utf-8')
            # Import emitted files without executing installer or native process.
            import subprocess
            result = subprocess.run([sys.executable, '-B', '-c',
                'import battalion_preflight, tactical_next_runtime, tactical_next_install; '
                'assert tactical_next_install.GAMES["battalion"]["app"] == 805140'],
                cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        upstream = json.loads((ROOT / 'internal/panel/game_library/upstream/catalog.json').read_text())
        original = next(e['egg'] for e in upstream['entries'] if e['path'] == RECIPE)
        for index, row in enumerate(original['variables']):
            actual = profile['egg']['variables'][index]
            for key in ('env_variable', 'default_value', 'user_viewable', 'user_editable'):
                self.assertEqual(actual[key], row[key])
        self.assertEqual(profile['egg']['config']['stop'], '^C')

    def test_native_configuration_restored_after_mocked_update_success_and_failure(self):
        # Real installer preservation code; no SteamCMD, network or game process.
        for fail in (False, True):
            with self.subTest(update_failure=fail), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                binary = root / installer.GAMES['battalion']['binaries'][0]
                binary.parent.mkdir(parents=True)
                binary.write_bytes(b'fixture only')
                retained = {}
                for folder in installer.GAMES['battalion']['preserve']:
                    target = root / folder / 'operator.ini'
                    target.parent.mkdir(parents=True, exist_ok=True)
                    data = b'; comments\r\n[/Script/Unknown]\r\n+Array=one\r\n+Array=two\r\nSecret=fixture-only\r\nValue=(Nested=1)\r\n'
                    target.write_bytes(data)
                    retained[target] = data
                def update(*args, **kwargs):
                    for target in retained:
                        target.write_bytes(b'publisher replacement')
                    if fail:
                        raise RuntimeError('mocked acquisition failure')
                    return {'mocked': True}
                with patch.object(installer.os, 'geteuid', return_value=1000, create=True), patch.object(installer, 'arguments'), patch.object(installer, 'update', side_effect=update), patch.object(installer, '_publish', side_effect=lambda r, n, writer, mode: self.publish(r, n, writer)):
                    if fail:
                        with self.assertRaisesRegex(RuntimeError, 'mocked acquisition failure'):
                            installer.install(root, base.BASE)
                    else:
                        installer.install(root, base.BASE)
                for target, data in retained.items():
                    self.assertEqual(target.read_bytes(), data)
                self.assertFalse(list(root.glob('.tactical-next-retention-*')))

    @staticmethod
    def publish(root, name, writer):
        # Windows cannot exercise POSIX directory-FD publication; byte restore only.
        with (root / name).open('wb') as output:
            writer(output)


if __name__ == '__main__':
    unittest.main()
