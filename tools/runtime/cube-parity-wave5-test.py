import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cube_wave5', Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/cube-preflight.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)
runtime = wrapper.load_runtime()
BASE = {'SERVER_PORT': '28020', 'VOLTRA_ALLOCATED_PORTS': '28020,28021', 'PUBLIC_SERVER': '0'}


class CubePreflight(unittest.TestCase):
    def fixture(self, root, kind):
        binary = root / kind / 'bin_unix/linux_64_server'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b'fixture only')

    def snapshot(self, root):
        return {p.relative_to(root).as_posix(): p.read_bytes() if p.is_file() else None for p in root.rglob('*')}

    def test_canonical_baseline_publishes_paths_before_refusal(self):
        for kind, prefix in [('assaultcube', 'ASSAULT_SERVER_'), ('sauerbraten', 'CUBE_')]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                with self.assertRaises(ValueError):
                    runtime.configure(root, {**BASE, prefix + 'MAXPLAYERS': '17'}, kind)
                self.assertTrue((root / kind / 'userdata').is_dir())
                self.assertTrue((root / '.voltra' / kind).is_dir())
                with self.assertRaises(ValueError):
                    runtime.configure(root, {**BASE, prefix + 'MASTERSERVER': 'bad host'}, kind)
                self.assertTrue((root / '.voltra' / kind / 'admin-password').is_file())

    def test_invalid_control_refusal_leaves_paths_and_bytes_identical(self):
        for kind, prefix in [('assaultcube', 'ASSAULT_SERVER_'), ('sauerbraten', 'CUBE_')]:
            changes = [{prefix + 'MAXPLAYERS': '17'}, {prefix + 'MASTERSERVER': 'bad host'},
                       {prefix + 'ADMINPASSWORD': 'tiny'}, {'PUBLIC_SERVER': 'yes'},
                       {prefix + 'DESCRIPTION' if kind == 'assaultcube' else 'CUBE_SERVERDESCRIPTION': 'bad\nline'},
                       {'ASSAULT_SERVER_MOTD' if kind == 'assaultcube' else 'SERVER_MOTD': 'bad\nline'},
                       {'VOLTRA_ALLOCATED_PORTS': '28020,28022'}, {'SERVER_PORT': '65535'}]
            if kind == 'assaultcube':
                changes += [{'PUBLIC_SERVER': '1', 'ASSAULT_SERVER_KEY': ''}, {'ASSAULT_SERVER_KEY': 'A' * 64}]
            for change in changes:
                with self.subTest(kind=kind, change=change), tempfile.TemporaryDirectory() as folder:
                    root = Path(folder); self.fixture(root, kind)
                    (root / kind / 'operator.cfg').write_bytes(b'keep \r\n')
                    before = self.snapshot(root)
                    with patch.object(runtime, 'run') as native, self.assertRaises(ValueError):
                        wrapper.run(runtime, root, {**BASE, **change}, kind)
                    native.assert_not_called()
                    self.assertEqual(before, self.snapshot(root))

    def test_missing_payload_never_creates_credentials(self):
        for kind in wrapper.KINDS:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                with patch.object(runtime, 'run') as native, self.assertRaises(ValueError):
                    wrapper.run(runtime, root, BASE, kind)
                native.assert_not_called(); self.assertEqual(list(root.iterdir()), [])

    def test_valid_preflight_delegates_unchanged_environment_and_exit(self):
        for kind in wrapper.KINDS:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); self.fixture(root, kind)
                before = self.snapshot(root)
                with patch.object(runtime, 'run', return_value=17) as native:
                    self.assertEqual(wrapper.run(runtime, root, BASE, kind), 17)
                native.assert_called_once_with(root, BASE, kind)
                self.assertEqual(before, self.snapshot(root))

    def test_bad_existing_private_credential_refuses_before_new_files(self):
        for kind in wrapper.KINDS:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); self.fixture(root, kind)
                target = root / '.voltra' / kind / 'admin-password'; target.parent.mkdir(parents=True)
                target.write_text('tiny')
                before = self.snapshot(root)
                with patch.object(runtime, 'run') as native, self.assertRaises(ValueError):
                    wrapper.run(runtime, root, BASE, kind)
                native.assert_not_called(); self.assertEqual(before, self.snapshot(root))

    def test_executable_cube_cfg_is_opaque_and_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); self.fixture(root, 'sauerbraten')
            cfg = root / 'sauerbraten/server-init.cfg'
            data = b'// operator\r\nif (= $foo 1) [exec "custom.cfg"]\r\nserverdesc "native ^\"text"\r\n'
            cfg.write_bytes(data)
            with patch.object(runtime, 'run', return_value=0):
                wrapper.run(runtime, root, BASE, 'sauerbraten')
            self.assertEqual(cfg.read_bytes(), data)

    def test_existing_wrong_path_type_refuses_before_runtime(self):
        for kind in wrapper.KINDS:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); self.fixture(root, kind)
                (root / kind / 'userdata').write_bytes(b'operator')
                with patch.object(runtime, 'run') as native, self.assertRaises(ValueError):
                    wrapper.run(runtime, root, BASE, kind)
                native.assert_not_called()

    def test_symlink_credential_refuses_without_following_or_writing(self):
        for kind in wrapper.KINDS:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as outside:
                root = Path(folder); self.fixture(root, kind)
                target = Path(outside) / 'password'; target.write_text('operator-fixture-value')
                credential = root / '.voltra' / kind / 'admin-password'
                credential.parent.mkdir(parents=True)
                try:
                    credential.symlink_to(target)
                except OSError:
                    self.skipTest('This host cannot create fixture symbolic links')
                before = self.snapshot(root)
                with patch.object(runtime,'run') as native, self.assertRaises(ValueError):
                    wrapper.run(runtime, root, BASE, kind)
                native.assert_not_called(); self.assertEqual(before,self.snapshot(root))
                self.assertEqual(target.read_text(),'operator-fixture-value')


if __name__ == '__main__':
    unittest.main()
