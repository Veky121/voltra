"""Actual supervised subprocesses; raw Python statuses remain unchanged."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import unittest

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
SECRET = 'private-fixture-secret'

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, BASE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

if len(sys.argv) > 1 and sys.argv[1] == '--supervisor':
    load('steam_template', 'steam-template.py')
    native = load('native_console', 'native-console.py')
    mode = sys.argv[2]
    scripts = {
        'kill': 'import os,signal;print("'+SECRET+'",flush=True);os.kill(os.getpid(),signal.SIGKILL)',
        'diagnostic_redaction': 'import os,signal;print("'+SECRET+'",flush=True);os.kill(os.getpid(),signal.SIGKILL)',
        'positive': 'import sys;print("'+SECRET+'",flush=True);sys.exit(17)',
        'clean': 'print("'+SECRET+'",flush=True)',
        'requested': 'import signal,time;signal.signal(signal.SIGINT,signal.SIG_DFL);print("READY",flush=True);time.sleep(20)',
        'stdin': 'import sys;print("READY",flush=True);sys.stdin.readline();sys.exit(17)',
    }
    status = native.run(Path.cwd(), [sys.executable, '-u', '-c', scripts[mode]], dict(os.environ), 'stop',
                        credentials=[SECRET,'SIGKILL'] if mode == 'diagnostic_redaction' else [SECRET], stop_signal=signal.SIGINT if mode == 'requested' else None)
    print('RETURN_STATUS='+str(status), flush=True)
    sys.exit(0)

class ExitDiagnostics(unittest.TestCase):
    def invoke(self, mode):
        process = subprocess.Popen([sys.executable, '-u', __file__, '--supervisor', mode],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        prefix = b''
        if mode in ('requested', 'stdin'):
            prefix = process.stdout.readline()
            self.assertEqual(prefix.strip(), b'READY')
            if mode == 'requested': process.send_signal(signal.SIGTERM)
            else:
                process.stdin.write(b'sto'); process.stdin.flush()
                process.stdin.write(b'p\r\n'); process.stdin.flush()
        output = prefix + process.communicate(timeout=10)[0]
        self.assertEqual(process.returncode, 0, output)
        self.assertNotIn(SECRET.encode(), output)
        return output

    def test_unexpected_signal_retains_negative_status(self):
        output = self.invoke('kill')
        self.assertIn(b'RETURN_STATUS=-9', output)
        self.assertIn(b'[ERROR] Native process exited: raw_status=-9; signal=9 (SIGKILL); stop_requested=false.', output)
        self.assertEqual(output.count(b'Native process exited:'), 1)

    def test_positive_status_does_not_invent_signal(self):
        output = self.invoke('positive')
        self.assertIn(b'RETURN_STATUS=17', output)
        self.assertIn(b'[ERROR] Native process exited: raw_status=17; stop_requested=false.', output)
        self.assertNotIn(b'; signal=', output)
        self.assertEqual(output.count(b'Native process exited:'), 1)

    def test_diagnostic_uses_existing_credential_redactor(self):
        output = self.invoke('diagnostic_redaction')
        self.assertNotIn(b'SIGKILL', output)
        self.assertIn(b'signal=9 ([redacted])', output)
        self.assertEqual(output.count(b'Native process exited:'), 1)

    def test_clean_exit_has_no_error(self):
        output = self.invoke('clean')
        self.assertIn(b'RETURN_STATUS=0', output)
        self.assertNotIn(b'Native process exited:', output)

    def test_requested_interrupt_warns_and_retains_raw_status(self):
        output = self.invoke('requested')
        self.assertIn(b'RETURN_STATUS=-2', output)
        self.assertIn(b'[WARN] Native process exited: raw_status=-2; signal=2 (SIGINT); stop_requested=true.', output)
        self.assertEqual(output.count(b'Native process exited:'), 1)

    def test_exact_stdin_stop_intent_across_reads(self):
        output = self.invoke('stdin')
        self.assertIn(b'[WARN] Native process exited: raw_status=17; stop_requested=true.', output)
        self.assertEqual(output.count(b'Native process exited:'), 1)

if __name__ == '__main__': unittest.main()
