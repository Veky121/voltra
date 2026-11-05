import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock

ROOT=Path(__file__).resolve().parents[2]
file=ROOT/'artifacts/game-parity-20261029/vintagestory-runtime.pending.py'
spec=importlib.util.spec_from_file_location('vintage_candidate',file)
candidate=importlib.util.module_from_spec(spec);spec.loader.exec_module(candidate)

class VintageRuntimeCandidate(unittest.TestCase):
    def environment(self, **extra):
        return {'SERVER_PORT':'29102','VOLTRA_ALLOCATED_PORTS':'29102','MAX_CLIENTS':'17',**extra}

    def test_invalid_startup_refuses_before_any_directory_or_child(self):
        for extra in ({'OPTIONS':'"unclosed'},{'MAX_CLIENTS':'0'},{'VOLTRA_ALLOCATED_PORTS':'29103'},{'OPTIONS':'bad\nflag'}):
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as d:
                root=Path(d);run=Mock(return_value=0)
                with self.assertRaises(ValueError):candidate.main(root,self.environment(**extra),run)
                self.assertEqual(list(root.iterdir()),[]);run.assert_not_called()

    def test_arguments_custom_path_and_cli_ownership_retained(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);other=root/'other data';other.mkdir()
            original=b'{"Password":"fixture-secret","Unknown":{"value":7}}'
            (other/'serverconfig.json').write_bytes(original)
            run=Mock(return_value=0)
            options='--dataPath "'+str(other)+'" --name "literal $value; $(touch injected)"'
            self.assertEqual(candidate.main(root,self.environment(OPTIONS=options),run),0)
            args=run.call_args.args[1]
            self.assertIn('--maxclients=17',args);self.assertIn('--port=29102',args)
            self.assertEqual(args[-1],'literal $value; $(touch injected)')
            self.assertEqual(run.call_args.kwargs['credentials'],['fixture-secret'])
            self.assertEqual((other/'serverconfig.json').read_bytes(),original)
            self.assertFalse((root/'injected').exists())

    def test_stop_and_exit_semantics_delegate_without_forced_success(self):
        with tempfile.TemporaryDirectory() as d:
            for raw,expected in ((0,0),(17,17),(-9,137)):
                run=Mock(return_value=raw)
                self.assertEqual(candidate.main(Path(d),self.environment(),run),expected)
                self.assertEqual(run.call_args.args[3],'/stop')
                self.assertEqual(run.call_args.args[2]['SQLITE_TMPDIR'],str(Path(d)/'data/Backups'))

    def test_nonstandard_native_json_is_not_rewritten(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'data').mkdir()
            target=root/'data/serverconfig.json';before=b'{"Password":null, /*publisher/operator comment*/ "Unknown":1}'
            target.write_bytes(before)
            run=Mock(return_value=0);candidate.main(root,self.environment(),run)
            self.assertEqual(target.read_bytes(),before);self.assertEqual(run.call_args.kwargs['credentials'],[])

    @unittest.skipUnless(os.name == 'posix', 'Linux executable stand-in')
    def test_real_shared_supervisor_raw_diagnostics_redaction_and_stop(self):
        for mode,expected,diagnostics in [('clean',0,0),('positive',17,1),('signal',137,1),('stop',0,0)]:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as d:
                root=Path(d);(root/'.voltra').mkdir();(root/'data').mkdir();(root/'bin').mkdir()
                (root/'data/serverconfig.json').write_text('{"Password":"private-fixture-sentinel"}')
                shutil.copyfile(file,root/'.voltra/vintage-story-runtime.py')
                for source,target in [('native-console.py','native_console.py'),('steam-template.py','steam_template.py')]:
                    shutil.copyfile(ROOT/'internal/panel/game_library/scripts'/source,root/'.voltra'/target)
                executable=root/'bin/dotnet'
                executable.write_text('#!'+sys.executable+'\nimport os,signal,sys\nprint("private-fixture-sentinel",flush=True)\nmode=os.environ["FIXTURE_MODE"]\nif mode=="signal":os.kill(os.getpid(),signal.SIGKILL)\nif mode=="positive":sys.exit(17)\nif mode=="stop":\n for line in sys.stdin:\n  if line.strip()=="/stop":break\n')
                executable.chmod(0o700)
                env={**os.environ,**self.environment(), 'FIXTURE_MODE':mode,'PATH':str(root/'bin')+os.pathsep+os.environ['PATH']}
                result=subprocess.run([sys.executable,str(root/'.voltra/vintage-story-runtime.py')],cwd=root,env=env,input='/stop\n' if mode=='stop' else '',text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=10)
                self.assertEqual(result.returncode,expected,result.stdout)
                self.assertNotIn('private-fixture-sentinel',result.stdout)
                self.assertEqual(result.stdout.count('Native process exited'),diagnostics,result.stdout)
                if mode=='signal':self.assertIn('raw_status=-9',result.stdout);self.assertIn('signal=9',result.stdout);self.assertIn('stop_requested=false',result.stdout)

if __name__=='__main__':unittest.main()
