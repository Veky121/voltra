"""Offline only: execute installer-emitted modules in isolated subprocesses."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / 'artifacts/game-parity-20261029/r5reloaded-owner'
PROFILE = json.loads((REPORT / 'profile.pending.json').read_text())['r5reloaded/egg-r5-reloaded.json']
SCRIPT = PROFILE['egg']['scripts']['installation']['script']

class EmittedR5(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.modules = self.root / 'modules'
        self.modules.mkdir()
        # Extract actual installer heredocs, not a separately copied source.
        for name, body in re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_R5_SOURCE'\n(.*?)\nVOLTRA_R5_SOURCE\n", SCRIPT, re.S):
            (self.modules / name).write_text(body, encoding='utf-8')
        exe = bytearray(128)
        exe[:2] = b'MZ'
        struct.pack_into('<I', exe, 60, 64)
        exe[64:68] = b'PE\0\0'
        struct.pack_into('<H', exe, 68, 0x8664)
        (self.root / 'r5apex_ds.exe').write_bytes(exe)
        for name, data in {'paks/Win64_Server/test.rpak': b'inert marker', 'platform/cfg/operator.cfg': b'\xef\xbb\xbf// unknown\r\nexec custom.cfg\r\nsecret "keep"\r\n', 'mods/unknown.bin': bytes(range(256)), 'players/state': b'owned state'}.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.env = {**os.environ, 'SERVER_PORT': '37015', 'VOLTRA_ALLOCATED_PORTS': '37015', 'INSTALL_MODE': 'existing', 'AUTO_UPDATE': '0', 'PYTHONDONTWRITEBYTECODE': '1'}
        for key in ('PYTHONHOME', 'PYTHONPATH'):
            self.env.pop(key, None)

    def snapshot(self):
        return {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.root.rglob('*') if p.is_file()}

    def install(self, **env):
        return subprocess.run([sys.executable, '-I', '-B', str(self.modules / 'r5reloaded-owner.py'), 'install'], cwd=self.root, env={**self.env, **env}, capture_output=True)

    def test_emitted_imports_and_repeatable_existing_package_update(self):
        before = self.snapshot()
        for _ in range(2):
            result = self.install()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.snapshot(), before)
        # The operator replaces its own build. Adapter accepts it without
        # reverting version/payload or touching configuration and mods.
        with (self.root / 'r5apex_ds.exe').open('ab') as f:
            f.write(b'operator-selected-build')
        before = self.snapshot()
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_failed_update_preflight_is_byte_preserving(self):
        for patch in ({'INSTALL_MODE': 'download'}, {'SERVER_PORT': '37016'}, {'ARGS': '+hostname override'}, {'PLAYLIST': 'bad;exec bad'}):
            before = self.snapshot()
            self.assertNotEqual(self.install(**patch).returncode, 0)
            self.assertEqual(self.snapshot(), before)
        (self.root / 'r5apex_ds.exe').write_bytes(b'incomplete operator update')
        before = self.snapshot()
        self.assertNotEqual(self.install().returncode, 0)
        self.assertEqual(self.snapshot(), before)

    def test_actual_installer_preflight_before_server_mutation(self):
        code = SCRIPT.split("python3 - <<'VOLTRA_R5_PREFLIGHT'\n", 1)[1].split('\nVOLTRA_R5_PREFLIGHT', 1)[0]
        before = self.snapshot()
        result = subprocess.run([sys.executable, '-B', '-'], cwd=self.root, env=self.env, input=code.encode(), capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.snapshot(), before)
        result = subprocess.run([sys.executable, '-B', '-'], cwd=self.root, env={**self.env, 'INSTALL_MODE': 'download'}, input=code.encode(), capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.snapshot(), before)


    @unittest.skipUnless(os.name == 'posix', 'Full emitted Bash harness requires local POSIX tools')
    def test_full_shell_bootstrap_and_preservation(self):
        # Only /mnt/server is rebound to this disposable fixture. All emitted
        # shell, preflight and module bytes otherwise run as staged. Package
        # tooling and the bundle invocation are mocked: no network/system writes.
        with tempfile.TemporaryDirectory(prefix='r5-shell-tools-') as tooling:
            tools = Path(tooling)
            log = tools / 'events'
            wrapper = tools / 'python-wrapper'
            wrapper.write_text('#!/bin/bash\n'
                'if [[ "$1" == ".voltra/bundle-debian-python.py" ]]; then\n'
                '  echo bundle >> "$R5_EVENTS"; exit 0\nfi\n'
                'echo preflight-or-install >> "$R5_EVENTS"\n'
                'exec ' + shlex.quote(sys.executable) + ' "$@"\n')
            wrapper.chmod(0o755)
            for name in ('cat', 'mkdir'):
                (tools / name).symlink_to(shutil.which(name))
            apt = tools / 'apt-get'
            apt.write_text('#!/bin/bash\n'
                'echo "apt:$*" >> "$R5_EVENTS"\n'
                '[[ "${R5_PACKAGE_FAIL:-0}" != 1 ]] || exit 42\n'
                'if [[ "$1" == install && "${R5_NO_PYTHON:-0}" != 1 ]]; then\n'
                ' /bin/ln -s "$R5_WRAPPER" "$R5_TOOLS/python3"\nfi\n')
            apt.chmod(0o755)
            script = SCRIPT.replace('cd /mnt/server\n', 'cd ' + shlex.quote(str(self.root)) + '\n', 1)
            self.assertNotIn('cd /mnt/server\n', script)
            shellenv = {**self.env, 'PATH': str(tools), 'R5_EVENTS': str(log),
                        'R5_WRAPPER': str(wrapper), 'R5_TOOLS': str(tools)}
            before = self.snapshot()
            def run(**patch):
                return subprocess.run(['/bin/bash'], input=script.encode(), env={**shellenv, **patch}, capture_output=True)
            # Bootstrap failure and a package manager claiming success without
            # supplying Python must both refuse before operator-volume writes.
            for patch in ({'R5_PACKAGE_FAIL': '1'}, {'R5_NO_PYTHON': '1'}):
                self.assertNotEqual(run(**patch).returncode, 0)
                self.assertEqual(self.snapshot(), before)
                self.assertFalse((self.root / '.voltra').exists())
            log.unlink()
            result = run(INSTALL_MODE='download')
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.snapshot(), before)
            self.assertFalse((self.root / '.voltra').exists())
            events = log.read_text().splitlines()
            self.assertEqual(events[:2], ['apt:update', 'apt:install -y --no-install-recommends python3 ca-certificates'])
            self.assertNotIn('bundle', events)
            # Remove the mock-installed interpreter and exercise successful
            # bootstrap, then the interpreter-already-present repeat path.
            (tools / 'python3').unlink()
            log.unlink()
            result = run()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(log.read_text().splitlines(), ['apt:update', 'apt:install -y --no-install-recommends python3 ca-certificates', 'preflight-or-install', 'bundle', 'preflight-or-install'])
            after = self.snapshot()
            self.assertEqual({k:v for k,v in after.items() if not k.startswith('.voltra/')}, before)
            log.unlink()
            self.assertEqual(run().returncode, 0)
            self.assertEqual(self.snapshot(), after)
            self.assertNotIn('apt:', log.read_text())
            # Existing installation survives failed revalidation byte-for-byte.
            self.assertNotEqual(run(ARGS='+hostname override').returncode, 0)
            self.assertEqual(self.snapshot(), after)

if __name__ == '__main__':
    unittest.main(verbosity=2)

