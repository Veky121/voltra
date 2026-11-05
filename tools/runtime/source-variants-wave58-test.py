import importlib.util
import os
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
sys.dont_write_bytecode = True
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'internal/panel/game_library/scripts'
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path); module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
for name in ('steam-template','source-install','native-console','source-runtime','source-variant-runtime','source-pair-preflight'):
    load(name.replace('-','_'),BASE/(name+'.py'))
adapter=load('source_variants_wave58',ROOT/'tools/runtime/source-variants-wave58.py')
variant=sys.modules['source_variant_runtime']
class Variants(unittest.TestCase):
    def test_both_recipes(self):
        for app,game in [('295230','fof'),('317670','nmrih')]:
            env=dict(SRCDS_APPID=app,SERVER_PORT='28000',VOLTRA_ALLOCATED_PORTS='28000,28001,28002',AUTO_UPDATE='1')
            cases=[{'MAX_PLAYERS':'0'},{'MAX_PLAYERS':'33'},{'HOSTNAME':'bad;quit'},{'SRCDS_MAP':'../escape'},{'SERVER_PORT':'29000'},{'TV_ENABLE':'2'},{'SRCDS_GAME':'other'},{'SRCDS_BETAID':'bad branch'},{'SRCDS_BETAPASS':'secret'},{'STEAM_GSLT':'bad-token'},{'AUTO_UPDATE':'yes'},{'VOLTRA_ALLOCATED_PORTS':'28000,28001,28001'},{'SRCDS_CPORT':'28001','SRCDS_STV':'28001'}]
            for invalid in cases:
                for install in (True,False):
                    with self.subTest(app=app,invalid=invalid,install=install),tempfile.TemporaryDirectory() as directory:
                        root=Path(directory); (root/'operator.cfg').write_bytes(b'operator\xff\r\n'); runtime=types.SimpleNamespace(update=Mock(),launch=Mock(),run=Mock())
                        with self.assertRaises((ValueError,KeyError)):adapter.main(root,{**env,**invalid},runtime,install)
                        runtime.update.assert_not_called();runtime.launch.assert_not_called();runtime.run.assert_not_called()
                        self.assertEqual([(p.name,p.read_bytes()) for p in root.iterdir()],[('operator.cfg',b'operator\xff\r\n')])
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);cfg=root/game/'cfg/server.cfg';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'// operator\xff\r\n');before=cfg.read_bytes()
                def acquire(*args,**kwargs):(root/'srcds_run').write_bytes(b'mocked publisher, never executable')
                with patch.object(variant,'update',side_effect=acquire) as update,patch.object(variant,'run',return_value=-9) as run:
                    self.assertEqual(adapter.main(root,{**env,'SRCDS_STV':'28001'},variant),-9)
                    self.assertEqual(update.call_args.kwargs['env']['SRCDS_CPORT'],'28002')
                    self.assertEqual(run.call_args.args[3],'quit');self.assertTrue(run.call_args.kwargs['terminal_input'])
                self.assertEqual(cfg.read_bytes(),before)
                self.assertEqual((root/game/'cfg/voltra-server.cfg').read_text(),'exec server.cfg\nexec voltra-managed.cfg\n')
                managed=root/game/'cfg/voltra-managed.cfg';managed.write_text('hostname "operator managed"\n')
                with patch.object(variant,'update') as update,patch.object(variant,'run',return_value=0):adapter.main(root,{**env,'AUTO_UPDATE':'0'},variant)
                self.assertIn('hostname "Source dedicated server"',managed.read_text()) # always-applied, not seed-only
                with patch.object(variant,'update',side_effect=RuntimeError('publisher refused')),patch.object(variant,'launch') as launch:
                    with self.assertRaises(RuntimeError):adapter.main(root,env,variant)
                    launch.assert_not_called()
    def test_missing_payload_and_bad_paths(self):
        for relative in ('fof/cfg/voltra-managed.cfg','fof/cfg/voltra-login.cfg'):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);target=root/relative;target.parent.mkdir(parents=True);target.write_bytes(b'\xff');runtime=types.SimpleNamespace(update=Mock())
                with self.assertRaises(ValueError):adapter.main(root,dict(SRCDS_APPID='295230',SERVER_PORT='28000',VOLTRA_ALLOCATED_PORTS='28000,28001,28002'),runtime)
                runtime.update.assert_not_called();self.assertEqual(target.read_bytes(),b'\xff')
    def test_entrypoint_fixed_identity(self):
        with patch.object(sys,'argv',['wrapper','295230']),patch.dict(os.environ,{'SRCDS_APPID':'317670'},clear=True):
            with self.assertRaisesRegex(ValueError,'fixed Source recipe'):runpy.run_path(str(ROOT/'tools/runtime/source-variants-wave58.py'),run_name='__main__')
if __name__=='__main__':unittest.main()
