"""Moria-only source regressions. No native acceptance claims."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
spec = importlib.util.spec_from_file_location('moria', BASE / 'moria-native.py')
moria = importlib.util.module_from_spec(spec)
spec.loader.exec_module(moria)


class MoriaTests(unittest.TestCase):
    def setUp(self):
        # Windows source fixtures cannot verify Linux ownership preservation.
        if not hasattr(os, 'fchown'):
            fixture = patch.object(os, 'fchown', create=True)
            fixture.start()
            self.addCleanup(fixture.stop)

    def test_native_authority_and_byte_preservation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            moria.configure(root, 'moria', {})
            path = root / 'MoriaServerConfig.ini'
            content = path.read_text().replace('A Pterodactyl Server', 'Operator World').replace('normal', 'hard').replace('OptionalPassword = ', 'OptionalPassword = secret')
            content += '\n[World.Custom]\nUnknown = retain\n'
            path.write_bytes(b'\xef\xbb\xbf' + content.replace('\n', '\r\n').encode())
            before = path.read_bytes()
            moria.configure(root, 'moria', {'WORLD_NAME': 'Stale Environment', 'DIFFICULTY': 'solo'})
            self.assertEqual(before, path.read_bytes())
            moria.configure(root, 'moria', {'SERVER_PORT': '28000'})
            self.assertIn(b'ListenPort = 28000', path.read_bytes())
            self.assertIn(b'Operator World', path.read_bytes())
            self.assertTrue(path.read_bytes().startswith(b'\xef\xbb\xbf'))

    def test_all_invalid_inputs_refuse_before_updater_or_files(self):
        for env in ({}, {'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true', 'DIFFICULTY': 'bad'},
                    {'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true', 'SERVER_PORT': '0'},
                    {'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true', 'WORLD_NAME': 'injection\n'},
                    {'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true', 'WINETRICKS_RUN': 'vcrun2022 ; bad'},
                    {'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true', 'WINEARCH': 'win32'}):
            with self.subTest(env=env), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                with patch.object(moria, 'original_install') as update:
                    with self.assertRaises(ValueError):
                        moria.install(root, 'moria', env)
                    update.assert_not_called()
                self.assertEqual(list(root.iterdir()), [])

    def test_ambiguous_native_file_refuses_unchanged(self):
        for content in ('[Host]\nListenPort=7777\nlistenport=8888\n', '[World]\nName=one\n[world]\nName=two\n', '[World\nName=x\n'):
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                path = root / 'MoriaServerConfig.ini'
                path.write_text(content)
                before = path.read_bytes()
                with patch.object(moria, 'original_install') as update:
                    with self.assertRaises(ValueError):
                        moria.install(root, 'moria', {'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true'})
                    update.assert_not_called()
                self.assertEqual(before, path.read_bytes())

    def test_accepted_preflight_has_no_mutation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            moria.preflight(root, {'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true'})
            self.assertEqual(list(root.iterdir()), [])

    def test_native_password_joins_both_redaction_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            moria.configure(root, 'moria', {'SERVER_PASSWORD': 'native-secret'})
            original = moria.game.console.run
            def observe(*args):
                moria.game.console.run(credentials=('old-secret',))
                moria.game.tail_log(None, None, ('old-secret',))
                return 0
            with patch.object(moria.game.console, 'run') as run, patch.object(moria.game, 'tail_log') as tail:
                with patch.object(moria.game, 'launch', side_effect=observe):
                    self.assertEqual(moria.launch(root, {'ACCEPT_WINDOWS_RUNTIME_LICENSES': 'true'}), 0)
                self.assertEqual(run.call_args.kwargs['credentials'], ('old-secret', 'native-secret'))
                self.assertEqual(tail.call_args.args[2], ('old-secret', 'native-secret'))
            self.assertIs(moria.game.console.run, original)


if __name__ == '__main__':
    unittest.main()
