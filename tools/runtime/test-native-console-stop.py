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
    def test_paced_pty_sequence_preserves_characters_and_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            (root/'game.py').write_text("import json,os,pathlib,termios,time\na=termios.tcgetattr(0);a[3]&=~(termios.ICANON|termios.ECHO);termios.tcsetattr(0,termios.TCSANOW,a)\npathlib.Path('engine.pid').write_text(str(os.getpid()))\nprint('READY',flush=True)\npending=b'';events=[]\nwhile True:\n b=os.read(0,1);events.append([time.monotonic(),b.hex()]);pathlib.Path('partial.json').write_text(json.dumps(events))\n if b==bytes([13]):\n  if pending==b'save':print('SAVE_DONE',flush=True)\n  elif pending==b'quit':pathlib.Path('events.json').write_text(json.dumps(events));break\n  pending=b''\n else:pending+=b\n")
            (root/'wrapper.py').write_text("import importlib.util,os,pathlib,sys\nbase=pathlib.Path(sys.argv[1])\nfor name,file in [('steam_template','steam-template.py'),('native_console','native-console.py')]:\n spec=importlib.util.spec_from_file_location(name,base/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)\nraise SystemExit(sys.modules['native_console'].run(pathlib.Path.cwd(),[sys.executable,'-u','game.py'],dict(os.environ),'quit',terminal_input=True,terminal_query_reply=True,terminal_enter_carriage_return=True,stop_sequence=(('save',b'SAVE_DONE'),('quit',None)),stop_sequence_input_delay=.03))\n")
            process=subprocess.Popen([sys.executable,'-B','-u',str(root/'wrapper.py'),str(BASE)],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                self.assertEqual(process.stdout.readline(),b'READY\n')
                try:output,error=process.communicate(bytes([113,117,105,116,10]),timeout=5)
                except subprocess.TimeoutExpired as error:
                    partial=(root/'partial.json').read_text() if (root/'partial.json').exists() else 'no bytes'
                    self.fail(f'Paced child timed out: {partial}; output={error.output!r}; stderr={error.stderr!r}')
                self.assertEqual(process.returncode,0,error)
                self.assertIn(b'SAVE_DONE',output)
                import json
                events=json.loads((root/'events.json').read_text())
                self.assertEqual(bytes.fromhex(''.join(row[1] for row in events)),bytes([115,97,118,101,13,113,117,105,116,13]))
                for start in (0,5):
                    for index in range(start+1,start+5):self.assertGreater(events[index][0]-events[index-1][0],.015)
            finally:
                if process.poll() is None:process.kill();process.communicate()
                pidfile=root/'engine.pid'
                if pidfile.exists():
                    pid=int(pidfile.read_text())
                    try:
                        if (Path('/proc')/str(pid)/'cwd').resolve()==root:os.killpg(pid,signal.SIGKILL)
                    except (OSError,ProcessLookupError):pass
    def test_pacing_requires_bounded_delay_and_pty(self):
        for value in (-1,1.1,True,float('nan')):
            with self.subTest(delay=value),self.assertRaises(ValueError):console.run(Path.cwd(),[],{},'quit',terminal_input=True,stop_sequence_input_delay=value)
        with self.assertRaises(ValueError):console.run(Path.cwd(),[],{},'quit',stop_sequence_input_delay=.15)
    def test_typed_steps_reject_injection_and_missing_ack(self):
        for sequence in ([('save',b'OK')],(('save\nquit',b'OK'),), (('save',None),('quit',None)),(('save','OK'),), (('save',b''),), (('save',b'x'*513),)):
            with self.subTest(sequence=sequence),self.assertRaises(ValueError):console.validated_stop_sequence(sequence)


if __name__=='__main__':unittest.main()


