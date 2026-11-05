"""Diagnostic contract fixtures; mocked child, not native acceptance."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import tempfile
import unittest

SOURCE = Path(__file__).with_name('clonehero-parity-wave4-diagnostics.py')


class Diagnostics(unittest.TestCase):
    def invoke(self, code, stopped, ready):
        spec = importlib.util.spec_from_file_location('clone_diagnostics_fixture', SOURCE)
        candidate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(candidate)
        original_cwd = Path.cwd()
        original_register = signal.signal
        handlers = {n: signal.getsignal(n) for n in (signal.SIGINT, signal.SIGTERM)}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.voltra').mkdir()
            fake = """import signal
def configure(root, game, env):
 assert game == 'clone'
 return root, ['native-server'], {'fixture':'1'}, '\\x03', ['not-printed'], 'Server running...'
def run(cwd, argv, environment, stop, credentials, **options):
 assert argv == ['native-server'] and environment == {'fixture':'1'}
 assert stop == '\\x03' and credentials == ['not-printed']
 assert options['terminal_input'] and options['terminal_query_reply']
 signal.signal(signal.SIGTERM, lambda *_: None)
 if READY: options['output_observer'](b'Server running...')
 if STOPPED: signal.getsignal(signal.SIGTERM)(signal.SIGTERM,None)
 return CODE
""".replace('READY', repr(ready)).replace('STOPPED', repr(stopped)).replace('CODE', repr(code))
            (root / '.voltra/small_games_family_runtime.py').write_text(fake)
            output = io.StringIO()
            try:
                os.chdir(root)
                with contextlib.redirect_stdout(output):
                    actual = candidate.main()
            finally:
                os.chdir(original_cwd)
                for number, handler in handlers.items():
                    original_register(number, handler)
            self.assertIs(signal.signal, original_register)
            self.assertEqual(actual, code)
            self.assertNotIn('not-printed', output.getvalue())
            record = json.loads(output.getvalue().split('VOLTRA_CLONE_RAW_EXIT ', 1)[1])
            self.assertEqual(record, {'ready': ready, 'stop_requested': stopped, 'raw_child_returncode': code})

    def test_requested_interrupt_remains_negative(self):
        self.invoke(-2, True, True)

    def test_unexpected_failure_is_never_normalized(self):
        self.invoke(17, False, False)

    def test_unrequested_interrupt_is_distinct(self):
        self.invoke(-2, False, True)


if __name__ == '__main__':
    unittest.main()
