import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

BASE = Path(__file__).resolve().parents[2]
def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, BASE / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
wrapper = load('vanilla', 'internal/panel/game_library/scripts/assetto-vanilla-native.py')
authority = load('authority', 'internal/panel/game_library/scripts/assetto-native-authority.py')
shared = authority.load_shared()

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.files = {
            'cfg/server_cfg.ini': b'[SERVER]\r\nADMIN_PASSWORD="ownedsecret" ; comment\r\nCARS="car_a;car_b"\r\nTRACK="track"\r\nREGISTER_TO_LOBBY=0\r\n[PRACTICE]\r\nTIME=10\r\n',
            'cfg/entry_list.ini': b'[CAR_0]\nMODEL="car_b"\nSKIN=operator\n',
            'content/tracks/track/data/surfaces.ini': b'[SURFACE_0]\nKEY=ROAD\n',
            'content/cars/car_b/data.acd': b'owned fixture',
            'acServer': b'not a native server',
        }
        for name, data in self.files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.env = {'AUTO_UPDATE': '0', 'SERVER_PORT': '28000', 'HTTP_PORT': '28001', 'VOLTRA_ALLOCATED_PORTS': '28000,28001'}
    def check(self):
        return wrapper.preflight(authority, shared, self.root, self.env, True)
    def test_quotes_arrays_comments_preserved_and_ports_planned(self):
        plan = self.check()
        self.assertIn(b'CARS="car_a;car_b"\r\n', plan['planned'])
        self.assertIn(b'UDP_PORT = 28000', plan['planned'])
        self.assertIn('ownedsecret', plan['credentials'])
        for name, data in self.files.items():
            self.assertEqual((self.root / name).read_bytes(), data)
    def test_short_quoted_password_cannot_use_comments_as_length(self):
        path = self.root / 'cfg/server_cfg.ini'
        path.write_bytes(path.read_bytes().replace(b'"ownedsecret"', b'"x"'))
        with self.assertRaises(ValueError): self.check()
    def test_missing_content_and_model_mismatch_refuse_without_writes(self):
        (self.root / 'content/cars/car_b/data.acd').unlink()
        with self.assertRaises(ValueError): self.check()
        self.assertEqual((self.root / 'cfg/server_cfg.ini').read_bytes(), self.files['cfg/server_cfg.ini'])
    def test_duplicate_case_alias_and_malformed_quote_refuse(self):
        for content in (b'[SERVER]\nCARS=a\ncars=b\n', b'[SERVER]\nNAME="unterminated\n', b'[SERVER]\n[server]\n'):
            with self.assertRaises(ValueError): wrapper.document(content)
    def test_traversal_and_invalid_lobby_refuse(self):
        path = self.root / 'cfg/server_cfg.ini'
        for old, new in ((b'"track"', b'../track'), (b'REGISTER_TO_LOBBY=0', b'REGISTER_TO_LOBBY=2')):
            path.write_bytes(self.files['cfg/server_cfg.ini'].replace(old, new))
            with self.assertRaises(ValueError): self.check()
    def test_credentials_refuse_before_shared_install(self):
        self.env.update(AUTO_UPDATE='1', STEAM_USER='owned-account')
        with self.assertRaises(ValueError): self.check()
    def test_semicolon_car_array_not_inline_comment(self):
        self.assertEqual(wrapper.document(b'[SERVER]\nCARS=a;b;c\n')['server']['cars'], 'a;b;c')

if __name__ == '__main__': unittest.main()
