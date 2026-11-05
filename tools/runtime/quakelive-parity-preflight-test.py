import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

ROOT=Path(__file__).resolve().parents[2]
scripts=ROOT/'internal/panel/game_library/scripts'
def load(name, file):
    spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
load('steam_template',scripts/'steam-template.py');load('native_console',scripts/'native-console.py');load('quake_ss14_query',scripts/'quake-ss14-query.py');shared=load('quake_ss14_runtime',scripts/'quake-ss14-runtime.py')
candidate=load('quakelive_candidate',ROOT/'artifacts/game-parity-20261029/quakelive-runtime.pending.py')
class QuakeLivePreflight(unittest.TestCase):
    def test_automatic_update_uses_preservation_once_and_restores_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);before=dict(os.environ);acquire=Mock()
            def native(kind):
                self.assertEqual(kind,'quakelive');self.assertEqual(os.environ['VOLTRA_STEAM_AUTO_UPDATE'],'0');return 17
            self.assertEqual(candidate.main(root,self.env(AUTO_UPDATE='1'),native,acquire),17)
            acquire.assert_called_once_with(root,env=self.env(AUTO_UPDATE='1'));self.assertEqual(dict(os.environ),before)
    def test_automatic_acquisition_failure_does_not_launch_child(self):
        with tempfile.TemporaryDirectory() as directory:
            run=Mock();before=dict(os.environ)
            with self.assertRaisesRegex(RuntimeError,'failed validation'):
                candidate.main(Path(directory),self.env(AUTO_UPDATE='1'),run,Mock(side_effect=RuntimeError('failed validation')))
            run.assert_not_called();self.assertEqual(dict(os.environ),before)
    def env(self, **extra):return {'SERVER_PORT':'29102','VOLTRA_ALLOCATED_PORTS':'29102','AUTO_UPDATE':'0',**extra}
    def snapshot(self,root):return [(str(p.relative_to(root)),str(p.readlink()) if p.is_symlink() else p.read_bytes() if p.is_file() else None,p.lstat().st_mode) for p in sorted(root.rglob('*'))]
    def test_invalid_inputs_refuse_before_any_effect_or_update(self):
        for extra in [{'SERVER_NAME':'bad"name'},{'PASSWORD':'bad;value'},{'FPS':'80'},{'MAP':'../bad'},{'FACTORY':'ffa;quit'},{'MAX_PLAYERS':'0'},{'RCON_ENABLE':'1'},{'RCON_PORT':'-1'},{'VOLTRA_ALLOCATED_PORTS':'29103'},{'AUTO_UPDATE':'true'},{'SRCDS_BETAID':'bad branch'},{'SRCDS_APPID':'282440'}]:
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);run=Mock(return_value=0);before=self.snapshot(root)
                with self.assertRaises(ValueError):candidate.main(root,self.env(**extra),run)
                self.assertEqual(self.snapshot(root),before);run.assert_not_called()
    def test_valid_original_routing_and_literal_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);run=Mock(return_value=17)
            self.assertEqual(candidate.main(root,self.env(SERVER_NAME='Literal $name +value'),run),17)
            run.assert_called_once_with('quakelive');self.assertEqual(list(root.iterdir()),[])
    def test_existing_files_unchanged_on_bad_footer(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'baseq3').mkdir();(root/'baseq3/server.cfg').write_bytes(b'operator\r\n// BEGIN VOLTRA QUAKE MANAGED\r\n');before=self.snapshot(root);run=Mock()
            with self.assertRaises(ValueError):candidate.main(root,self.env(AUTO_UPDATE='1'),run)
            self.assertEqual(self.snapshot(root),before);run.assert_not_called()
    def test_invalid_file_kinds_refuse_before_side_effects(self):
        for path in ['baseq3/server.cfg','quake-live-user/baseq3/voltra-managed.cfg']:
            with self.subTest(path=path),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);(root/path).mkdir(parents=True);before=self.snapshot(root);run=Mock()
                with self.assertRaises(ValueError):candidate.main(root,self.env(),run)
                self.assertEqual(self.snapshot(root),before);run.assert_not_called()
    def test_rcon_distinct_allocation_and_valid_footer(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'baseq3').mkdir();(root/'baseq3/server.cfg').write_bytes(b'operator\r\n'+shared.QL_FOOTER);before=self.snapshot(root)
            plan=candidate.preflight(root,self.env(RCON_ENABLE='1',RCON_PASSWORD='owned-fixture',VOLTRA_ALLOCATED_PORTS='29102,29103'))
            self.assertEqual(plan['rcon'],29103);self.assertEqual(self.snapshot(root),before)
    @unittest.skipUnless(os.name=='posix','POSIX symlink guard')
    def test_symlinked_native_parent_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'owned';root.mkdir();outside=Path(directory)/'outside';outside.mkdir();(root/'baseq3').symlink_to(outside,target_is_directory=True);before=self.snapshot(root)
            with self.assertRaises(ValueError):candidate.preflight(root,self.env())
            self.assertEqual(self.snapshot(root),before);self.assertEqual(list(outside.iterdir()),[])
if __name__=='__main__':unittest.main()
