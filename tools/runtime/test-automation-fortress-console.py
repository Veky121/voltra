import importlib.util
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'internal/panel/game_library/scripts/automation-fortress-console.py'
spec = importlib.util.spec_from_file_location('fortress_console', SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Server:
    def __init__(self, callback):
        self.socket = socket.socket()
        self.socket.bind(('127.0.0.1', 0))
        self.port = self.socket.getsockname()[1]
        self.socket.listen()
        self.errors = []
        def run():
            try:
                with self.socket, self.socket.accept()[0] as connection:
                    connection.settimeout(2)
                    callback(connection)
            except Exception as error:
                self.errors.append(error)
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
    def join(self):
        self.thread.join(4)
        if self.errors:
            raise self.errors[0]


class Tests(unittest.TestCase):
    def test_fragmented_auth_welcome_utf8_multipart(self):
        def serve(c):
            self.assertEqual(m.read(c), (4101, 3, 'private'))
            for byte in m.packet(4101, 0, 'welcome') + m.packet(4101, 2, ''):
                c.sendall(bytes([byte]))
            self.assertEqual(m.read(c), (4102, 2, 'help'))
            c.sendall(m.packet(4101, 0, 'late welcome') + m.packet(4102, 0, 'hé') + m.packet(4102, 0, 'llo'))
        server = Server(serve)
        self.assertEqual(m.command(server.port, 'private', 'help'), 'héllo')
        server.join()

    def test_reject_auth_sends_no_command(self):
        def serve(c):
            m.read(c)
            c.sendall(m.packet(-1, 2, ''))
            self.assertEqual(c.recv(1), b'')
        server = Server(serve)
        with self.assertRaises(m.BeforeSend):
            m.command(server.port, 'private', 'quit')
        server.join()

    def test_lost_ack_is_after_send(self):
        seen = []
        def serve(c):
            m.read(c)
            c.sendall(m.packet(4101, 2, ''))
            seen.append(m.read(c))
        server = Server(serve)
        with self.assertRaises(m.AfterSend):
            m.command(server.port, 'private', 'quit')
        server.join()
        self.assertEqual(seen, [(4102, 2, 'quit')])

    def test_invalid_frame_and_utf8(self):
        for frame in (b'\xff\xff\xff\xff', m.packet(4101, 0, 'x')[:-2] + b'xx', m.packet(4101, 0, 'x').replace(b'x', b'\xff')):
            a, b = socket.socketpair()
            with a, b:
                a.settimeout(1)
                b.sendall(frame)
                with self.assertRaises((ValueError, UnicodeError)):
                    m.read(a)

    def test_command_validation(self):
        for value in ('', 'quit\nhelp', 'x' * 2049, '\x03'):
            with self.assertRaises(ValueError):
                m.command(1, 'secret', value)

    def test_native_environment_drops_python_and_password(self):
        env = dict(PYTHONHOME='bad', LD_LIBRARY_PATH='bad', RCON_PASSWORD='secret', VOLTRA_FORTRESS_RCON_PASSWORD='secret', HOME='/owned')
        self.assertEqual(m.native_environment(env), {'HOME': '/owned'})

    def test_actual_child_nonzero_is_unchanged(self):
        self.assertEqual(m.bridge([sys.executable, '-c', 'import sys;sys.exit(42)'], 1, 'secret', .1, .1), 42)

    def test_entrypoint_reraises_actual_child_signal(self):
        env = dict(os.environ, VOLTRA_FORTRESS_RCON_PASSWORD='private')
        result = subprocess.run([sys.executable, str(SOURCE), '1', sys.executable, '-c', 'import os,signal;os.kill(os.getpid(),signal.SIGTERM)'], env=env, stdin=subprocess.DEVNULL, timeout=5)
        self.assertEqual(result.returncode, -signal.SIGTERM)

    def test_stop_before_ready_cleans_owned_child_and_does_not_fake_zero(self):
        script = 'import importlib.util,sys;s=importlib.util.spec_from_file_location("bridge",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print("RESULT",m.bridge([sys.executable,"-c","import time;time.sleep(30)"],1,"private",.1,.1))'
        result = subprocess.run([sys.executable, '-c', script, str(SOURCE)], input=b'quit\n', capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertIn(b'RESULT -15', result.stdout)

    def test_supervise_secret_not_argv_and_exact_native_argv(self):
        native = mock.Mock()
        native.run.return_value = 42
        argv = ['/owned/native', '-batchmode', '-nographics']
        self.assertEqual(m.supervise(native, Path('/owned'), argv, {'HOME': '/owned'}, ['private'], 28001), 42)
        args, kwargs = native.run.call_args
        self.assertEqual(args[1][-3:], argv)
        self.assertNotIn('private', repr(args[1]))
        self.assertEqual(args[2]['VOLTRA_FORTRESS_RCON_PASSWORD'], 'private')
        self.assertEqual(args[3], 'quit')
        self.assertEqual(kwargs, {'terminal_input': True})

    def test_real_outer_pty_stop_authenticates_quit_and_retains_child_42(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / 'native.py'
            child.write_text('''import importlib.util,os,socket,sys
s=importlib.util.spec_from_file_location('bridge',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
assert 'PYTHONHOME' not in os.environ and 'LD_LIBRARY_PATH' not in os.environ
assert 'RCON_PASSWORD' not in os.environ and 'VOLTRA_FORTRESS_RCON_PASSWORD' not in os.environ
sock=socket.socket();sock.bind(('127.0.0.1',int(sys.argv[2])));sock.listen()
print('ACTUAL_NATIVE_READY',flush=True)
with sock.accept()[0] as c:
 c.settimeout(2)
 assert m.read(c)==(4101,3,'private')
 c.sendall(m.packet(4101,2,''))
 assert m.read(c)==(4102,2,'quit')
 c.sendall(m.packet(4102,0,'ACTUAL_QUIT_ACK'))
print('ACTUAL_NATIVE_SAVED',flush=True)
sys.exit(42)
''')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            driver = root / 'driver.py'
            driver.write_text('''import importlib.util,os,pathlib,signal,sys,threading,time
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
load('steam_template',pathlib.Path(sys.argv[1]).with_name('steam-template.py'))
bridge=load('bridge',sys.argv[1]);native=load('native',pathlib.Path(sys.argv[1]).with_name('native-console.py'))
threading.Thread(target=lambda:(time.sleep(.5),os.kill(os.getpid(),signal.SIGTERM)),daemon=True).start()
code=bridge.supervise(native,pathlib.Path.cwd(),[sys.executable,sys.argv[2],sys.argv[1],sys.argv[3]],dict(os.environ),['private'],int(sys.argv[3]))
print('ACTUAL_SUPERVISOR_RESULT',code,flush=True)
sys.exit(code)
''')
            result = subprocess.run([sys.executable, str(driver), str(SOURCE), str(child), str(port)], cwd=root, stdin=subprocess.DEVNULL, capture_output=True, timeout=8)
            self.assertEqual(result.returncode, 42, result.stdout + result.stderr)
            self.assertIn(b'ACTUAL_NATIVE_SAVED', result.stdout)
            self.assertIn(b'ACTUAL_QUIT_ACK', result.stdout)
            self.assertNotIn(b'private', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
