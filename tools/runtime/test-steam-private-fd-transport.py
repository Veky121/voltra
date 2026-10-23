"""Linux process/FD tests, no Steam, network or account required."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('transport', Path(__file__).with_name('steam-private-fd-transport.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.exe = self.root / 'fake-steam'

    def tearDown(self):
        self.temp.cleanup()

    def engine(self, source):
        self.exe.write_text('#!/usr/local/bin/python3\n' + source)
        self.exe.chmod(0o700)

    def test_sealed_fd_exact_bytes_and_no_credential_env_or_argv(self):
        self.engine("""import os,sys,json,fcntl
p=sys.argv[-1];f=os.open(p,os.O_RDWR)
value=os.read(f,65536)
assert sys.argv[1]=='+runscript'
assert not any(k in os.environ for k in ('STEAM_PASS','STEAM_USER','STEAM_AUTH','SRCDS_BETAPASS'))
assert not any(v in ' '.join(sys.argv) for v in ('private marker', 'λé'))
try: os.write(f,b'bad')
except PermissionError: pass
else: raise AssertionError('fd not sealed')
open('publisher-auth','wb').write(value)
print(json.dumps({'script':value.hex(),'mode':os.stat('publisher-auth').st_mode&511,'home_mode':os.stat('.').st_mode&511}))
""")
        literal = '  +private marker "quote" \\ λé  '.encode()
        observations = []
        old = os.environ.get('STEAM_PASS')
        os.environ['STEAM_PASS'] = 'unrelated-environment-secret'
        try:
            result = transport.run_script(self.exe, literal, parent=self.root,
                public_probe_observer=lambda output, directory: observations.append(json.loads(output)))
        finally:
            if old is None: os.environ.pop('STEAM_PASS')
            else: os.environ['STEAM_PASS'] = old
        self.assertEqual(result['exit_code'], 0)
        self.assertEqual(observations, [{'script': literal.hex(), 'mode': 0o600, 'home_mode': 0o700}])
        self.assertEqual(list(self.root.iterdir()), [self.exe])
        self.assertNotIn('private marker', repr(result))

    def test_fragmented_output_is_never_returned(self):
        self.engine("import os,time\nfor c in b'private-secret-marker':\n os.write(1,bytes([c]));time.sleep(.001)\n")
        result = transport.run_script(self.exe, b'quit\n', parent=self.root)
        self.assertEqual(result, {'exit_code': 0, 'output_bytes': 21})

    def test_cancel_reaps_launcher_and_grandchild_before_cleanup(self):
        pidfile = self.root / 'pid'
        self.engine("import subprocess,time,pathlib\np=subprocess.Popen(['/bin/sleep','60'])\npathlib.Path(" + repr(str(pidfile)) + ").write_text(str(p.pid))\ntime.sleep(60)\n")
        start = time.monotonic()
        with self.assertRaisesRegex(transport.TransportError, 'canceled or timed out'):
            transport.run_script(self.exe, b'fixture', parent=self.root, timeout=3,
                cancel=lambda: pidfile.exists())
        self.assertLess(time.monotonic()-start, 2)
        pid = int(pidfile.read_text())
        status = Path('/proc') / str(pid) / 'stat'
        self.assertTrue(not status.exists() or status.read_text().split()[2] == 'Z')
        self.assertFalse(any(p.name.startswith('steam-private-') for p in self.root.iterdir()))

    def test_timeout_and_output_limit_have_safe_errors(self):
        for source, kwargs, message in [
            ('import time;time.sleep(60)', {'timeout': .1}, 'timed out'),
            ("import os;os.write(1,b'private-marker'*100)", {'output_limit': 10}, 'output limit')]:
            self.engine(source)
            with self.assertRaisesRegex(transport.TransportError, message) as error:
                transport.run_script(self.exe, b'fixture', parent=self.root, **kwargs)
            self.assertNotIn('private-marker', str(error.exception))

    def test_explicit_codec_gap_and_controls(self):
        for value in ['+quit', '-beta', '  spaces  ', 'literal\\path', 'λé', 'semi;quit']:
            self.assertEqual(transport.experimental_token(value), '"' + value + '"')
        for value in ['a"b', 'a\nb', 'a\rb', 'a\0b', 'a\tb', 'a\x7fb']:
            with self.assertRaises(transport.TransportError):
                transport.experimental_token(value)

    def test_shared_program_directory_is_rejected_before_launch(self):
        self.engine("raise AssertionError('must not start')")
        self.root.chmod(0o755)
        try:
            with self.assertRaisesRegex(transport.TransportError, 'owned private directory'):
                transport.run_script(self.exe, b'fixture', parent=self.root)
        finally:
            self.root.chmod(0o700)


unittest.main()
