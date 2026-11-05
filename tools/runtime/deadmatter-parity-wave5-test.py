import importlib.util
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
canonical = ROOT / 'internal/panel/game_library/scripts/deadmatter-preflight.py'
source = canonical
spec = importlib.util.spec_from_file_location('deadmatter_wave5', source)
wrapper = importlib.util.module_from_spec(spec); spec.loader.exec_module(wrapper)
shared = wrapper.load_shared()
ENV = {'SERVER_PORT':'28000','QUERY_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28000,28001',
       'SERVER_NAME':'Literal $ name','WINDOWS_INSTALL':'1','SRCDS_APPID':'2584780','AUTO_UPDATE':'1'}


class DeadMatterPreflight(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(); self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.binary = self.root / shared.GAMES['dead-matter'][2]
        self.binary.parent.mkdir(parents=True); self.binary.write_bytes(b'MZ payload fixture')
        self.proton = self.root / '.voltra/proton' / shared.helper('enshrouded-proton').VERSION / 'proton'
        self.proton.parent.mkdir(parents=True); self.proton.write_bytes(b'proton fixture')
        self.operator = self.root / 'DeadMatter/Saved/SaveGames/operator.sav'
        self.operator.parent.mkdir(parents=True); self.operator.write_bytes(b'untouched operator world')

    def invoke(self, env=None):
        with patch.object(wrapper.Path, 'cwd', return_value=self.root), patch.dict(os.environ, env or ENV, clear=True):
            return wrapper.main(shared)

    def files(self):
        return {file.relative_to(self.root).as_posix():file.read_bytes() for file in self.root.rglob('*') if file.is_file()}

    def test_current_shared_baseline_acquires_before_invalid_name_refusal(self):
        with patch.object(shared, 'install') as install:
            with self.assertRaises(ValueError):
                shared.run(self.root, 'dead-matter', {**ENV, 'VOLTRA_STEAM_AUTO_UPDATE':'1', 'SERVER_NAME':'bad\nname'})
        install.assert_called_once()

    def test_invalid_controls_refuse_before_acquisition_and_preserve_all_bytes(self):
        cases = [{'SERVER_NAME':'bad\nname'},{'QUERY_PORT':'28000'},{'SERVER_PORT':'9999'},
                 {'VOLTRA_ALLOCATED_PORTS':'28000,28001,99999'}, {'WINDOWS_INSTALL':'0'},
                 {'SRCDS_APPID':'1'}, {'AUTO_UPDATE':'yes'}, {'VALIDATE':'unknown'},
                 {'STEAM_USER':'private-account','STEAM_PASS':'fixture-secret'}]
        for change in cases:
            before = self.files()
            with self.subTest(change=change), patch.object(shared, 'install') as install, patch.object(shared, 'run') as run:
                with self.assertRaises(ValueError): self.invoke({**ENV, **change})
            install.assert_not_called(); run.assert_not_called(); self.assertEqual(self.files(), before)

    def test_original_auto_update_repairs_missing_payload_then_revalidates(self):
        self.binary.unlink(); self.proton.unlink()
        def repair(*args, **kwargs):
            self.binary.write_bytes(b'MZ repaired fixture'); self.proton.write_bytes(b'repaired proton fixture')
        with patch.object(shared, 'install', side_effect=repair) as install, patch.object(shared, 'run', return_value=17) as run:
            self.assertEqual(self.invoke(), 17)
        install.assert_called_once_with(self.root, 'dead-matter', ENV, validate=False)
        self.assertEqual(run.call_args.args[:2], (self.root, 'dead-matter'))
        self.assertEqual(run.call_args.args[2]['VOLTRA_STEAM_AUTO_UPDATE'], '0')
        self.assertEqual(self.operator.read_bytes(), b'untouched operator world')

    def test_failed_repair_never_enters_shared_runtime(self):
        self.binary.unlink()
        with patch.object(shared, 'install') as install, patch.object(shared, 'run') as run:
            with self.assertRaises(ValueError): self.invoke()
        install.assert_called_once(); run.assert_not_called(); self.assertFalse(self.binary.exists())

    def test_explicit_voltra_override_keeps_manual_start_and_actual_shared_argv(self):
        with patch.object(shared, 'install') as install, patch.object(shared, 'run', return_value=0) as run:
            self.assertEqual(self.invoke({**ENV, 'VOLTRA_STEAM_AUTO_UPDATE':'0'}), 0)
        install.assert_not_called()
        argv, credentials, log = shared.configure(self.root, 'dead-matter', run.call_args.args[2])
        self.assertEqual(argv, [str(self.proton), 'run', str(self.binary), '-SteamServerName=Literal $ name', '-port=28000', '-queryport=28001'])
        self.assertEqual(log, 'DeadMatter/Saved/Logs/DeadMatter.log')
        self.assertEqual(self.operator.read_bytes(), b'untouched operator world')

    def test_bad_compatibility_or_log_parent_refuses_before_update(self):
        for relative in ('.steam/steam', 'DeadMatter/Saved/Logs'):
            target = self.root / relative; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'operator file')
            with self.subTest(relative=relative), patch.object(shared, 'install') as install, patch.object(shared, 'run') as run:
                with self.assertRaises(ValueError): self.invoke()
            install.assert_not_called(); run.assert_not_called(); self.assertEqual(target.read_bytes(), b'operator file')
            target.unlink()


if __name__ == '__main__': unittest.main()
