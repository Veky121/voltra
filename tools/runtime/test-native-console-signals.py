"""Real tiny native-process fixtures for opt-in signals; no game acceptance."""
import importlib.util
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
for name,file in [('steam_template','steam-template.py'),('native_console','native-console.py')]:
    spec=importlib.util.spec_from_file_location(name,BASE/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
console=sys.modules['native_console']


class NativeSignalTests(unittest.TestCase):
    def exercise(self,mode):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory)
            (root/'game.py').write_text("import os,signal,sys\nfrom pathlib import Path\nmode=sys.argv[1]\ndef stop(s,f):\n Path('signal').write_text(str(s))\n print('NATIVE_STOP',flush=True)\n sys.exit(7 if mode=='escalate'else 0)\nsignal.signal(signal.SIGINT,signal.SIG_IGN if mode=='escalate'else stop)\nsignal.signal(signal.SIGTERM,stop)\nprint('READY',flush=True)\nfor line in sys.stdin:\n command=line.strip()\n if command=='quit':\n  Path('default').write_text('quit');sys.exit(0)\n print('ECHO:'+command,flush=True)\n")
            (root/'wrapper.py').write_text("import importlib.util,os,signal,sys\nfrom pathlib import Path\nbase=Path(sys.argv[1])\nfor name,file in [('steam_template','steam-template.py'),('native_console','native-console.py')]:\n s=importlib.util.spec_from_file_location(name,base/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m)\nmode=sys.argv[2]\noptions={}if mode=='default'else {'stop_signal':signal.SIGTERM if mode=='term'else signal.SIGINT,'stop_signal_timeout':.2}\nsys.exit(sys.modules['native_console'].run(Path.cwd(),[sys.executable,'-u','game.py',mode],dict(os.environ),'quit',**options))\n")
            child=subprocess.Popen([sys.executable,'-B','-u','wrapper.py',str(BASE),mode],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            lines=queue.Queue()
            def reader():
                for line in child.stdout:lines.put(line)
            thread=threading.Thread(target=reader,daemon=True);thread.start()
            try:
                self.assertEqual(lines.get(timeout=5),b'READY\n')
                child.stdin.write(b'original stdin\n');child.stdin.flush()
                self.assertEqual(lines.get(timeout=5),b'ECHO:original stdin\n')
                child.send_signal(signal.SIGTERM)
                self.assertEqual(child.wait(timeout=5),7 if mode=='escalate'else 0)
                if mode=='default':
                    self.assertEqual((root/'default').read_text(),'quit');self.assertFalse((root/'signal').exists())
                else:
                    self.assertFalse((root/'default').exists())
                    self.assertEqual((root/'signal').read_text(),str(int(signal.SIGTERM if mode in ('term','escalate')else signal.SIGINT)))
            finally:
                if child.poll()is None:child.kill();child.wait(timeout=5)
                child.stdin.close();thread.join(timeout=2);child.stdout.close()

    def test_native_sigint_and_stdin(self):self.exercise('int')
    def test_native_sigterm_and_stdin(self):self.exercise('term')
    def test_signal_timeout_escalates_and_keeps_actual_exit_code(self):self.exercise('escalate')
    def test_absent_signal_keeps_default_stdin_stop(self):self.exercise('default')
    def test_invalid_signal_or_conflicting_sequence_fails_before_spawn(self):
        for options in [{'stop_signal':value}for value in [True,2.0,'SIGINT',signal.SIGKILL,0,-1]]+[
                {'stop_signal':signal.SIGINT,'stop_sequence':(('quit',None),)},
                {'stop_signal':signal.SIGINT,'stop_signal_timeout':0}]:
            with self.subTest(options=options),patch.object(console.subprocess,'Popen',side_effect=AssertionError('no spawn')),self.assertRaises(ValueError):
                console.run(Path.cwd(),['unused'],{},'quit',**options)


if __name__=='__main__':unittest.main()
