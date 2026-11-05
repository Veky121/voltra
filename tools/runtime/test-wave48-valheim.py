import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch,Mock

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('stager',ROOT/'tools/runtime/stage-wave48-valheim.py');stager=importlib.util.module_from_spec(spec);spec.loader.exec_module(stager)
profile=stager.stage()
staged=tempfile.TemporaryDirectory()
emitted=Path(staged.name)
for name,body in re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE",profile['egg']['scripts']['installation']['script'],re.S):
    (emitted/name).write_text(body)
sys.path.insert(0,str(emitted))
import valheim_runtime as runtime
import valheim_vrising_install as installer

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.env={'SERVER_PORT':'2456','VOLTRA_ALLOCATED_PORTS':'2456,2457','PASSWORD':'privateSecret','WORLD':'World One'}
        for target in ('subprocess.Popen','subprocess.run','subprocess.check_call','urllib.request.urlopen'):
            p=patch(target,side_effect=AssertionError('Unmocked boundary '+target));p.start();self.addCleanup(p.stop)
    def test_emission_and_controls(self):
        self.assertTrue((emitted/'valheim_runtime.py').is_file());self.assertTrue((emitted/'valheim_vrising_install.py').is_file())
        original=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[stager.KEY]
        a=json.loads(json.dumps(profile));a['egg']['scripts']=original['egg']['scripts'];self.assertEqual(a,original)
    def test_refusal_before_acquisition_and_any_write(self):
        for change in ({'PASSWORD':'tiny'},{'WORLD':'../escape'},{'VOLTRA_ALLOCATED_PORTS':'2456,2458'},{'BACKUP_COUNT':'-1'},{'SERVER_NAME':'bad\nname'}):
            with self.subTest(change=change),patch.object(installer,'update',side_effect=AssertionError('acquisition')),self.assertRaises(ValueError):installer.install(self.root,'valheim',{**self.env,**change})
        self.assertEqual(list(self.root.iterdir()),[])
    def test_malformed_receipt_before_update(self):
        p=self.root/'.voltra/valheim/installation.json';p.parent.mkdir(parents=True)
        for value in ('{','[]','{"overlays":[{"files":[]}]}'):
            p.write_text(value)
            with patch.object(installer,'update',side_effect=AssertionError('acquisition')),self.assertRaises((ValueError,TypeError)):installer.install(self.root,'valheim',self.env)
            self.assertEqual(p.read_text(),value)
    def test_literal_arguments_and_unknown_bytes(self):
        p=self.root/'.config/unity3d/IronGate/Valheim/adminlist.txt';p.parent.mkdir(parents=True);p.write_bytes(b'//operator\r\n123\xff\n')
        args=runtime.launch_arguments(self.root,{**self.env,'SERVER_NAME':'Literal $() +name'})
        self.assertEqual(args[args.index('-world')+1],'World One');self.assertEqual(args[args.index('-name')+1],'Literal $() +name')
        self.assertNotIn('-savedir',args);self.assertEqual(p.read_bytes(),b'//operator\r\n123\xff\n')
    def test_update_success_failure_preserves_operator_data(self):
        protected=['.config/unity3d/IronGate/Valheim/worlds_local/World One.db','BepInEx/config/operator.cfg','BepInEx/plugins/operator.dll','.voltra/valheim.properties']
        for name in protected:
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'operator\x00\xff\r\n')
        with patch.object(installer,'update') as update,patch('private_nss.provision'),patch.object(installer.os,'chown',create=True):
            installer.install(self.root,'valheim',self.env);self.assertEqual(update.call_args.args[1],896660)
        receipt=(self.root/'.voltra/valheim/installation.json').read_bytes()
        with patch.object(installer,'update',side_effect=RuntimeError('mock failure')),self.assertRaises(RuntimeError):installer.install(self.root,'valheim',self.env)
        self.assertEqual((self.root/'.voltra/valheim/installation.json').read_bytes(),receipt)
        for name in protected:self.assertEqual((self.root/name).read_bytes(),b'operator\x00\xff\r\n')
    def test_log_masking_readiness_and_exit(self):
        class Output(io.StringIO):
            def __init__(self):super().__init__();self.buffer=io.BytesIO()
        for lines,exitcode,expected in [(b'privateSecret\nGame server connected\n',7,7),(b'failed privateSecret\n',0,1)]:
            child=Mock();child.stdout=io.BytesIO(lines);child.wait.return_value=exitcode
            output=Output()
            with patch.object(runtime.subprocess,'Popen',return_value=child),patch.object(runtime.signal,'signal'),patch.object(runtime.sys,'stdout',output):
                result=runtime.run(self.root,['mock'],{},['privateSecret'])
            self.assertEqual(result,expected);self.assertNotIn(b'privateSecret',output.buffer.getvalue());self.assertEqual('VOLTRA_VALHEIM_READY' in output.getvalue(),b'connected' in lines)
    def test_mocked_stop_forwards_sigint_once(self):
        child=Mock();child.poll.return_value=None;child.pid=123;child.wait.return_value=0
        handlers={}
        class Lines:
            count=0
            def readline(self):
                self.count+=1
                if self.count==1:
                    handlers[runtime.signal.SIGTERM]();handlers[runtime.signal.SIGTERM]()
                    return b'Game server connected\n'
                return b''
            def close(self):pass
        child.stdout=Lines()
        output=Mock();output.buffer=io.BytesIO()
        with patch.object(runtime.subprocess,'Popen',return_value=child),patch.object(runtime.signal,'signal',side_effect=lambda sig,fn:handlers.update({sig:fn})),patch.object(runtime.os,'killpg',create=True) as kill,patch.object(runtime.sys,'stdout',output):
            self.assertEqual(runtime.run(self.root,['mock'],{},[]),0)
            kill.assert_called_once_with(123,runtime.signal.SIGINT)
    def test_main_preflight_precedes_update(self):
        with patch.dict(os.environ,{**self.env,'PASSWORD':'x','VOLTRA_STEAM_AUTO_UPDATE':'1'},clear=True),patch.object(installer,'install',side_effect=AssertionError('acquisition')),self.assertRaises(ValueError):runtime.main()

if __name__=='__main__':
    try:unittest.main()
    finally:staged.cleanup()
