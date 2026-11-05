"""Offline wire fixtures, no sockets or game process."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('diagnose', Path(__file__).with_name('stk-shutdown-diagnose.py'))
diagnose = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnose)


class Tests(unittest.TestCase):
    def test_publisher_length_prefixed_request(self):
        self.assertEqual(diagnose.discovery_request().hex(), '0a73746b2d736572766572')
        self.assertEqual(diagnose.decode_command(diagnose.discovery_request()), 'stk-server')

    def test_original_probe_is_truncated_string(self):
        with self.assertRaisesRegex(ValueError, 'getString out of range'):
            diagnose.decode_command(b'stk-server')
        self.assertEqual(b'stk-server'[0], 115)


if __name__ == '__main__':
    unittest.main(verbosity=2)
