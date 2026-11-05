"""Source fixtures; all external boundaries mocked or denied."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
S=ROOT/'internal/panel/game_library/scripts'
def load(path):
    spec=importlib.util.spec_from_file_location(path.stem,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
class Repair(unittest.TestCase):
    def test_seed_and_port(self):
        m=load(S/'small-native-runtime.py')
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ):
            r=Path(d);p=r/'ServerData/save/save.park';p.parent.mkdir(parents=True);p.write_bytes(b'park')
            c=r/'ServerData/config.ini';c.write_text('; keep\n[network]\nserver_name = "operator"\ndefault_password = "secret"\ndefault_port = 1\n')
            with patch.object(m.urllib.request,'urlopen',side_effect=AssertionError('network')):
                m.configure_openrct2(r,{'SERVER_PORT':'12345'})
                first=c.read_bytes();m.configure_openrct2(r,{'SERVER_PORT':'12345'})
            self.assertEqual(first,c.read_bytes());self.assertIn(b'"operator"',first);self.assertIn(b'"secret"',first);self.assertIn(b'12345',first)
    def test_refusal_before_writes_or_acquisition(self):
        m=load(S/'small-native-runtime.py');installer=load(S/'small-native-install.py')
        for env in ({'LOAD_AUTOSAVE':'bad'},{'SAVE_URI':'../escape.park'},{'SAVE_URI':'absent.park'},{'SAVE_URI':'https://example.com/a.park','LD_LIBRARY_PATH':'../bad'},{'SERVER_NAME':'bad\nvalue'}):
            with self.subTest(env=env),tempfile.TemporaryDirectory() as d,patch.dict(os.environ,env,clear=True):
                r=Path(d)
                with patch.object(m.urllib.request,'urlopen',side_effect=AssertionError('network')),patch.object(installer.release,'download',side_effect=AssertionError('download')),patch.object(installer.subprocess,'run',side_effect=AssertionError('process')):
                    with self.assertRaises(ValueError):m.configure_openrct2(r,env)
                    with self.assertRaises(ValueError):installer.install(r,'openrct2')
                self.assertEqual(list(r.iterdir()),[])
    def test_remote_failure_preserves_config_and_save(self):
        m=load(S/'small-native-runtime.py')
        with tempfile.TemporaryDirectory() as d:
            r=Path(d);p=r/'ServerData/save/remote.park';p.parent.mkdir(parents=True);p.write_bytes(b'old');c=r/'ServerData/config.ini';c.write_bytes(b'; operator\n')
            with patch.object(m.urllib.request,'urlopen',side_effect=OSError('fetch failed')):
                with self.assertRaises(OSError):m.configure_openrct2(r,{'SAVE_URI':'https://example.com/a.park','LOAD_AUTOSAVE':'false'})
            self.assertEqual(p.read_bytes(),b'old');self.assertEqual(c.read_bytes(),b'; operator\n')
    def test_update_publication_rollback_and_success(self):
        m=load(S/'small-native-install.py')
        with tempfile.TemporaryDirectory() as d,patch.object(m.os,'chown',create=True):
            r=Path(d);target=r/'OpenRCT2';(target/'bin').mkdir(parents=True);binary=target/'bin/openrct2-cli';binary.write_bytes(b'old')
            state=r/'.voltra/openrct2';state.mkdir(parents=True);receipt=state/'release.json';receipt.write_text('{}')
            operator=target/'share/operator';operator.parent.mkdir();operator.write_bytes(b'keep')
            stage=r/'stage';(stage/'bin').mkdir(parents=True);(stage/'bin/openrct2-cli').write_bytes(b'new')
            replace=m.os.replace
            def fail_receipt(src,dst):
                if Path(dst)==receipt:raise OSError('injected receipt failure')
                return replace(src,dst)
            with patch.object(m.os,'replace',side_effect=fail_receipt):
                with self.assertRaises(OSError):m.publish(r,stage,target,{'game':'openrct2'},'bin/openrct2-cli')
            self.assertEqual(binary.read_bytes(),b'old');self.assertEqual(receipt.read_text(),'{}');self.assertEqual(operator.read_bytes(),b'keep')
            (stage/'bin/openrct2-cli').write_bytes(b'new')
            m.publish(r,stage,target,{'game':'openrct2'},'bin/openrct2-cli')
            self.assertEqual(binary.read_bytes(),b'new');self.assertEqual(operator.read_bytes(),b'keep')
    def test_remote_success(self):
        m=load(S/'small-native-runtime.py')
        with tempfile.TemporaryDirectory() as d,patch.dict(os.environ):
            r=Path(d);response=io.BytesIO(b'new park');response.url='https://example.com/a.park'
            with patch.object(m.urllib.request,'urlopen',return_value=response):
                argv,_=m.configure_openrct2(r,{'SAVE_URI':response.url,'LOAD_AUTOSAVE':'false'})
            self.assertEqual((r/'ServerData/save/remote.park').read_bytes(),b'new park');self.assertIn(str(r/'ServerData/save/remote.park'),argv)
            self.assertEqual(list((r/'ServerData/save').glob('.remote-*')),[])
    def test_staged_profile(self):
        stager=load(ROOT/'tools/runtime/stage-openrct2-wave39.py');profile,names=stager.stage()
        canonical=json.loads((S.parent/'overrides.json').read_text(encoding='utf-8'))['openrct2/egg-openrct2.json']
        script=profile['egg']['scripts']['installation']['script']
        profile['egg']['scripts']['installation']['script']=canonical['egg']['scripts']['installation']['script'];self.assertEqual(profile,canonical)
        import re
        files=dict(re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE",script,re.S))
        for name in names:self.assertEqual(files[name],(S/('steam-template.py' if name=='steam_template.py' else name)).read_text().rstrip())
if __name__=='__main__':unittest.main(verbosity=2)
