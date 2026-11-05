"""Offline generated-installer checks. Acquisition commands are refusing test doubles."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path.cwd()
RECIPE = 'pixark/egg-pix-a-r-k.json'
OUT = ROOT / 'artifacts/pixark-installer-followup'
BASH = 'C:/Program Files/Git/bin/bash.exe'
ENV = {'SERVER_PORT': '7777', 'VOLTRA_ALLOCATED_PORTS': '7777,7778,7779,7780,7781',
       'ARK_ADMIN_PASSWORD': 'Offline_Fixture_123', 'SRV_NAME': 'OfflineFixture',
       'WINETRICKS_RUN': 'vcrun2019 dotnet6'}

def snapshot(root):
    return {str(p.relative_to(root)): ('directory' if p.is_dir() else hashlib.sha256(p.read_bytes()).hexdigest())
            for p in root.rglob('*')}

class InstallerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile = json.loads((OUT / 'profiles.json').read_text())[RECIPE]
        cls.script = cls.profile['egg']['scripts']['installation']['script']

    def test_order_and_shell_syntax(self):
        script = self.script
        pre = script.index('python3 "$helper_stage/pixark_owner_next.py" preflight')
        for command in ('apt-get update', 'apt-get install', 'mkdir -p .voltra', 'cp --',
                        'python3 .voltra/bundle_debian_python.py', 'python3 .voltra/pixark_owner_next.py install'):
            self.assertGreater(script.index(command), pre)
        result = subprocess.run([BASH, '-n'], input=script, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def exercise(self, changes, prepared=False, wine=True, badpath=False):
        with tempfile.TemporaryDirectory(prefix='pixark-offline-') as temporary:
            area = Path(temporary); volume = area / 'volume'; volume.mkdir()
            native = volume / 'ShooterGame/Saved/PteroPixArk/Config/WindowsServer/GameUserSettings.ini'
            native.parent.mkdir(parents=True)
            native.write_bytes(b'; operator\r\n[ServerSettings]\r\nUnknown=one\r\nUnknown=two\r\n')
            (volume / 'operator.txt').write_bytes(b'unchanged')
            if prepared:
                prefix = volume / '.voltra/ark/pixark-prefix'; prefix.mkdir(parents=True)
                (prefix / 'system.reg').write_bytes(b'offline existence fixture, no dependency attestation')
            if badpath:
                (volume / '.voltra/steam_template.py').mkdir(parents=True)
            before = snapshot(volume)
            commands = area / 'bin'; commands.mkdir()
            python = sys.executable.replace('\\', '/')
            (commands / 'python3').write_text('#!/bin/bash\nexec "' + python + '" "$@"\n', newline='\n')
            if wine:
                (commands / ('wine.exe' if os.name == 'nt' else 'wine')).write_text('#!/bin/bash\nexit 99\n', newline='\n')
            # Even a regression past preflight cannot acquire packages or a game.
            marker = area / 'acquisition-called'
            (commands / 'apt-get').write_text('#!/bin/bash\nprintf called > "' + marker.as_posix() + '"\nexit 87\n', newline='\n')
            script = self.script.replace('cd /mnt/server\n', 'cd "' + volume.as_posix() + '"\n', 1)
            env = {**os.environ, **ENV, **changes, 'PATH': commands.as_posix() + os.pathsep + os.environ['PATH']}
            result = subprocess.run([BASH, '-s'], input=script, text=True, capture_output=True, env=env, timeout=30)
            self.assertEqual(snapshot(volume), before, result.stderr)
            return result, marker.exists()

    def test_invalid_prerequisite_blocks_acquisition_and_preserves_paths(self):
        result, called = self.exercise({})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Prepare the private PixARK Wine prerequisites', result.stderr)
        self.assertFalse(called)

    def test_invalid_scalars_allocations_transport_and_architecture(self):
        for changes in ({'MAX_PLAYERS':'0'}, {'SRV_NAME':'bad?name'},
                        {'VOLTRA_ALLOCATED_PORTS':'7777'}, {'WINEARCH':'win32'},
                        {'INSTALL_FLAGS':'arbitrary'}, {'WINEDEBUG':'bad\nvalue'}):
            with self.subTest(changes=changes):
                result, called = self.exercise({**changes, 'WINE_PREREQUISITES_READY':'1'}, prepared=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(called, result.stderr)

    def test_invalid_managed_path_refuses_before_acquisition(self):
        result, called = self.exercise({'WINE_PREREQUISITES_READY':'1'}, prepared=True, badpath=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Invalid PixARK managed helper path', result.stderr)
        self.assertFalse(called)

    def test_staged_imports_and_valid_preflight_reach_only_refusing_acquisition_stub(self):
        result, called = self.exercise({'WINE_PREREQUISITES_READY':'1'}, prepared=True)
        self.assertEqual(result.returncode, 87, result.stderr)
        self.assertTrue(called)

if __name__ == '__main__':
    unittest.main()
