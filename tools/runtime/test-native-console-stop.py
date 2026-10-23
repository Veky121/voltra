"""Real isolated native child fixtures for acknowledged ordered shutdown."""
import importlib.util
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
for name,file in [('steam_template','steam-template.py'),('native_console','native-console.py')]:
    spec=importlib.util.spec_from_file_location(name,BASE/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
console=sys.modules['native_console']


class StopTests(unittest.TestCase):
    def exercise(self,mode='ordered',duplicate=False):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);game=root/'game.py';wrapper=root/'wrapper.py'
            game.write_text("import pathlib,sys,time\nroot=pathlib.Path.cwd()\ndef event(text):\n with (root/'events').open('a')as f:f.write(text+'\\n')\nprint('READY',flush=True)\nfor line in sys.stdin:\n command=line.strip();event(command)\n if command=='save':\n  if sys.argv[1]=='missing':continue\n  time.sleep(.15);(root/'world.save').write_text('durable world');print('SAVE_',end='',flush=True);time.sleep(.05);print('DONE',flush=True)\n elif command=='flush':print('FLUSH_DONE',flush=True)\n elif command=='quit':\n  if sys.argv[1]!='default':assert(root/'world.save').read_text()=='durable world'\n  sys.exit(0)\n elif command=='finish':sys.exit(0)\n")
            wrapper.write_text("import importlib.util,sys,pathlib,os\nbase=pathlib.Path(sys.argv[1])\nfor name,file in [('steam_template','steam-template.py'),('native_console','native-console.py')]:\n spec=importlib.util.spec_from_file_location(name,base/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)\nsequence=()if sys.argv[2]=='default'else(('save',b'SAVE_DONE'),('flush',b'FLUSH_DONE'),('quit',None))\nsys.exit(sys.modules['native_console'].run(pathlib.Path.cwd(),[sys.executable,'-u','game.py',sys.argv[2]],dict(os.environ),'quit',stop_sequence=sequence,stop_sequence_timeout=.3 if sys.argv[2]=='missing'else 2,terminal_input=sys.argv[2]=='pty',terminal_query_reply=sys.argv[2]=='pty'))\n")
            process=subprocess.Popen([sys.executable,'-B','-u',str(wrapper),str(BASE),mode],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            lines=queue.Queue()
            def read():
                for line in process.stdout:lines.put(line)
            threading.Thread(target=read,daemon=True).start()
            try:
                self.assertEqual(lines.get(timeout=5),b'READY\n');process.send_signal(signal.SIGTERM)
                if duplicate:time.sleep(.02);process.send_signal(signal.SIGINT)
                if mode=='missing':
                    warning=lines.get(timeout=5);self.assertIn(b'acknowledgment missing',warning);self.assertIsNone(process.poll());self.assertEqual((root/'events').read_text().splitlines(),['save']);process.stdin.write(b'finish\n');process.stdin.flush()
                self.assertEqual(process.wait(timeout=5),0)
                events=(root/'events').read_text().splitlines()
                self.assertEqual(events,['quit']if mode=='default'else['save','finish']if mode=='missing'else['save','flush','quit'])
            finally:
                if process.poll()is None:process.kill();process.wait(timeout=5)
                process.stdin.close();process.stdout.close()
    def test_acknowledged_save_then_flush_then_quit(self):self.exercise()
    def test_pty_acknowledged_save_then_quit(self):self.exercise('pty')
    def test_duplicate_stop_does_not_send_duplicate_save(self):self.exercise(duplicate=True)
    def test_missing_ack_never_sends_final_quit(self):self.exercise('missing')
    def test_default_single_command_unchanged(self):self.exercise('default')
    def test_typed_steps_reject_injection_and_missing_ack(self):
        for sequence in ([('save',b'OK')],(('save\nquit',b'OK'),), (('save',None),('quit',None)),(('save','OK'),), (('save',b''),), (('save',b'x'*513),)):
            with self.subTest(sequence=sequence),self.assertRaises(ValueError):console.validated_stop_sequence(sequence)


if __name__=='__main__':unittest.main()


