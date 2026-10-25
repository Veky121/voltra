"""Offline composition tests. Tiny Python fixtures, never Wine/game execution."""
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
from unittest import mock

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
NAMES=['steam-template','native-config','native-console','source-install','source-next-install','tactical-install','tactical-runtime','tactical-next-install','native-log','tactical-next-runtime']
def load():
    for name in NAMES:
        key=name.replace('-','_');spec=importlib.util.spec_from_file_location(key,BASE/(name+'.py'));module=importlib.util.module_from_spec(spec);sys.modules[key]=module;spec.loader.exec_module(module)
load()
runtime=sys.modules['tactical_next_runtime']

class Output:
    def __init__(self):self.file=tempfile.TemporaryFile(buffering=0);self.buffer=self
    def fileno(self):return self.file.fileno()
    def value(self):return os.pread(self.fileno(),os.fstat(self.fileno()).st_size,0)
    def close(self):self.file.close()

class GroundRelayTests(unittest.TestCase):
    def exercise(self,writer,previous=None,secret='fixture-secret',code=23):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);folder=root/'GroundBranch/Saved/Logs';folder.mkdir(parents=True);log=folder/'GroundBranch.log'
            if previous is not None:log.write_bytes(previous)
            output=Output()
            try:
                def run(*args,**kwargs):
                    self.assertEqual(args[3],'\x03');self.assertEqual(kwargs['stop_signal'],signal.SIGINT);self.assertTrue(kwargs['terminal_input']);writer(log);time.sleep(.15);return code
                with mock.patch.object(runtime,'configure',return_value=(['fixture'],{},[secret],b'Bringing up level for play took')),mock.patch.object(runtime,'run',side_effect=run),mock.patch.object(sys,'stdout',output):
                    result=runtime.main(root,{'VOLTRA_TACTICAL_NEXT':'groundbranch','AUTO_UPDATE':'0'})
                self.assertEqual(result,code);return output.value()
            finally:output.close()

    def test_fresh_log_ready_and_split_credential_redaction(self):
        def writer(log):
            log.write_bytes(b'\xef\xbb\xbfBringing up level for play took: .01\nfixture-');time.sleep(.08)
            with log.open('ab')as stream:stream.write(b'secret\n')
        text=self.exercise(writer);self.assertIn(b'Bringing up level for play took',text);self.assertIn(b'[redacted]',text);self.assertNotIn(b'fixture-secret',text)

    def test_old_ready_not_replayed_and_only_new_bytes_relayed(self):
        def writer(log):
            with log.open('ab')as stream:stream.write(b'NEW_GENERATION_LINE\n')
        text=self.exercise(writer,previous=b'Bringing up level for play took: OLD\n');self.assertNotIn(b'Bringing up',text);self.assertIn(b'NEW_GENERATION_LINE',text)

    def test_same_active_file_truncation_restarts_fresh_cursor(self):
        text=self.exercise(lambda p:p.write_bytes(b'NEW_READY\n'),previous=b'OLD_HISTORICAL_READY_LONG_LINE\n');self.assertIn(b'NEW_READY',text);self.assertNotIn(b'OLD',text)

    def test_utf16_bom_decoded_and_redacted(self):
        text=self.exercise(lambda p:p.write_bytes(b'\xff\xfe'+'Bringing up level for play took\nfixture-secret\n'.encode('utf-16-le')));self.assertIn(b'Bringing up',text);self.assertIn(b'[redacted]',text);self.assertNotIn(b'fixture-secret',text)

    def test_rotated_backup_not_read(self):
        text=self.exercise(lambda p:p.with_name('GroundBranch-backup-2026.log').write_bytes(b'HISTORICAL_READY\n'));self.assertEqual(text,b'')

    def test_symlink_log_rejected_without_outside_read(self):
        def writer(log):
            outside=log.parent.parent/'outside.txt';outside.write_bytes(b'OUTSIDE_SECRET\n');log.symlink_to(outside)
        text=self.exercise(writer);self.assertNotIn(b'OUTSIDE_SECRET',text)

    def test_finish_runs_on_native_failure(self):
        with tempfile.TemporaryDirectory()as directory,mock.patch.object(runtime,'configure',return_value=([],{},[],b'ready')),mock.patch.object(runtime,'run',side_effect=RuntimeError('fixture native failure')),mock.patch.object(sys.modules['native_log'],'NativeLogRelay')as relay:
            with self.assertRaisesRegex(RuntimeError,'fixture native failure'):runtime.main(Path(directory),{'VOLTRA_TACTICAL_NEXT':'groundbranch'})
            relay.return_value.start.assert_called_once();relay.return_value.finish.assert_called_once()

    def test_other_families_do_not_import_or_use_relay(self):
        for kind in ['aapg','battalion']:
            with self.subTest(kind=kind),mock.patch.dict(sys.modules,{'native_log':None}),mock.patch.object(runtime,'configure',return_value=([],{},[],b'ready')),mock.patch.object(runtime,'run',return_value=251)as run:
                self.assertEqual(runtime.main(Path('/unused'),{'VOLTRA_TACTICAL_NEXT':kind}),251);self.assertEqual(run.call_args.kwargs['stop_signal'],signal.SIGINT)

    def test_real_tiny_process_signal_and_raw_exit_preserved(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory)
            (root/'child.py').write_text("from pathlib import Path\nimport signal,time,sys\np=Path('GroundBranch/Saved/Logs/GroundBranch.log');p.parent.mkdir(parents=True,exist_ok=True)\ndef stop(s,f):\n Path('observed-signal').write_text(str(s))\n with p.open('a')as out:out.write('NATIVE_STOP\\n')\n sys.exit(7)\nsignal.signal(signal.SIGINT,stop)\np.write_text('Bringing up level for play took: FIXTURE\\n')\nwhile True:time.sleep(.05)\n")
            (root/'wrapper.py').write_text("import importlib.util,sys,os\nfrom pathlib import Path\nbase=Path(sys.argv[1])\nfor name in "+repr(NAMES)+":\n key=name.replace('-','_');s=importlib.util.spec_from_file_location(key,base/(name+'.py'));m=importlib.util.module_from_spec(s);sys.modules[key]=m;s.loader.exec_module(m)\nr=sys.modules['tactical_next_runtime'];r.configure=lambda *args:([sys.executable,'-B','child.py'],dict(os.environ),[],b'Bringing up level for play took')\nsys.exit(r.main(Path.cwd(),{'VOLTRA_TACTICAL_NEXT':'groundbranch','AUTO_UPDATE':'0'}))\n")
            child=subprocess.Popen([sys.executable,'-B',str(root/'wrapper.py'),str(BASE)],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);lines=queue.Queue();captured=[]
            def read():
                for line in child.stdout:captured.append(line);lines.put(line)
            thread=threading.Thread(target=read,daemon=True);thread.start()
            try:
                self.assertIn(b'Bringing up level for play took',lines.get(timeout=5));child.send_signal(signal.SIGTERM);self.assertEqual(child.wait(timeout=5),7);thread.join(timeout=2);self.assertEqual((root/'observed-signal').read_text(),str(int(signal.SIGINT)));self.assertIn(b'NATIVE_STOP',b''.join(captured))
            finally:
                if child.poll()is None:child.kill();child.wait(timeout=5)
                child.stdin.close();thread.join(timeout=2);child.stdout.close()

if __name__=='__main__':unittest.main()
