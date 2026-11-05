import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'internal/panel/game_library/scripts'
fake = types.ModuleType('ddnet_install')
fake.install = lambda root: None
sys.modules['ddnet_install'] = fake


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


load('ddnet_runtime', SCRIPTS / 'ddnet-runtime.py')
subject = load('ddnet_original_parity', SCRIPTS / 'ddnet-original-parity.py')


class NativeFileAuthority(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'ddnet/data').mkdir(parents=True)
        (self.root / 'ddnet/DDNet-Server').write_bytes(b'fixture-binary')
        (self.root / 'ddnet/data/autoexec_server.cfg').write_bytes(b'# untouched\r\nexec operator.cfg\r\n')
        self.env = dict(SERVER_PORT='29102', SERVER_NAME='Original name', SERVER_MAP='Sunny Side Up',
                        MAX_PLAYERS='64', PUBLIC_SERVER='0', SIXUP='1', TEST_COMMANDS='0')

    def test_seed_once_and_no_cli_shadow_or_double_exec(self):
        argv = subject.prepare(self.root, self.env)
        cfg = self.root / 'ddnet/autoexec_server.cfg'
        text = cfg.read_text()
        self.assertIn('exec data/autoexec_server.cfg\nsv_name "Original name"', text)
        self.assertIn('sv_map "Sunny Side Up"', text)
        self.assertNotIn('-f', argv)
        self.assertFalse(any(x.startswith(('sv_name ', 'sv_map ', 'sv_max_clients ', 'sv_sixup ', 'sv_test_cmds ', 'sv_register ')) for x in argv))
        self.assertIn('sv_port 29102', argv)
        self.assertEqual((self.root / 'ddnet/data/autoexec_server.cfg').read_bytes(), b'# untouched\r\nexec operator.cfg\r\n')
        if os.name != 'nt':
            self.assertEqual(cfg.stat().st_mode & 0o777, 0o600)

    def test_existing_operator_config_preserved_exact(self):
        cfg = self.root / 'ddnet/autoexec_server.cfg'
        original = b'# existing\r\nsv_name "Operator"\r\nexec custom.cfg\r\n'
        cfg.write_bytes(original)
        subject.prepare(self.root, self.env)
        self.assertEqual(cfg.read_bytes(), original)

    def test_private_credential_reused_and_unchanged(self):
        credential = self.root / '.voltra/ddnet/rcon-password'
        credential.parent.mkdir(parents=True)
        credential.write_text('private-existing-fixture')
        subject.prepare(self.root, self.env)
        self.assertIn('sv_rcon_password "private-existing-fixture"', (self.root / 'ddnet/autoexec_server.cfg').read_text())
        self.assertEqual(credential.read_text(), 'private-existing-fixture')

    def test_invalid_inputs_refuse_before_acquisition_or_writes(self):
        old = subject.install
        calls = []
        subject.install = lambda root: calls.append(root)
        self.addCleanup(setattr, subject, 'install', old)
        for key, value in [('SERVER_NAME', 'bad\nshutdown'), ('SERVER_MAP', '../escape'),
                           ('MAX_PLAYERS', '129'), ('PUBLIC_SERVER', '2'), ('SERVER_PORT', '0'),
                           ('RCON_PASSWORD', 'bad\rsecret')]:
            with self.subTest(key=key):
                before = sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob('*'))
                with self.assertRaises(ValueError):
                    subject.prepare(self.root, {**self.env, key: value}, True)
                self.assertEqual(calls, [])
                self.assertEqual(before, sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob('*')))

    def test_missing_binary_no_seed_publication(self):
        (self.root / 'ddnet/DDNet-Server').unlink()
        with self.assertRaises(ValueError):
            subject.prepare(self.root, self.env)
        self.assertFalse((self.root / 'ddnet/autoexec_server.cfg').exists())

    def test_public_enabled_preserved(self):
        subject.prepare(self.root, {**self.env, 'PUBLIC_SERVER': '1'})
        self.assertIn('sv_register 1\n', (self.root / 'ddnet/autoexec_server.cfg').read_text())

    def test_acquisition_failure_does_not_publish_seed(self):
        old = subject.install
        def fail(root):
            raise RuntimeError('fixture acquisition refused')
        subject.install = fail
        self.addCleanup(setattr, subject, 'install', old)
        before = {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        with self.assertRaises(RuntimeError):
            subject.prepare(self.root, self.env, True)
        self.assertEqual(before, {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        self.assertFalse((self.root / '.voltra').exists())

    @unittest.skipIf(os.name == 'nt', 'Linux native symlink semantics')
    def test_escaping_root_config_refused(self):
        (self.root / 'ddnet/autoexec_server.cfg').symlink_to('/tmp/escape')
        with self.assertRaises(ValueError):
            subject.prepare(self.root, self.env)


if __name__ == '__main__':
    unittest.main()
