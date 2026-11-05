import importlib.util
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
spec = importlib.util.spec_from_file_location('icarus_native', BASE / 'icarus-native.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Preservation(unittest.TestCase):
    def test_legacy_and_active_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            legacy = root / 'Icarus/Saved/Config/ServerSettings.ini'
            legacy.parent.mkdir(parents=True)
            payload = b'\xef\xbb\xbf[/Script/Icarus.DedicatedServerSettings]\r\nResumeProspect=True\r\nLastProspectName=ExistingWorld\r\n+Unknown=(A=1)\r\n+Unknown=(A=2)\r\n; untouched\r\n'
            legacy.write_bytes(payload)
            env = {'SERVER_PORT':'29170','QUERY_PORT':'29171','VOLTRA_ALLOCATED_PORTS':'29170,29171','SRCDS_APPID':'2089300','WINDOWS_INSTALL':'1'}
            module.configure(root, 'icarus', env)
            target = legacy.parent / 'WindowsServer/ServerSettings.ini'
            self.assertEqual(target.read_bytes(), payload)
            target.write_bytes(payload + b'Unknown=operator\r\n')
            module.configure(root, 'icarus', env)
            self.assertEqual(target.read_bytes(), payload + b'Unknown=operator\r\n')
            self.assertEqual(legacy.read_bytes(), payload)

    def test_invalid_ports_write_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaises(ValueError):
                module.configure(root, 'icarus', {'SERVER_PORT':'29170','QUERY_PORT':'29170','VOLTRA_ALLOCATED_PORTS':'29170','SRCDS_APPID':'2089300','WINDOWS_INSTALL':'1'})
            self.assertEqual(list(root.iterdir()), [])

if __name__ == '__main__':
    unittest.main()
