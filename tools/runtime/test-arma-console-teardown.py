"""Linux CPython process regressions; no game, network or server lease."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path('internal/panel/game_library/scripts/arma-native.py').resolve()


@unittest.skipUnless(sys.platform == 'linux', 'Linux process-group/descriptor contract')
class ArmaConsoleTeardownTests(unittest.TestCase):
    def exercise(self, mode, payload=None, close_input=False, clients=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'engine.py').write_text("""import os,signal,sys,time
from pathlib import Path
mode=sys.argv[1]
def stop(sig,frame):
 print('NATIVE_STOP',flush=True)
 sys.exit(7)
signal.signal(signal.SIGINT,stop)
print('READY',flush=True)
if mode=='natural':
 time.sleep(.3)
 sys.exit(9)
if mode=='headless':
 Path('headless.pid').write_text(str(os.getpid()))
 while True: time.sleep(.1)
if mode=='eof':
 line=sys.stdin.buffer.read(len(b'last partial command'))
 print('INPUT:'+repr(line),flush=True)
 sys.exit(13)
for line in sys.stdin.buffer:
 print('INPUT:'+repr(line),flush=True)
 if line==b'quit\\n': sys.exit(11)
sys.exit(13)
""")
            (root / 'wrapper.py').write_text("""import importlib.util,os,sys,threading
from pathlib import Path
s=importlib.util.spec_from_file_location('arma',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
main=[sys.executable,'-u','engine.py',sys.argv[2]]
clients=[[sys.executable,'-u','engine.py','headless']] if sys.argv[3]=='yes' else []
code=m.supervise(Path.cwd(),main,clients,dict(os.environ),True)
assert not any(t.name=='arma-console-input' for t in threading.enumerate()), 'stdin thread survived teardown'
print('SUPERVISOR_EXIT:'+str(code),flush=True)
sys.exit(code)
""")
            process = subprocess.Popen([sys.executable, '-B', '-u', 'wrapper.py', str(SOURCE), mode,
                                        'yes' if clients else 'no'], cwd=root,
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                self.assertEqual(process.stdout.readline(), b'READY\n')
                if payload is not None:
                    process.stdin.write(payload)
                    process.stdin.flush()
                if close_input:
                    process.stdin.close()
                if mode == 'signal':
                    import time
                    time.sleep(.2)  # Ensure the console is blocked on retained stdin.
                    process.send_signal(signal.SIGTERM)
                # Intentionally do NOT communicate(): it closes stdin and hides
                # the retained-Wings-pipe shutdown failure under test.
                code = process.wait(timeout=6)
                output, error = process.stdout.read(), process.stderr.read()
                expected = {'natural': 9, 'signal': 7, 'lines': 11, 'eof': 13}[mode]
                self.assertEqual(code, expected, (output, error))
                self.assertIn(('SUPERVISOR_EXIT:' + str(expected)).encode(), output)
                self.assertNotIn(b'_enter_buffered_busy', error)
                if payload:
                    for line in payload.splitlines(keepends=True):
                        self.assertIn(('INPUT:' + repr(line)).encode(), output)
                if clients:
                    pidfile = root / 'headless.pid'
                    self.assertTrue(pidfile.exists())
                    with self.assertRaises(ProcessLookupError):
                        os.kill(int(pidfile.read_text()), 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=3)
                if not process.stdin.closed:
                    process.stdin.close()
                process.stdout.close()
                process.stderr.close()

    def test_child_exit_with_parent_stdin_still_open(self):
        self.exercise('natural')

    def test_normal_signal_stop_with_parent_stdin_still_open_and_headless_client(self):
        self.exercise('signal', clients=True)

    def test_lines_forwarded_and_child_nonzero_exit_preserved(self):
        self.exercise('lines', b'first command\r\nsecond command\nquit\n')

    def test_eof_forwards_unterminated_line(self):
        self.exercise('eof', b'last partial command', close_input=True)


if __name__ == '__main__':
    unittest.main()
