import importlib.util
import pathlib
import sys
import tempfile
import unittest

scripts = pathlib.Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
sys.path.insert(0, str(scripts))
native_spec = importlib.util.spec_from_file_location('native_config', scripts / 'native-config.py')
native = importlib.util.module_from_spec(native_spec)
sys.modules['native_config'] = native
native_spec.loader.exec_module(native)
spec = importlib.util.spec_from_file_location('mcgalaxy_seed', scripts / 'mcgalaxy-seed.py')
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


class SeedTest(unittest.TestCase):
    def test_seed_and_operator_authority(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            seed.configure(root, {'HOSTNAME': 'Literal = name', 'MOTD': 'Welcome', 'PUBLIC_SERVER': 'false'})
            p = root / 'properties/server.properties'
            self.assertIn('server-name = Literal = name', p.read_text())
            operator = b'# operator\r\npublic = true\r\nunknown = retained\r\n'
            p.write_bytes(operator)
            seed.configure(root, {'HOSTNAME': 'replacement'})
            self.assertEqual(operator, p.read_bytes())

    def test_injection_refuses_before_write(self):
        for env in ({'MOTD': 'hello\nverify-names = false'}, {'PUBLIC_SERVER': 'yes'}, {'HOSTNAME': 'bad\x00'}):
            with tempfile.TemporaryDirectory() as d:
                root = pathlib.Path(d)
                with self.assertRaises(ValueError):
                    seed.configure(root, env)
                self.assertEqual(list(root.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
