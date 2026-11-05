"""Actual deployed launcher/configuration/supervisor path with a Python stand-in.

No publisher acquisition or actual Battalion process. Run on Linux to exercise
the shared PTY and signal shutdown rather than mocking the supervisor.
"""
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


def await_output(process, marker, timeout=6):
    data = b''
    deadline = time.monotonic() + timeout
    while marker not in data and time.monotonic() < deadline:
        if not select.select([process.stdout], [], [], .05)[0]:
            continue
        block = os.read(process.stdout.fileno(), 65536)
        if not block:
            break
        data += block
    if marker not in data:
        raise AssertionError('Fixture readiness missing: ' + repr(data))
    return data


@unittest.skipUnless(os.name == 'posix', 'Shared native PTY/signal fixture requires Linux')
class DeployedBattalion(unittest.TestCase):
    def test_deployed_entrypoint_uses_actual_shared_supervisor_redaction_and_signal_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            managed = root / '.voltra'
            managed.mkdir()
            helpers = ('steam-template', 'native-console', 'native-config', 'source-install',
                       'source-next-install', 'tactical-install', 'tactical-runtime',
                       'tactical-next-install', 'tactical-next-runtime', 'battalion-preflight')
            for name in helpers:
                (managed / (name.replace('-', '_') + '.py')).write_bytes((BASE / (name + '.py')).read_bytes())
            binary = root / 'Battalion/Binaries/Linux/BattalionServer-Linux-Shipping'
            binary.parent.mkdir(parents=True)
            binary.write_text('#!' + sys.executable + '\n' +
                'import signal,sys,time\n'
                'def stop(*args):\n print("BATTALION_SIGNAL_STOP_ACK",flush=True);raise SystemExit(0)\n'
                'signal.signal(signal.SIGINT,stop)\n'
                'password=next(x.split("=",1)[1] for x in sys.argv if x.startswith("-AdminPassword="))\n'
                'print(" OnCreateSessionComplete ",flush=True)\n'
                'print("BATTALION_FIXTURE_READY "+password,flush=True)\n'
                'deadline=time.time()+8\n'
                'while time.time()<deadline:time.sleep(.01)\n'
                'raise SystemExit(88)\n')
            binary.chmod(0o755)
            native = root / 'Battalion/Saved/Config/LinuxServer/Game.ini'
            native.parent.mkdir(parents=True)
            original = b';operator\r\n[Unknown]\r\nNative=retain\r\n'
            native.write_bytes(original)
            secret = 'battalion-fixture-private'
            # Existing original admin control has a 20-byte limit.
            secret = secret[:20]
            env = dict(os.environ, VOLTRA_TACTICAL_NEXT='battalion', SRCDS_APPID='805140',
                       AUTO_UPDATE='0', SERVER_PORT='28010', QUERY_PORT='28020',
                       VOLTRA_ALLOCATED_PORTS='28010,28020', ADMIN_PW=secret, SERVER_NAME='Fixture Server')
            process = subprocess.Popen([sys.executable, '-B', str(managed / 'battalion_preflight.py')],
                cwd=root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            before = b''
            try:
                before = await_output(process, b'BATTALION_FIXTURE_READY')
                process.terminate()
                after, error = process.communicate(timeout=6)
            except BaseException:
                process.kill()
                process.communicate()
                raise
            output = before + after
            self.assertEqual(process.returncode, 0, error.decode())
            self.assertIn(b'BATTALION_SIGNAL_STOP_ACK', output)
            self.assertNotIn(secret.encode(), output)
            self.assertIn(b'[redacted]', output)
            self.assertEqual(native.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
