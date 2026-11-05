import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cs2d_wave5', Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/cs2d-preflight.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)
shared = wrapper.load_shared()
BASE = {'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000', 'AUTO_UPDATE': '0'}


class CS2DPreflight(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.map = self.root / 'cs2d/maps/de_dust2.map'
        self.map.parent.mkdir(parents=True)
        self.map.write_bytes(b'fixture-map')
        self.binary = self.root / 'cs2d/cs2d_dedicated'
        self.binary.write_bytes(b'fixture-binary')
        self.config = self.root / 'cs2d/sys/server.cfg'
        self.config.parent.mkdir()
        self.config.write_bytes(b'// operator\r\nmp_roundtime 7\r\n')

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_original_creates_credential_before_quote_refusal(self):
        with self.assertRaises(ValueError):
            shared.configure_cs2d(self.root, {**BASE, 'SERVER_NAME': 'bad"quote'})
        self.assertTrue((self.root / '.voltra/cs2d/rcon-password').is_file())

    def test_invalid_inputs_leave_original_bytes_and_paths_unchanged(self):
        cases = [{'SERVER_NAME': 'bad"quote'}, {'SERVER_PASSWORD': 'bad\nvalue'}, {'SERVER_PLAYERS': '33'},
                 {'GAME_MODE': '6'}, {'BOT_COUNT': '33'}, {'RCON_PASSWORD': 'bad"quote'},
                 {'SERVER_PORT': '28001'}, {'VOLTRA_ALLOCATED_PORTS': '28000,70000'},
                 {'VOLTRA_ALLOCATED_PORTS': '28000,28000'}, {'PUBLIC_SERVER': 'true'},
                 {'SERVER_MAP': '../escape'}, {'AUTO_UPDATE': '1'}]
        before = self.snapshot()
        for invalid in cases:
            with self.subTest(invalid=invalid), patch.object(shared, 'configure_cs2d') as configure, patch.object(shared, 'run_native') as run:
                with self.assertRaises(ValueError):
                    wrapper.main(self.root, {**BASE, **invalid}, shared)
                configure.assert_not_called()
                run.assert_not_called()
                self.assertEqual(self.snapshot(), before)

    def test_duplicate_and_case_alias_commands_refuse_before_new_credential(self):
        for data in (b'sv_name one\nsv_name two\n', b'SV_NAME alias\n'):
            self.config.write_bytes(data)
            with self.assertRaises(ValueError):
                wrapper.preflight(self.root, BASE, shared)
            self.assertFalse((self.root / '.voltra').exists())
            self.assertEqual(self.config.read_bytes(), data)

    def test_missing_binary_refuses_before_any_write(self):
        self.binary.unlink()
        before = self.snapshot()
        with self.assertRaises(ValueError):
            wrapper.main(self.root, BASE, shared)
        self.assertEqual(self.snapshot(), before)

    def test_invalid_managed_targets_refuse_before_shared_configure(self):
        for name in ('console-command', 'console-command.tmp', 'previous-server.cfg', 'rcon-password'):
            target = self.root / '.voltra/cs2d' / name
            target.mkdir(parents=True)
            before = self.snapshot()
            with self.assertRaises(ValueError):
                wrapper.main(self.root, BASE, shared)
            self.assertEqual(self.snapshot(), before)
            target.rmdir()

    def test_operator_modified_console_adapter_is_not_overwritten(self):
        adapter = self.root / 'cs2d/sys/lua/autorun/voltra-console.lua'
        adapter.parent.mkdir(parents=True)
        adapter.write_bytes(b'-- operator owned\n')
        before = self.snapshot()
        with self.assertRaises(ValueError):
            wrapper.main(self.root, BASE, shared)
        self.assertEqual(self.snapshot(), before)

    def test_invalid_persistent_credential_is_not_replaced_or_published(self):
        credential = self.root / '.voltra/cs2d/rcon-password'
        credential.parent.mkdir(parents=True)
        for value in (b'', b'bad"quote', b'bad\x00control'):
            credential.write_bytes(value)
            before = self.snapshot()
            with self.assertRaises(ValueError):
                wrapper.main(self.root, BASE, shared)
            self.assertEqual(self.snapshot(), before)

    def test_actual_configure_preserves_unknown_commands_and_persistent_credential(self):
        with patch.object(shared, 'run_native', return_value=19) as run:
            self.assertEqual(wrapper.main(self.root, BASE, shared), 19)
        credential = self.root / '.voltra/cs2d/rcon-password'
        saved = credential.read_bytes()
        self.assertIn(saved.decode(), run.call_args.args[2])
        self.assertEqual(run.call_args.args[3], self.root / '.voltra/cs2d/console-command')
        self.assertIn('mp_roundtime 7', self.config.read_text())
        with patch.object(shared, 'run_native', return_value=0):
            wrapper.main(self.root, BASE, shared)
        self.assertEqual(credential.read_bytes(), saved)


if __name__ == '__main__':
    unittest.main()
