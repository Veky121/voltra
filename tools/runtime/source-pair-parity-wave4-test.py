"""Source-only regressions; publisher acquisition and child execution mocked."""
import importlib.util
import os
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


for name in ('steam-template', 'source-install', 'native-console', 'source-runtime', 'source-l4d', 'source-variant-runtime', 'source-next-runtime'):
    load(name.replace('-', '_'), BASE / (name + '.py'))
adapter = load('source_pair_wave4', BASE / 'source-pair-preflight.py')
variant = sys.modules['source_variant_runtime']
next_runtime = sys.modules['source_next_runtime']
base_runtime = sys.modules['source_runtime']
ENV = {'SRCDS_APPID': '346680', 'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000,28001,28002', 'AUTO_UPDATE': '1'}


class SourcePairPreflight(unittest.TestCase):
    def test_fixed_entrypoint_app_mismatch_refuses_before_runtime_import(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(Path, 'cwd', return_value=Path(folder)), patch.dict(os.environ, {'SRCDS_APPID':'293030'}, clear=True), patch.object(sys, 'argv', ['wrapper', '346680']):
                with self.assertRaisesRegex(ValueError, 'fixed Source recipe'):
                    runpy.run_path(str(BASE / 'source-pair-preflight.py'), run_name='__main__')
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_canonical_entrypoints_acquire_before_invalid_controls_refuse(self):
        for source, app, extra in [('source-variant-runtime.py', '346680', {'MAX_PLAYERS': '0'}), ('source-next-runtime.py', '293030', {'WINDOWS_INSTALL': 'invalid'})]:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                updater = Mock()
                with patch.object(sys.modules['source_install'], 'update', updater), patch.object(Path, 'cwd', return_value=root), patch.dict(os.environ, {**ENV, 'SRCDS_APPID': app, **extra}, clear=True):
                    with self.assertRaises(ValueError):
                        runpy.run_path(str(BASE / source), run_name='__main__')
                updater.assert_called_once()
                self.assertEqual(list(root.iterdir()), [])

    def test_refusal_preserves_all_bytes_and_never_acquires(self):
        cases = [{'SERVER_PORT': '28009'}, {'MAX_PLAYERS': '0'}, {'HOSTNAME': 'bad;quit'},
                 {'SRCDS_MAP': '../outside'}, {'PUBLIC_SERVER': 'true'}, {'TV_ENABLE': '2'},
                 {'STEAM_GSLT': 'bad;token'}, {'SRCDS_GAME': 'other'}, {'AUTO_UPDATE': 'yes'},
                 {'SRCDS_CPORT': '28001', 'SRCDS_STV': '28001'},
                 {'VOLTRA_ALLOCATED_PORTS': '28000,28001,28001'}]
        for invalid in cases:
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as folder:
                root = Path(folder);(root / 'operator.cfg').write_bytes(b'operator\r\n')
                runtime = types.SimpleNamespace(update=Mock(), launch=Mock(), run=Mock())
                with self.assertRaises((ValueError, KeyError)):
                    adapter.main(root, {**ENV, **invalid}, runtime)
                runtime.update.assert_not_called();runtime.launch.assert_not_called();runtime.run.assert_not_called()
                self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, {'operator.cfg': b'operator\r\n'})

    def test_explicit_tv_reserved_before_automatic_client_and_actual_configure(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'srcds_run').write_bytes(b'fixture')
            env={**ENV,'AUTO_UPDATE':'0','SRCDS_CPORT':'0','SRCDS_STV':'28001'}
            with self.assertRaises(ValueError):
                base_runtime.configure(root, env)
            effective,_,_=adapter.preflight(root, env)
            self.assertEqual(effective['SRCDS_CPORT'],'28002');self.assertEqual(effective['SRCDS_STV'],'28001')
            argv,_=variant.launch(root,effective)
            self.assertEqual(argv[argv.index('+clientport')+1],'28002')
            self.assertEqual(argv[argv.index('+tv_port')+1],'28001')

    def test_valid_update_restores_missing_payload_and_preserves_operator_cfg(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'bms/cfg').mkdir(parents=True)
            native=root/'bms/cfg/server.cfg';content=b'// operator\r\nsv_cheats 0\r\n';native.write_bytes(content)
            def update(*args,**kwargs): (root/'srcds_run').write_bytes(b'publisher fixture')
            with patch.object(variant,'update',side_effect=update) as updater,patch.object(variant,'run',return_value=17) as runner:
                self.assertEqual(adapter.main(root,{**ENV,'SERVER_PASSWORD':'fixture-password'},variant),17)
            updater.assert_called_once_with(root,346680,validate=False,required=('srcds_run',))
            self.assertEqual(native.read_bytes(),content)
            self.assertNotIn('fixture-password',' '.join(runner.call_args.args[1]))
            self.assertIn('fixture-password',runner.call_args.args[4])

    def test_contagion_invalid_platform_config_and_wine_refuse_before_update(self):
        cases=[{'WINDOWS_INSTALL':'invalid'},{'SRV_CONFIG':'../outside.cfg'},{'SRV_CONFIG':'voltra-managed.cfg'},
               {'SRV_MAXPLAYERS':'33'},{'SRV_MAP':'bad;quit'},{'WINEARCH':'bad'},
               {'WINETRICKS_RUN':'corefonts corefonts'},{'WINEDEBUG':'-all;quit'}]
        for invalid in cases:
            with self.subTest(invalid=invalid),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);runtime=types.SimpleNamespace(update=Mock(),launch=Mock())
                with patch.object(adapter.shutil,'which',return_value='/usr/bin/wine'),self.assertRaises(ValueError):
                    adapter.main(root,{**ENV,'SRCDS_APPID':'293030','WINDOWS_INSTALL':'1',**invalid},runtime)
                runtime.update.assert_not_called();runtime.launch.assert_not_called();self.assertEqual(list(root.iterdir()),[])

    def test_contagion_native_path_keeps_shared_launch_and_readiness(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'contagion_dedicated').write_bytes(b'fixture')
            with patch.object(next_runtime,'update') as updater,patch.object(next_runtime,'run_ready',return_value=23) as runner:
                result=adapter.main(root,{**ENV,'SRCDS_APPID':'293030','AUTO_UPDATE':'0','WINDOWS_INSTALL':'0','SRV_CONFIG':'operator/custom.cfg'},next_runtime)
            self.assertEqual(result,23);updater.assert_not_called()
            self.assertEqual(runner.call_args.args[1][0],str(root/'contagion_dedicated'))
            self.assertEqual((root/'contagion/cfg/voltra-server.cfg').read_text(),'exec "operator/custom.cfg"\nexec voltra-managed.cfg\necho VOLTRA_CONTAGION_CONFIG_APPLIED\n')

    def test_path_type_and_invalid_utf8_refuse_before_acquisition(self):
        for name, data in [('bms',b'not a directory'),('bms/cfg/voltra-managed.cfg',b'\xff')]:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
                runtime=types.SimpleNamespace(update=Mock(),launch=Mock())
                with self.assertRaises(ValueError):adapter.main(root,ENV,runtime)
                runtime.update.assert_not_called();runtime.launch.assert_not_called();self.assertEqual(target.read_bytes(),data)

    def test_failed_payload_repair_never_configures_or_starts(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime=types.SimpleNamespace(update=Mock(),launch=Mock(),run=Mock())
            with self.assertRaises(ValueError):adapter.main(Path(folder),ENV,runtime)
            runtime.update.assert_called_once();runtime.launch.assert_not_called();runtime.run.assert_not_called()


if __name__ == '__main__':unittest.main()
