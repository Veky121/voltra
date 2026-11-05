"""Offline regression for byte-preserving missing-control seeding."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('controls', Path('internal/panel/game_library/scripts/arma3-controls.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class LineEndingTests(unittest.TestCase):
    def test_seed_preserves_existing_bytes_and_second_boot_is_noop(self):
        for ending in (b'\r\n', b'\n'):
            with self.subTest(ending=ending), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                original = ending.join([b'// operator', b'hostname="native";',
                    b'class Missions { class One { template="coop.Altis"; }; };', b'unknown=42;', b''])
                cfg = root / 'server.cfg'
                cfg.write_bytes(original)
                (root / 'mpmissions').mkdir()
                mission = root / 'mpmissions/operator.pbo'
                mission.write_bytes(b'operator\x00mission')
                env = dict(INSTALL_MODE='existing', UPDATE_SERVER='0', DISABLE_MOD_UPDATES='1',
                    VOLTRA_ALLOCATED_PORTS='2302,2303,2304,2305,2306', BATTLEYE='1')
                c.configure(root, 'arma3', env)
                seeded = cfg.read_bytes()
                self.assertTrue(seeded.startswith(original))
                self.assertIn(b'BattlEye = 1;', seeded)
                stamp = cfg.stat().st_mtime_ns
                c.configure(root, 'arma3', env)
                self.assertEqual(cfg.read_bytes(), seeded)
                self.assertEqual(cfg.stat().st_mtime_ns, stamp)
                self.assertEqual(mission.read_bytes(), b'operator\x00mission')


if __name__ == '__main__':
    unittest.main()
