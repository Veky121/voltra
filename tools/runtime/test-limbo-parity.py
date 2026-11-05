"""Offline standalone fixtures. No network, Docker or native game process."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'internal/panel/game_library/scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
base = load('base', 'limbo-install.py')
wrapper = load('wrapper', 'limbo-parity-install.py')

def payload():
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as jar:
        jar.writestr('META-INF/MANIFEST.MF', 'Main-Class: com.loohp.limbo.Limbo\r\n')
        jar.writestr('com/loohp/limbo/Limbo.class', bytes.fromhex('cafebabe00000041'))
        jar.writestr('server.properties', b'# fixture\r\nserver-port=30000\r\nserver-ip=localhost\r\nunknown=keep\r\n')
    return out.getvalue()

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        data = payload()
        for p in (patch.object(base, 'fetch', return_value=data), patch.object(base, 'select_release', return_value={'url':'https://example.org/fixture.jar', 'sha256':hashlib.sha256(data).hexdigest(), 'version':'offline-fixture'})):
            p.start(); self.addCleanup(p.stop)
        # Windows lacks chown. Linux ownership remains a native acceptance gate.
        if not hasattr(os, 'chown'):
            p = patch.object(os, 'chown', create=True); p.start(); self.addCleanup(p.stop)

    def test_seed_then_preserve_operator_config_and_other_files(self):
        wrapper.install(self.root, {'SERVER_PORT':'28123'}, base)
        config = self.root / 'server.properties'
        self.assertIn(b'server-port=28123\r\n', config.read_bytes())
        self.assertIn(b'server-ip=0.0.0.0\r\nunknown=keep', config.read_bytes())
        original = b'# operator\r\nserver-port=28124\r\nforwarding-secrets=private\r\nunknown=keep\r\n'
        config.write_bytes(original)
        for name in ('spawn.schem', 'whitelist.json', 'permissions.yml'):
            (self.root / name).write_bytes(b'operator data')
        wrapper.install(self.root, {'SERVER_PORT':'28125'}, base)
        self.assertEqual(config.read_bytes(), original)
        for name in ('spawn.schem', 'whitelist.json', 'permissions.yml'):
            self.assertEqual((self.root / name).read_bytes(), b'operator data')

    def test_invalid_first_port_fails_before_download(self):
        for port in ('', '0', '65536', '1\nstop', '-1'):
            with self.subTest(port=port), patch.object(base, 'fetch') as fetch:
                with self.assertRaises(ValueError): wrapper.install(self.root, {'SERVER_PORT':port}, base)
                fetch.assert_not_called()

    def test_existing_config_needs_no_new_port_and_is_untouched(self):
        original = b'unknown=secret\nserver-port=31000\n'
        (self.root / 'server.properties').write_bytes(original)
        wrapper.install(self.root, {}, base)
        self.assertEqual((self.root / 'server.properties').read_bytes(), original)

    def test_digest_failure_keeps_existing_program_and_config(self):
        (self.root / 'Limbo.jar').write_bytes(b'operator executable')
        (self.root / 'server.properties').write_bytes(b'operator config')
        with patch.object(base, 'fetch', return_value=b'corrupt'):
            with self.assertRaisesRegex(ValueError, 'checksum'):
                wrapper.install(self.root, {}, base)
        self.assertEqual((self.root / 'Limbo.jar').read_bytes(), b'operator executable')
        self.assertEqual((self.root / 'server.properties').read_bytes(), b'operator config')

if __name__ == '__main__': unittest.main()
