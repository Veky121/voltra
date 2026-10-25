"""Scoped offline kwargs and real Linux supervisor signal regressions."""
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(os.environ.get('FANTASY_SCRIPTS', '/scripts'))


def load(name, source):
    spec = importlib.util.spec_from_file_location(name, BASE / source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


load('steam_template', 'steam-template.py')
load('native_config', 'native-config.py')
console = load('native_console', 'native-console.py')
runtime = load('fantasy_worlds_runtime', 'fantasy-worlds-runtime.py')
installer = load('fantasy_worlds_install', 'fantasy-worlds-install.py')


class SignalFixtures(unittest.TestCase):
    def test_only_solace_opts_into_signal(self):
        for game in ('citadel', 'portal', 'solace'):
            with self.subTest(game=game), tempfile.TemporaryDirectory() as root:
                environment = {'AUTO_UPDATE': '0'}
                with patch.object(sys, 'argv', ['runtime', game]), patch.dict(os.environ, environment, clear=True), patch.object(runtime, 'configure', return_value=(Path(root), ['native'], environment, '\x03', ['secret'], b'READY')), patch.object(runtime, 'run', return_value=73) as run, patch.object(installer, 'install') as install:
                    self.assertEqual(runtime.main(), 73)
                install.assert_not_called()
                args, kwargs = run.call_args
                self.assertEqual(args, (Path(root), ['native'], environment, '\x03'))
                self.assertEqual(kwargs['credentials'], ['secret'])
                self.assertEqual(kwargs['ready_marker'], b'READY')
                self.assertTrue(kwargs['terminal_input'])
                self.assertTrue(callable(kwargs.pop('output_observer')))
                expected = {'credentials': ['secret'], 'ready_marker': b'READY', 'terminal_input': True}
                if game == 'solace':
                    expected['stop_signal'] = signal.SIGINT
                    expected['terminal_query_reply'] = True
                self.assertEqual(kwargs, expected)

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Actual Linux PTY/process-group test')
    def test_real_sigint_raw_exit(self):
        with tempfile.TemporaryDirectory() as root:
            child = Path(root) / 'child.py'
            child.write_text("import os,signal,sys,time,tty\ndef done(*_):\n print('NATIVE_SIGINT',flush=True)\n sys.exit(42)\nsignal.signal(signal.SIGINT,done)\ntty.setraw(0)\nos.write(1,b'\\x1b[6n')\nreply=b''\nwhile len(reply)<6:reply+=os.read(0,6-len(reply))\nassert reply==b'\\x1b[1;1R',repr(reply)\nprint('NATIVE_READY',flush=True)\nwhile True: time.sleep(.05)\n")
            with subprocess.Popen([sys.executable, __file__, '--supervise', root, str(child)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=dict(os.environ), text=True) as process:
                import selectors
                selector = selectors.DefaultSelector()
                selector.register(process.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(8), 'Native readiness timed out')
                line = process.stdout.readline()
                self.assertIn('NATIVE_READY', line)
                process.send_signal(signal.SIGTERM)
                output, _ = process.communicate(timeout=10)
                selector.close()
                self.assertIn('NATIVE_SIGINT', output)
                self.assertNotIn('grace expired', output)
                self.assertEqual(process.returncode, 42, line + output)


if __name__ == '__main__':
    if '--supervise' in sys.argv:
        raise SystemExit(console.run(Path(sys.argv[2]), [sys.executable, sys.argv[3]], dict(os.environ), '\x03', terminal_input=True, terminal_query_reply=True, stop_signal=signal.SIGINT, stop_signal_timeout=3))
    unittest.main()
