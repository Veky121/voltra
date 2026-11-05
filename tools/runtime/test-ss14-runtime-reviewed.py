"""Offline SS14 emitted-installer and update regressions; no native execution."""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
import runpy
sys.dont_write_bytecode = True
adapter = runpy.run_path(str(Path(__file__).with_name('test-ss14-parity.py')))['adapter']
ROOT = Path(__file__).resolve().parents[2]

class ReviewedSS14(unittest.TestCase):
    def test_emitted_imports(self):
        p = json.loads((ROOT/'artifacts/game-parity-20261029/ss14-runtime-reviewed/candidate.json').read_text())
        script = p['spacestation_14/egg-spacestation14.json']['egg']['scripts']['installation']['script']
        with tempfile.TemporaryDirectory() as d:
            for name, delimiter, source in re.findall(r"cat > \.voltra/([a-z0-9_]+)\.py <<'([^']+)'\n([\s\S]*?)\n\2(?=\n)", script):
                Path(d, name+'.py').write_text(source, encoding='utf-8')
            result = subprocess.run([sys.executable, '-B', '-c', 'import ss14_parity; ss14_parity.selected_releases("x86_64"); ss14_parity.selected_releases("aarch64")'], cwd=d, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_manifest_mismatch_before_seed_or_acquisition(self):
        with tempfile.TemporaryDirectory() as d, patch.object(adapter, 'releases', return_value=({}, {'version':'other'})), patch.object(adapter, 'tar_install') as download:
            with self.assertRaisesRegex(ValueError, 'manifest'): adapter.install(d, {})
            self.assertEqual(list(Path(d).iterdir()), [])
            download.assert_not_called()

    def test_environment_cannot_override_native_file(self):
        with tempfile.TemporaryDirectory() as d, patch.object(adapter, 'run', return_value=0) as run:
            game=adapter.seed(d, {})
            before=(game/'server_config.toml').read_bytes()
            adapter.launch(d, {'SERVER_PORT':'28010', 'VOLTRA_ALLOCATED_PORTS':'28010', 'ROBUST_CVAR_game__hostname':'wrong', 'ROBUST_CVAR_net__port':'1', 'SERVER_TICK':'invalid'})
            self.assertFalse(any(k.startswith('ROBUST_CVAR') for k in run.call_args.args[2]))
            self.assertEqual(before,(game/'server_config.toml').read_bytes())

    def test_duplicate_and_bad_path_before_acquisition(self):
        for content in (b'[net]\ntickrate=30\ntickrate=60\n', b'[net]\ntickrate=30\n[net]\n', b'net.tickrate=30\n[net]\ntickrate=60\n'):
            with tempfile.TemporaryDirectory() as d, patch.object(adapter,'tar_install') as acquire, patch.object(adapter.platform,'machine',return_value='x86_64'):
                p=Path(d)/'ss14/server_config.toml';p.parent.mkdir();p.write_bytes(content)
                with self.assertRaises(ValueError):adapter.install(d,{})
                self.assertEqual(p.read_bytes(),content); acquire.assert_not_called()
        with tempfile.TemporaryDirectory() as d, patch.object(adapter,'tar_install') as acquire, patch.object(adapter.platform,'machine',return_value='x86_64'):
            p=Path(d)/'ss14/server_config.toml';p.mkdir(parents=True)
            with self.assertRaises(ValueError):adapter.install(d,{})
            acquire.assert_not_called()

    def test_mocked_update_success_and_failure_preserve_operator_files(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as d:
                root=Path(d); game=adapter.seed(root,{})
                (game/'data').mkdir(); (game/'data/operator.db').write_bytes(b'operator database')
                (game/'custom.toml').write_bytes(b'# retain\nsecret="opaque"\n')
                protected={p:p.read_bytes() for p in game.rglob('*') if p.is_file()}
                archive=root/'fixture.zip'
                with zipfile.ZipFile(archive,'w') as z:
                    for name in ('Robust.Server','content.bin','server_config.toml','data/operator.db','custom.toml'):z.writestr(name,'publisher')
                def download(release, destination):
                    destination.write_bytes(archive.read_bytes())
                    if fail:raise OSError('mock acquisition failure')
                original=adapter.native_zip_release.extract
                with patch.object(adapter.platform,'machine',return_value='x86_64'), patch.object(adapter,'tar_install'), patch.object(adapter.native_zip_release,'download',side_effect=download):
                    if fail:
                        with self.assertRaises(OSError):adapter.install(root,{})
                    else:adapter.install(root,{})
                self.assertIs(adapter.native_zip_release.extract, original)
                for p, content in protected.items():self.assertEqual(p.read_bytes(),content)
                self.assertEqual((game/'Robust.Server').exists(),not fail)

if __name__=='__main__':unittest.main(verbosity=2)

