"""GroundBranch source-only regressions. All acquisition/process/publication boundaries mocked."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
for name in ['steam-template','native-config','native-console','source-install','source-next-install','tactical-install','tactical-runtime','tactical-next-install','tactical-next-runtime']:
    key=name.replace('-','_');spec=importlib.util.spec_from_file_location(key,BASE/(name+'.py'));module=importlib.util.module_from_spec(spec);sys.modules[key]=module;spec.loader.exec_module(module)
r=sys.modules['tactical_next_runtime'];i=sys.modules['tactical_next_install']
def publish(root,name,writer,mode):
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('wb') as out:writer(out)
    p.chmod(mode)
class Tests(unittest.TestCase):
    def env(self,root):return dict(VOLTRA_TACTICAL_NEXT='groundbranch',SERVER_PORT='28000',QUERY_PORT='28001',VOLTRA_ALLOCATED_PORTS='28000,28001',WINEPATH=str(root),AUTO_UPDATE='1')
    def test_invalid_controls_refuse_before_acquisition_and_mutation(self):
        for extra in [{'QUERY_PORT':'28000'},{'MAX_PLAYERS':'0'},{'SERVER_NAME':'bad\nname'},{'WINEARCH':'win32'},{'WINEPATH':'outside'}]:
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as d:
                root=Path(d);env=self.env(root);env.update(extra)
                with mock.patch.object(r,'install') as acquire,mock.patch.object(r,'configure') as configure,mock.patch.object(r.shutil,'which',return_value='wine'),mock.patch.dict(os.environ,{'DISPLAY':':fixture'}):
                    with self.assertRaises(ValueError):r.main(root,env)
                    acquire.assert_not_called();configure.assert_not_called();self.assertEqual(list(root.iterdir()),[])
    def test_existing_native_bytes_are_authority(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);env=self.env(root)
            paths=['GroundBranch/ServerConfig/Server.ini','GroundBranch/Config/DefaultModding.ini']
            for name in paths:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'\xffoperator\r\nRepeated=x\r\nRepeated=y\r\nsecret=private')
            before={name:(root/name).read_bytes() for name in paths}
            with mock.patch.object(r,'native_binary',return_value=root/'fixture.exe'),mock.patch.object(r.shutil,'which',return_value='wine'),mock.patch.dict(os.environ,{'DISPLAY':':fixture'}),mock.patch.object(r,'default_ground_maplist'),mock.patch.object(r,'_publish') as write,mock.patch.object(r,'flat_config') as flat:
                argv,*_=r.configure(root,env);write.assert_not_called();flat.assert_not_called();self.assertIn('QueryPort=28001',argv)
            self.assertEqual(before,{name:(root/name).read_bytes() for name in paths})
    def test_checkout_template_loaded_before_acquisition(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(i,'arguments'),mock.patch.object(i,'update',return_value={'buildid':'fixture'}) as acquire,mock.patch.object(i,'native_binary'),mock.patch.object(i,'default_server') as seed:
                self.assertEqual(i.install(Path(d),self.env(Path(d)))['buildid'],'fixture')
                self.assertIn(b'ServerName= Unnamed Ground Branch Server',seed.call_args.args[1]);self.assertIn(b'MaxPlayers= 16',seed.call_args.args[1]);acquire.assert_called_once()
    def test_success_and_failed_update_restore_unknown_config_bytes(self):
        for fail in [False,True]:
            with self.subTest(fail=fail),tempfile.TemporaryDirectory() as d:
                root=Path(d);p=root/'GroundBranch/ServerConfig/Server.ini';p.parent.mkdir(parents=True);original=b'\xffprivate\r\nunknown=1\r\n';p.write_bytes(original)
                def update(*a,**kw):
                    p.write_bytes(b'publisher')
                    if fail:raise RuntimeError('mock publisher failure')
                    return {'buildid':'fixture'}
                with mock.patch.object(i,'arguments'),mock.patch.object(i,'update',side_effect=update),mock.patch.object(i,'native_binary'),mock.patch.object(i,'_publish',side_effect=publish),mock.patch.object(i.os,'geteuid',return_value=1,create=True):
                    if fail:
                        with self.assertRaisesRegex(RuntimeError,'mock publisher failure'):i.install(root,self.env(root))
                    else:i.install(root,self.env(root))
                self.assertEqual(p.read_bytes(),original);self.assertFalse(list(root.glob('.tactical-next-retention-*')))
    def test_emitted_template_filename_matches_canonical(self):
        import json
        profile=json.loads((BASE.parent/'overrides.json').read_text())['ground_branch/egg-ground-branch.json']
        self.assertIn('groundbranch_original_Server.ini',profile['egg']['scripts']['installation']['script'])
if __name__=='__main__':unittest.main(verbosity=2)
