"""No native process, network, acquisition or real wipe. Temporary fixtures only."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[2]
steam = types.ModuleType('steam_template')
steam.update = Mock(side_effect=AssertionError('unmocked acquisition'))
sys.modules['steam_template'] = steam
spec = importlib.util.spec_from_file_location('installer', ROOT/'internal/panel/game_library/scripts/rust-install.py')
installer = importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
spec = importlib.util.spec_from_file_location('stager', ROOT/'tools/runtime/rust-autowipe-wave45-stage.py')
stager = importlib.util.module_from_spec(spec);spec.loader.exec_module(stager)

class Autowipe(unittest.TestCase):
    def test_raw_controls_refuse_before_mount_probe_acquisition_or_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for control in ['\t','\n','\r','\x00','\x1f','\x7f']:
                with self.subTest(control=repr(control)), patch.object(installer,'mount_points',side_effect=AssertionError('mount probe')), patch.object(installer,'update') as acquire:
                    with self.assertRaisesRegex(ValueError,'control'):
                        installer.install(root, {'REGEN_SERVER':'1','REMOVE_FILES':'world'+control+'plugins'})
                    acquire.assert_not_called();self.assertEqual(list(root.iterdir()),[])

    def test_optout_ignores_patterns_without_touching_worlds(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(installer,'mount_points',side_effect=AssertionError('mount probe')):
            self.assertEqual(installer.validate_wipe(Path(directory),{'REGEN_SERVER':'0','REMOVE_FILES':'world\nplugins'}),[])

    def test_positive_space_patterns_validate_with_mocked_filesystem(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            seen=[]
            def matches(root,parts,mounts): seen.append(parts);return []
            with patch.object(installer,'mount_points',return_value=set()), patch.object(installer,'wipe_matches',side_effect=matches), patch.object(installer,'volume_directory_fd',side_effect=FileNotFoundError):
                self.assertEqual(installer.validate_wipe(root,{'REGEN_SERVER':'1','REMOVE_FILES':'server/rust   oxide/data/test','WORLD_SEED':'42'}),[])
            self.assertEqual(seen,[('server','rust'),('oxide','data','test')])

    def test_install_success_and_acquisition_failure_preserve_operator_bytes(self):
        for failure in [False,True]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); data=b'// unknown\r\nsecret "fixture"\r\narray [1,2]\r\n'
                for name in ['server.cfg','world.sav','plugin.json']:(root/name).write_bytes(data)
                calls=[]
                def acquire(*args,**kwargs):
                    calls.append('acquire')
                    if failure:raise RuntimeError('mock acquisition failed')
                with patch.object(installer,'validate_wipe',side_effect=lambda *a:calls.append('validate') or []), patch.object(installer,'update',side_effect=acquire), patch.object(installer,'wipe_files',side_effect=lambda *a:calls.append('wipe') or []), patch.object(installer.os,'chown',create=True):
                    if failure:
                        with self.assertRaisesRegex(RuntimeError,'mock acquisition'):installer.install(root,{'REGEN_SERVER':'1'})
                        self.assertEqual(calls,['validate','acquire'])
                    else:
                        self.assertEqual(installer.install(root,{'REGEN_SERVER':'1'}),{'framework':'vanilla','wiped_files':[]})
                        self.assertEqual(calls,['validate','acquire','wipe'])
                for name in ['server.cfg','world.sav','plugin.json']:self.assertEqual((root/name).read_bytes(),data)

    def test_exact_profile_and_other_callers_unchanged(self):
        catalog=ROOT/'internal/panel/game_library/overrides.json';before=catalog.read_bytes()
        canonical,profile=stager.stage()
        old=canonical[stager.RECIPE]
        import copy,re
        expected=copy.deepcopy(old)
        script=profile['egg']['scripts']['installation']['script']
        emitted=re.findall(r"cat > .voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE\n",script,re.S)
        modules=dict(emitted)
        self.assertIn('rust_runtime.py',modules);self.assertIn('steam_template.py',modules)
        self.assertEqual(modules['rust_install.py'],(ROOT/'internal/panel/game_library/scripts/rust-install.py').read_text())
        expected['egg']['scripts']['installation']['script']=script
        self.assertEqual(profile,expected)
        self.assertEqual(catalog.read_bytes(),before)
        self.assertEqual(list(json.loads((stager.OUT/'profiles.json').read_text())),[stager.RECIPE])

if __name__=='__main__':unittest.main(verbosity=2)

