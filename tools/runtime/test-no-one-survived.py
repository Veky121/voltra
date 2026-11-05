import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/no-one-survived.py'
spec = importlib.util.spec_from_file_location('noone', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Preflight(unittest.TestCase):
    def test_refusals_precede_every_installer_and_preserve_bytes(self):
        cases = [
            {'ACCEPT_WINDOWS_RUNTIME_LICENSES':'false'}, {'WINEARCH':'win32'},
            {'WINETRICKS_RUN':'vcrun2022;curl'}, {'SERVER_PLAYERS':'101'},
            {'SERVER_NUM_ZOMBIES':'24'}, {'SERVER_SAVE_NAME':'../world'},
            {'SERVER_REGION':'invalid'}, {'QUERY_PORT':'7777'},
            {'VOLTRA_STEAM_AUTO_UPDATE':'yes'}, {'SERVER_NAME':'a\nb'},
        ]
        for action in ('run', 'install'):
            for delta in cases:
                with self.subTest(action=action, delta=delta), tempfile.TemporaryDirectory() as folder:
                    root=Path(folder)
                    world=root/'operator-world.bin'; world.write_bytes(b'\x00secret\xffworld')
                    env={'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','VOLTRA_ALLOCATED_PORTS':'7777,27015', **delta}
                    with patch.object(m.family, 'install') as install, patch.object(m.family, 'run') as run:
                        with self.assertRaises(ValueError):m.execute(action, root, env)
                        install.assert_not_called(); run.assert_not_called()
                    self.assertEqual(world.read_bytes(), b'\x00secret\xffworld')
                    self.assertEqual(list(root.iterdir()), [world])

    def test_valid_preflight_does_not_create_files_and_preserves_raw_exit(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            env={'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','VOLTRA_ALLOCATED_PORTS':'7777,27015'}
            with patch.object(m.family, 'run', return_value=42) as run:
                self.assertEqual(m.execute('run',root,env),42)
                run.assert_called_once_with(root,'noone',env)
            self.assertEqual(list(root.iterdir()),[])

    def test_unreadable_native_encoding_refuses_without_replacement(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); config=root/'WRSH/Saved/Config/WindowsServer/Game.ini'
            config.parent.mkdir(parents=True); config.write_bytes(b'\xffunknown\x00')
            with patch.object(m.family,'install') as install:
                with self.assertRaises(UnicodeError):m.execute('install',root,{'ACCEPT_WINDOWS_RUNTIME_LICENSES':'true','VOLTRA_ALLOCATED_PORTS':'7777,27015'})
                install.assert_not_called()
            self.assertEqual(config.read_bytes(),b'\xffunknown\x00')

if __name__=='__main__':unittest.main()
