"""Front later-source staging; never executes installer shell or native code."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'

class Front(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); stage = self.root / '.voltra'; stage.mkdir()
        egg = json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())['thefront/egg-the-front.json']['egg']
        self.assertTrue(egg['startup'].endswith('.voltra/unreal_survival_runtime.py front'))
        for name, content in re.findall(r"cat > .voltra/([\w.]+) <<'VOLTRA_UNREAL_SOURCE'\n(.*?)\nVOLTRA_UNREAL_SOURCE", egg['scripts']['installation']['script'], re.S):
            # Root refresh is deliberately staged, never applied to canonical JSON.
            source = BASE / name.replace('_', '-')
            (stage/name).write_text(source.read_text() if name in ('unreal_survival_install.py','unreal_survival_runtime.py') else content)
        self.addCleanup(setattr, sys, 'path', sys.path[:]); sys.path.insert(0,str(stage))
        for name in ('steam_template','native_config','native_console','enshrouded_proton','unreal_survival_install','unreal_survival_runtime'):
            sys.modules.pop(name,None)
        import unreal_survival_install as installer
        import unreal_survival_runtime as runtime
        self.i=installer; self.r=runtime
        self.env={'SERVER_PORT':'28000','BEACON_PORT':'28001','QUERY_PORT':'28002','SHUTDOWN_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003','AUTO_UPDATE':'1'}
        self.binary=self.root/'ProjectWar/Binaries/Linux/TheFrontServer';self.binary.parent.mkdir(parents=True);self.binary.write_bytes(b'mocked binary')
        self.saved=self.root/'TheFrontManager/new/operator.ini';self.saved.parent.mkdir(parents=True);self.saved.write_bytes(b';comment\nUnknown[]=secret\n')
        self.addCleanup(patch.stopall)
        patch('steam_template.bootstrap',side_effect=AssertionError('bootstrap forbidden')).start()
        patch('subprocess.Popen',side_effect=AssertionError('process forbidden')).start()
        patch('urllib.request.urlopen',side_effect=AssertionError('network forbidden')).start()
    def snapshot(self):
        return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
    def main(self, env):
        with patch.dict(os.environ,env,clear=True),patch.object(sys,'argv',['.voltra/unreal_survival_runtime.py','front']),patch.object(Path,'cwd',return_value=self.root):return self.r.main()
    def test_invalid_inputs_refuse_before_spool_update_or_launch(self):
        for invalid in ({'SRV_NAME':'bad\n'}, {'CFG_NAME':'../escape'},{'QUERY_PORT':'28000'},{'INSTALL_FLAGS':'+quit'},{'SRCDS_BETAID':'bad branch'},{'STEAM_PASS':'private'},{'SERVER_IP':'bad'},{'WINDOWS_INSTALL':'true'}):
            env={**self.env,**invalid}; before=self.snapshot()
            with patch.object(self.i.tempfile,'TemporaryDirectory',side_effect=AssertionError('spool forbidden')),patch.object(self.i,'update',side_effect=AssertionError('update forbidden')),patch.object(self.r,'run',side_effect=AssertionError('launch forbidden')):
                with self.assertRaises(ValueError):self.i.install(self.root,'front',env)
                with self.assertRaises(ValueError):self.main(env)
            self.assertEqual(before,self.snapshot())
    def test_successful_entrypoint_repeated_boots_operator_edits(self):
        def update(root,app,**kw):self.saved.write_bytes(b'publisher overwrite');return {'mock':True}
        with patch.object(self.i,'update',side_effect=update) as updater,patch.object(self.r,'run',return_value=0) as launch:
            for value in (b';first\nUnknown[]=secret',b';operator edit\nUnknown[]=next'):
                self.saved.write_bytes(value);self.assertEqual(self.main(self.env),0);self.assertEqual(self.saved.read_bytes(),value)
            self.assertEqual(updater.call_count,4);self.assertEqual(launch.call_count,2)
            self.assertEqual(launch.call_args.args[1][-1],'-ServerPassword=""')
    def test_failed_update_restores_operator_bytes_and_does_not_launch(self):
        before=self.saved.read_bytes()
        def update(*a,**k):self.saved.write_bytes(b'overwrite');raise ValueError('mock update failed')
        with patch.object(self.i,'update',side_effect=update),patch.object(self.r,'run') as launch:
            with self.assertRaisesRegex(ValueError,'mock update failed'):self.main(self.env)
            launch.assert_not_called()
        self.assertEqual(before,self.saved.read_bytes())
    def test_symlink_retention_refuses_before_acquisition(self):
        link=self.root/'TheFrontManager/link';link.symlink_to(self.binary)
        with patch.object(self.i,'update',side_effect=AssertionError('update forbidden')),patch.object(self.i.tempfile,'TemporaryDirectory',side_effect=AssertionError('spool forbidden')):
            with self.assertRaises(ValueError):self.i.install(self.root,'front',self.env)

if __name__=='__main__':unittest.main()
