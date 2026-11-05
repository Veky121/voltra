"""Actual canonical planning and shared-supervisor fixtures; no game binary."""
import importlib.util
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
spec = importlib.util.spec_from_file_location('tachyon_preflight', BASE / 'tachyon-preflight.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class Tachyon(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.java = self.root / '.voltra/java8/bin/java'
        self.java.parent.mkdir(parents=True)
        self.java.write_text('#!' + sys.executable + '\nprint("fixture")\n')
        self.java.chmod(0o755)
        (self.root / 'tachyon').mkdir()
        (self.root / 'tachyon/TachyonsCEServer.jar').write_bytes(b'fixture-not-native')
        self.cfg = self.root / 'tachyon/config.cfg'
        self.original = b'-- operator\r\r\n  SERVER_PORT=30303  \r\r\nAUTOSAVE_TIME=300\r\r\nUnknown=untouched\r\r\n'
        self.cfg.write_bytes(self.original)
        self.cfg.chmod(0o640)
        self.env = {**os.environ, 'SERVER_PORT': '29108', 'VOLTRA_ALLOCATED_PORTS': '29108', 'SERVER_MEMORY': '1024'}

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_valid_plan_changes_only_port_span_and_is_pure(self):
        before = self.snapshot()
        _, old, new, _, args, env = adapter.plan(self.root, self.env)
        self.assertEqual(old.encode(), self.original)
        self.assertEqual(new.encode(), self.original.replace(b'30303', b'29108'))
        self.assertIn('-Xmx768M', args)
        self.assertNotIn('PYTHONHOME', env)
        self.assertEqual(before, self.snapshot())

    def test_invalid_resources_or_allocation_refuse_without_writes(self):
        before = self.snapshot()
        for changes in ({'SERVER_MEMORY': 'invalid'}, {'SERVER_PORT': '1'}, {'SERVER_MEMORY': '0'}, {'VOLTRA_ALLOCATED_PORTS': 'no'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                adapter.plan(self.root, {**self.env, **changes})
        self.assertEqual(before, self.snapshot())

    def test_native_port_ambiguity_refuses_without_writes(self):
        for text in (b'SERVER_PORT=30303\nSERVER_PORT=30304\n', b'server_port=30303\n', b'SERVER_PORT=30303;exit\n', b'SERVER_PORT =30303\n', b'SERVER_PORT= 30303\n', b'AUTOSAVE_TIME=300\n'):
            self.cfg.write_bytes(text)
            before = self.snapshot()
            with self.assertRaises(ValueError):
                adapter.plan(self.root, self.env)
            self.assertEqual(before, self.snapshot())

    def test_java_missing_refuses_before_config_or_backup(self):
        self.java.unlink()
        before = self.snapshot()
        with self.assertRaises(ValueError):
            adapter.plan(self.root, self.env)
        self.assertEqual(before, self.snapshot())

    def test_confined_config_symlink_refused(self):
        target = self.root / 'operator.cfg'
        target.write_bytes(self.original)
        self.cfg.unlink()
        self.cfg.symlink_to(target)
        before = self.snapshot()
        with self.assertRaises(ValueError):
            adapter.plan(self.root, self.env)
        self.assertEqual(before, self.snapshot())

    def test_deployed_canonical_uses_shared_supervisor_and_byte_exact_backup(self):
        for name in ('tachyon-preflight', 'native-config', 'native-console', 'steam-template'):
            (self.root / '.voltra' / (name.replace('-', '_') + '.py')).write_bytes((BASE / (name + '.py')).read_bytes())
        self.java.write_text('#!' + sys.executable + '\nimport sys\nprint("[Server] SERVER STARTED.",flush=True)\nfor line in sys.stdin:\n print("TACHYON_FIXTURE_COMMAND "+line.strip(),flush=True)\n if line.strip()=="/exit":break\n')
        p = subprocess.Popen([sys.executable, '-B', str(self.root / '.voltra/tachyon_preflight.py')], cwd=self.root, env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        data = b''
        def until(marker):
            nonlocal data
            deadline = time.monotonic() + 6
            while marker not in data and time.monotonic() < deadline:
                if select.select([p.stdout], [], [], .05)[0]:
                    part = os.read(p.stdout.fileno(), 65536)
                    if not part:break
                    data += part
            self.assertIn(marker, data)
        try:
            until(b'[Server] SERVER STARTED.')
            p.stdin.write(b'/online\n');p.stdin.flush()
            until(b'TACHYON_FIXTURE_COMMAND /online')
            p.send_signal(signal.SIGTERM)
            p.wait(timeout=6)
            data += p.stdout.read()
            self.assertIn(b'TACHYON_FIXTURE_COMMAND /exit', data)
            self.assertEqual(p.returncode, 0)
            self.assertEqual(self.cfg.read_bytes(), self.original.replace(b'30303', b'29108'))
            backups = list((self.root / '.voltra/small-games-family/backups').glob('tachyon-*.cfg'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), self.original)
            self.assertEqual(self.cfg.stat().st_mode & 0o777, 0o640)
        finally:
            if p.poll() is None:p.kill();p.wait(timeout=3)
            p.stdin.close();p.stdout.close()


if __name__ == '__main__':
    unittest.main()
