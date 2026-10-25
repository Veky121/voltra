"""MIT. Protected-input protocol and platform boundary fixtures, no native game."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
import os

spec = importlib.util.spec_from_file_location('star_prepare', Path(__file__).with_name('prepare.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ProtectedInput(unittest.TestCase):
    def test_unicode_exact(self):
        bridge.validate(bridge.packet('密碼🔒', 'é'))

    def test_one_role_and_explicit_clear(self):
        bridge.validate(bridge.packet(None, ''))
        self.assertEqual(bridge.packet('', None)[6:10], struct.pack('<I', 0))

    def test_reject_before_writes(self):
        bridge.validate(bridge.packet('secret\t\r\n\x7f', None))
        for value in ('secret\x00', '\ud800', 'x' * (bridge.MAX_VALUE + 1)):
            with self.assertRaises((ValueError, UnicodeError)):
                bridge.packet(value, None)
        for body in (b'', bridge.packet('secret', None) + b'x', bridge.packet('secret', None)[:-1], b'VSPB1\n' + b'\xff' * 8):
            with self.assertRaises((ValueError, UnicodeError)):
                bridge.validate(body)

    def test_no_empty_operation(self):
        with self.assertRaises(ValueError): bridge.packet()

    def test_private_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            if os.name != 'posix':
                with self.assertRaises(ValueError): bridge.stage(directory, bridge.packet('secret', None))
                self.assertFalse((Path(directory) / 'request.bin').exists())
                return
            os.chmod(directory, 0o700)
            bridge.stage(directory, bridge.packet('secret', None))
            path = Path(directory) / 'request.bin'
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError): bridge.stage(directory, bridge.packet('changed', None))
            self.assertEqual(path.read_bytes(), bridge.packet('secret', None))


if __name__ == '__main__': unittest.main()
