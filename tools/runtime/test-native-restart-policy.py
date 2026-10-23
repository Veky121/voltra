"""Real subprocess policy fixtures, not game acceptance."""
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'internal/panel/game_library/scripts'
ENGINE="""import os,sys
from pathlib import Path
root=Path.cwd();counter=root/'counter';n=int(counter.read_text())+1 if counter.exists() else 1;counter.write_text(str(n))
mode=sys.argv[1]
if mode in ('always_fail','crash_once') and (mode=='always_fail' or n==1):
 print('fixture-private-marker crash',flush=True);sys.exit(7)
if mode=='success':print('SUCCESS',flush=True);sys.exit(0)
print('ENGINE_READY',flush=True)
for line in sys.stdin:
 if mode=='ordered_stop' and line.strip()=='save':print('SAVE_ACK',flush=True)
 if line.strip()=='stop':print('NATIVE_STOP',flush=True);sys.exit(9 if mode=='stop_nonzero' else 0)
"""
DRIVER="""import base64,importlib.util,json,sys
from pathlib import Path
root=Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('restart_policy',root/'helpers/native-restart-policy.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def decode(value):
 if set(value)=={'__voltra_native_bytes__'}:return base64.b64decode(value['__voltra_native_bytes__'],validate=True)
 return value
configuration=json.loads((root/'fixture.json').read_text(),object_hook=decode)
if 'stop_sequence' in configuration:configuration['stop_sequence']=tuple(tuple(step) for step in configuration['stop_sequence'])
sys.exit(module.run_restarting(configuration,float(sys.argv[2]),float(sys.argv[3])))
"""
class PolicyFixture:
    def __init__(self,mode,delay=.05,**extra):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);helpers=self.root/'helpers';helpers.mkdir()
        for source,target in [('native-console.py','native_console.py'),('native-restart-policy.py','native-restart-policy.py'),('steam-template.py','steam_template.py')]:shutil.copyfile(BASE/source,helpers/target)
        (self.root/'engine.py').write_text(ENGINE);(self.root/'driver.py').write_text(DRIVER)
        config=dict(root=str(self.root),argv=[sys.executable,str(self.root/'engine.py'),mode],environment=dict(os.environ),stop_command='stop',credentials=['fixture-private-marker'])
        # Fixture-only JSON uses base64-tagged markers; production config goes
        # directly through its anonymous pipe and never through this file.
        config.update(extra)
        import base64
        (self.root/'fixture.json').write_text(json.dumps(config,default=lambda value:{'__voltra_native_bytes__':base64.b64encode(value).decode()}));self.output=b''
        self.child=subprocess.Popen([sys.executable,str(self.root/'driver.py'),str(self.root),str(delay),str(max(delay,.1))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,bufsize=0)
    def read(self,timeout=.05):
        if select.select([self.child.stdout],[],[],timeout)[0]:
            block=os.read(self.child.stdout.fileno(),65536);self.output+=block
            if len(self.output)>1024**2:raise AssertionError('Fixture output exceeded bound')
            return bool(block)
        return True
    def until(self,marker):
        deadline=time.monotonic()+8
        while marker not in self.output:
            if time.monotonic()>deadline:raise AssertionError('Missing fixture marker '+repr(marker)+' '+repr(self.output))
            if not self.read() and self.child.poll() is not None:raise AssertionError('Fixture exited early '+repr(self.output))
    def finish(self):
        code=self.child.wait(timeout=8)
        while self.read(.01):
            if not select.select([self.child.stdout],[],[],.01)[0]:break
        return code
    def close(self):
        if self.child.poll() is None:
            self.child.send_signal(signal.SIGTERM)
            try:self.child.wait(timeout=3)
            except subprocess.TimeoutExpired:self.child.kill();self.child.wait()
        self.child.stdin.close();self.child.stdout.close();self.temp.cleanup()

class RestartTests(unittest.TestCase):
    def fixture(self,*args,**kwargs):
        f=PolicyFixture(*args,**kwargs);self.addCleanup(f.close);return f
    def test_failure_restarts_and_redaction_stays_in_existing_supervisor(self):
        f=self.fixture('crash_once');f.until(b'ENGINE_READY');f.child.stdin.write(b'stop\n');self.assertEqual(f.finish(),0)
        self.assertEqual((f.root/'counter').read_text(),'2');self.assertIn(b'restart attempt 1',f.output);self.assertNotIn(b'fixture-private-marker',f.output);self.assertIn(b'NATIVE_STOP',f.output)
    def test_partial_native_stop_suppresses_restart_even_for_nonzero_exit(self):
        f=self.fixture('stop_nonzero');f.until(b'ENGINE_READY');f.child.stdin.write(b'st');time.sleep(.02);f.child.stdin.write(b'op\r\n');self.assertEqual(f.finish(),9);self.assertEqual((f.root/'counter').read_text(),'1');self.assertNotIn(b'restart attempt',f.output)
    def test_signal_stop_suppresses_restart_even_for_nonzero_exit(self):
        f=self.fixture('stop_nonzero');f.until(b'ENGINE_READY');f.child.send_signal(signal.SIGTERM);self.assertEqual(f.finish(),9);self.assertEqual((f.root/'counter').read_text(),'1');self.assertIn(b'NATIVE_STOP',f.output)
    def test_clean_exit_does_not_restart(self):
        f=self.fixture('success');self.assertEqual(f.finish(),0);self.assertEqual((f.root/'counter').read_text(),'1');self.assertNotIn(b'restart attempt',f.output)
    def test_stop_during_backoff_prevents_another_child(self):
        f=self.fixture('always_fail',2);f.until(b'restart attempt 1');f.child.send_signal(signal.SIGINT);self.assertEqual(f.finish(),7);self.assertEqual((f.root/'counter').read_text(),'1')
    def test_private_binary_markers_and_ordered_native_stop_compose(self):
        f=self.fixture('ordered_stop',stop_sequence=[('save',b'SAVE_ACK'),('stop',None)],ready_marker=b'ENGINE_READY',terminal_input=True,terminal_query_reply=True)
        f.until(b'ENGINE_READY');f.child.send_signal(signal.SIGTERM);self.assertEqual(f.finish(),0);self.assertEqual((f.root/'counter').read_text(),'1');self.assertLess(f.output.index(b'SAVE_ACK'),f.output.index(b'NATIVE_STOP'))
if __name__=='__main__':unittest.main()
