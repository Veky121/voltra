import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import types

REPO=Path(__file__).resolve().parents[2]
SCRIPTS=REPO/'internal/panel/game_library/scripts'

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path); module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module

for name in ('steam_template','source_install','native_console','source_runtime'):
    load(name,SCRIPTS/(name.replace('_','-')+'.py' if name!='steam_template' else 'steam-template.py'))
adapter=load('iosoccer_runtime',SCRIPTS/'iosoccer-runtime.py')
stage=load('stage_iosoccer',REPO/'tools/runtime/stage-iosoccer.py')

class IOSoccerTests(unittest.TestCase):
    def env(self):return dict(SRCDS_APPID='673990',SERVER_PORT='27015',VOLTRA_ALLOCATED_PORTS='27015,27016,27017',AUTO_UPDATE='0')
    def test_refusal_before_update_or_writes(self):
        for change in ({'MAP':'../x'},{'RCON':'x;quit'},{'SLOTS':'0'},{'SERVER_PORT':'1'},{'AUTO_UPDATE':'2'}):
            with tempfile.TemporaryDirectory() as d, mock.patch.object(adapter,'update') as update:
                with self.assertRaises(ValueError):adapter.prepare(Path(d),self.env()|change,True)
                update.assert_not_called();self.assertEqual(list(Path(d).iterdir()),[])
    def test_seed_once_native_edits_and_cli(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'srcds_run_64').touch();cfg=root/'iosoccer/cfg/server.cfg';cfg.parent.mkdir(parents=True);old=b'// unknown\xff\r\nhostname "operator"\r\nrcon_password "secret"\r\nmp_timelimit_warmup 0.5\r\n';cfg.write_bytes(old)
            argv,_=adapter.prepare(root,self.env());self.assertTrue(cfg.read_bytes().startswith(old));self.assertNotIn('+fps_max',argv);self.assertEqual(argv[-2:],['+map','8v8_vienna']);self.assertLess(argv.index('+servercfgfile'),argv.index('+map'))
            cfg.write_bytes(old);adapter.prepare(root,self.env()|{'HOSTNAME':'changed','RCON':'changed'});self.assertEqual(cfg.read_bytes(),old)
    @unittest.skipUnless(hasattr(__import__('os'),'fchown'),'POSIX ownership restoration requires WSL')
    def test_mocked_update_retains_native_success_and_failure(self):
        installer=sys.modules['source_install']
        for fail in (False,True):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d);cfg=root/'iosoccer/cfg/server.cfg';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'operator\xff\r\n');cfg.chmod(0o640)
                def acquire(*args,**kwargs):
                    cfg.write_bytes(b'publisher')
                    if fail:raise RuntimeError('mock failed update')
                    return {'buildid':1}
                with mock.patch.object(installer,'steam_update',side_effect=acquire):
                    if fail:
                        with self.assertRaises(RuntimeError):installer.update(root,673990,env={})
                    else:self.assertEqual(installer.update(root,673990,env={})['buildid'],1)
                self.assertEqual(cfg.read_bytes(),b'operator\xff\r\n');self.assertEqual(cfg.stat().st_mode&0o777,0o640)
    def test_emitted_filename_and_imports(self):
        f=stage.fragment(REPO); chunk=f['installer_append'];name=chunk.split('cat > ')[1].split(' <<')[0];body=chunk.split("VOLTRA_IOSOCCER'\n",1)[1].rsplit('\nVOLTRA_IOSOCCER',1)[0]
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/name;p.parent.mkdir();p.write_text(body);m=load('emitted_iosoccer',p);self.assertTrue(callable(m.preflight));self.assertIn(name,f['startup'])

if __name__=='__main__':unittest.main()
