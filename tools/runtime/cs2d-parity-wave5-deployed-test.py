"""Actual CS2D entrypoint/configuration/mailbox supervisor with a stand-in.

The Python child models mailbox consumption; this does not execute publisher
Lua or prove CS2D protocol/gameplay behavior.
"""
import os
from pathlib import Path
import select
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
        raise AssertionError('Fixture output missing: ' + repr(data))
    return data


@unittest.skipUnless(os.name == 'posix', 'Bounded deployed child fixture runs on Linux')
class DeployedCS2D(unittest.TestCase):
    def test_actual_configuration_console_mailbox_redaction_and_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            managed = root / '.voltra'
            managed.mkdir()
            for source, installed in (
                ('cs2d-preflight.py', 'cs2d-preflight.py'),
                ('small-native-runtime.py', 'small-native-runtime.py'),
                ('native-config.py', 'native-config.py'),
                ('steam-template.py', 'steam_template.py'),
                ('cs2d-console.lua', 'cs2d-console.lua'),
            ):
                (managed / installed).write_bytes((BASE / source).read_bytes())
            game = root / 'cs2d'
            (game / 'maps').mkdir(parents=True)
            (game / 'maps/de_dust2.map').write_bytes(b'offline stand-in map')
            (game / 'sys').mkdir()
            (game / 'sys/server.cfg').write_bytes(b'// operator\nmp_roundtime 7\n')
            binary = game / 'cs2d_dedicated'
            binary.write_text('#!' + sys.executable + '\n' +
                'from pathlib import Path\nimport re,time,sys\n'
                'text=Path("sys/server.cfg").read_text()\n'
                'password=re.search(r\'sv_rcon "([^\\"]*)"\',text)[1]\n'
                'print("CS2D_FIXTURE_READY "+password,flush=True)\n'
                'mailbox=Path("../.voltra/cs2d/console-command")\n'
                'deadline=time.time()+8\n'
                'while time.time()<deadline:\n'
                ' if mailbox.exists():\n'
                '  data=mailbox.read_text();mailbox.unlink()\n'
                '  if "status" in data:print("CS2D_MAILBOX_STATUS_ACK",flush=True)\n'
                '  if "quit" in data:print("CS2D_MAILBOX_QUIT_ACK",flush=True);raise SystemExit(0)\n'
                ' time.sleep(.01)\n'
                'raise SystemExit(88)\n')
            binary.chmod(0o755)
            env = dict(os.environ, SERVER_PORT='28000', VOLTRA_ALLOCATED_PORTS='28000', AUTO_UPDATE='0',
                       RCON_PASSWORD='cs2d-fixture-private', SERVER_PASSWORD='cs2d-join-fixture')
            process = subprocess.Popen([sys.executable, '-B', str(managed / 'cs2d-preflight.py')],
                cwd=root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            output = b''
            try:
                output += await_output(process, b'CS2D_FIXTURE_READY')
                process.stdin.write(b'status\n')
                process.stdin.flush()
                output += await_output(process, b'CS2D_MAILBOX_STATUS_ACK')
                process.terminate()
                after, error = process.communicate(timeout=6)
                output += after
            except BaseException:
                process.kill()
                process.communicate()
                raise
            self.assertEqual(process.returncode, 0, error.decode())
            self.assertIn(b'CS2D_MAILBOX_QUIT_ACK', output)
            self.assertNotIn(b'cs2d-fixture-private', output)
            self.assertIn(b'[redacted]', output)
            self.assertIn('mp_roundtime 7', (game / 'sys/server.cfg').read_text())
            self.assertEqual((game / 'sys/lua/autorun/voltra-console.lua').read_bytes(), (BASE / 'cs2d-console.lua').read_bytes())


if __name__ == '__main__':
    unittest.main()
