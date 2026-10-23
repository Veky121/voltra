"""PTY byte protocol fixtures, independent from any game's acceptance."""
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import unittest

base=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
for name,file in [('steam_template','steam-template.py'),('native_console','native-console.py')]:
    spec=importlib.util.spec_from_file_location(name,base/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
console=sys.modules['native_console']

class ConsoleInputTests(unittest.TestCase):
    def test_pty_readiness_line_flushes_without_later_output_and_redacts_split_secret(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            for name,file in [('steam_template.py','steam-template.py'),('native_console.py','native-console.py')]:
                (root/name).write_bytes((base/file).read_bytes())
            secret='private-long-credential-for-stream-test'
            (root/'engine.py').write_text("import os,time,sys\nos.write(1,b'private-long-credential-');time.sleep(.05)\nos.write(1,b'for-stream-test\\nREADY\\n')\nassert sys.stdin.readline().strip()=='quit'\nprint('STOP_OK',flush=True)\n")
            (root/'launch.py').write_text("from native_console import run\nfrom pathlib import Path\nimport os,sys\nraise SystemExit(run(Path.cwd(),[sys.executable,'engine.py'],dict(os.environ),'quit',credentials=["+repr(secret)+"],terminal_input=True,terminal_query_reply=True))\n")
            child=subprocess.Popen([sys.executable,'launch.py'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            watchdog=threading.Timer(5,lambda:child.kill() if child.poll() is None else None);watchdog.start()
            try:
                line=child.stdout.readline();self.assertEqual(line,b'[redacted]\n')
                self.assertEqual(child.stdout.readline(),b'READY\n')
                child.send_signal(signal.SIGTERM)
                output,error=child.communicate(timeout=3)
                self.assertEqual(child.returncode,0,error);self.assertIn(b'STOP_OK',output);self.assertNotIn(secret.encode(),line+output)
            finally:
                watchdog.cancel()
                if child.poll() is None:child.kill();child.wait()

    def test_fragmented_crlf_has_one_enter(self):
        pending=False;result=b''
        for data in [b'a\r',b'\nb\n',b'c\r',b'd\n\n']:
            converted,pending=console.carriage_return_input(data,pending);result+=converted
        self.assertEqual(result,b'a\rb\rc\rd\r\r')

    def test_real_pty_default_lf_and_opt_in_cr_with_dsr_and_stop(self):
        for cr in [False,True]:
            with self.subTest(carriage_return=cr), tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary)
                for name,file in [('steam_template.py','steam-template.py'),('native_console.py','native-console.py')]: (root/name).write_bytes((base/file).read_bytes())
                ending='\\r' if cr else '\\n'
                (root/'engine.py').write_text("import os,termios,select\na=termios.tcgetattr(0);assert bool(a[0]&termios.ICRNL)=="+str(not cr)+"\na[3]&=~(termios.ICANON|termios.ECHO);termios.tcsetattr(0,termios.TCSANOW,a)\nos.write(1,b'\\x1b[6n')\nassert select.select([0],[],[],2)[0]\nassert os.read(0,6)==b'\\x1b[1;1R'\nprint('READY\\n.',end='',flush=True)\nassert os.read(0,7)==b'native"+ending+"'\nprint('COMMAND_OK\\n.',end='',flush=True)\nassert os.read(0,5)==b'quit"+ending+"'\nprint('STOP_OK',flush=True)\n")
                (root/'launch.py').write_text("from native_console import run\nfrom pathlib import Path\nimport os,sys\nraise SystemExit(run(Path.cwd(),[sys.executable,'engine.py'],dict(os.environ),'quit',terminal_input=True,terminal_query_reply=True,terminal_enter_carriage_return="+str(cr)+"))\n")
                child=subprocess.Popen([sys.executable,'launch.py'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                watchdog=threading.Timer(8,lambda:child.kill() if child.poll() is None else None);watchdog.start()
                try:
                    self.assertIn(b'READY',child.stdout.readline())
                    child.stdin.write(b'native\n');child.stdin.flush()
                    self.assertIn(b'COMMAND_OK',child.stdout.readline())
                    child.send_signal(signal.SIGTERM)
                    output,error=child.communicate(timeout=5)
                    self.assertEqual(child.returncode,0,error);self.assertIn(b'STOP_OK',output)
                finally:
                    watchdog.cancel()
                    if child.poll() is None:child.kill();child.wait()

if __name__=='__main__':unittest.main()
