import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('archean_wave3', Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/archean-file-authority.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)
runtime = wrapper.load_runtime()


class ArcheanAuthority(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / wrapper.DOCUMENT
        self.target.parent.mkdir(parents=True)
        self.env = {'SERVER_PORT': '28020', 'VOLTRA_ALLOCATED_PORTS': '28020', 'AUTO_UPDATE': '0'}
        binary = self.root / 'Archean-game/Archean_server'
        binary.parent.mkdir()
        binary.write_bytes(b'fixture')

    def execute(self, extra=None):
        console = types.SimpleNamespace(run=lambda *args, **kwargs: 0)
        with patch.object(runtime, 'helper', return_value=console):
            return wrapper.run(runtime, self.root, {**self.env, **(extra or {})})

    def test_seed_all_controls_and_preserve_native_authority_repeatedly(self):
        self.target.write_bytes(b';operator\r\n[server]\r\nserver_public_name=Native Name\r\npassword=private native\r\naccept_remote_connections=no\r\n[game]\r\nunknown=keep\r\n')
        self.execute({'SERVER_NAME': 'stale', 'PASSWORD': 'stale'})
        first = self.target.read_bytes()
        self.execute({'SERVER_NAME': 'new stale', 'PASSWORD': 'new stale'})
        self.assertEqual(self.target.read_bytes(), first)
        self.assertIn(b'server_public_name=Native Name\r\npassword=private native\r\naccept_remote_connections=no\r\n', first)
        self.assertIn(b'unknown=keep\r\n', first)
        for section, controls in wrapper.CONTROLS.items():
            for key in controls:
                self.assertIn(key.encode() + (b'=' if key in ('server_public_name', 'password') else b' ='), first)

    def test_port_reconciles_while_identity_and_unknown_bytes_survive(self):
        self.execute()
        self.execute({'SERVER_PORT': '28021', 'VOLTRA_ALLOCATED_PORTS': '28021'})
        self.assertIn(b'listen_port = 28021', self.target.read_bytes())

    def test_invalid_native_controls_refuse_before_acquisition(self):
        for text in ('[server]\nmax_simultaneous_players=0\n', '[game]\nspawn=mars\n', '[server]\nserver_online=maybe\n', '[game]\nworld=../escape\n', '[server]\npassword=x\npassword=y\n', '[Server]\npassword=x\n', '\ufeff[server]\npassword=x\n'):
            with self.subTest(text=text):
                self.target.write_text(text, encoding='utf-8')
                before = self.target.read_bytes()
                paths = sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*'))
                with patch.object(runtime, 'install') as install, self.assertRaises(ValueError):
                    self.execute({'AUTO_UPDATE': '1'})
                install.assert_not_called()
                self.assertEqual(self.target.read_bytes(), before)
                self.assertEqual(sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*')), paths)

    def test_real_supervisor_receives_native_secret_without_argv(self):
        self.target.write_text('[server]\npassword=operator-secret\n')
        calls = []
        console = types.SimpleNamespace(run=lambda *args, **kwargs: calls.append((args, kwargs)) or -15)
        with patch.object(runtime, 'helper', return_value=console):
            self.assertEqual(wrapper.run(runtime, self.root, self.env), 143)
        args, kwargs = calls[0]
        self.assertIn('operator-secret', args[4])
        self.assertNotIn('operator-secret', ' '.join(args[1]))
        self.assertEqual(args[0], self.root / 'Archean-game')
        self.assertTrue(kwargs['terminal_input'])

    def test_baseline_overwrites_native_identity_and_password(self):
        self.target.write_text('[server]\nserver_public_name=Native\npassword=operator-secret\n')
        runtime.configure(self.root, 'archean', self.env)
        self.assertNotIn('server_public_name=Native', self.target.read_text())
        self.assertNotIn('operator-secret', self.target.read_text())


if __name__ == '__main__':
    unittest.main()
