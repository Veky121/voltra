"""Offline fixtures only; native acceptance is recorded separately."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile
import subprocess
import sys
import signal
import threading
import os

base=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name):
    spec=importlib.util.spec_from_file_location(name,base/(name+'.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
runtime=load('small-native-runtime');installer=load('small-native-install')

class NativeSmallTests(unittest.TestCase):
    def test_openrct2_native_line_console_and_save_quit_delivery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);managed=root/'.voltra';managed.mkdir()
            for source,name in [('small-native-runtime.py','small-native-runtime.py'),('native-config.py','native-config.py'),('native-console.py','native-console.py'),('steam-template.py','steam_template.py'),('openrct2-runtime.py','openrct2-runtime.py')]: (managed/name).write_bytes((base/source).read_bytes())
            save=root/'ServerData/save';save.mkdir(parents=True);(save/'save.park').write_bytes(b'offline-fixture')
            binary=root/'OpenRCT2/bin/openrct2-cli';binary.parent.mkdir(parents=True)
            binary.write_text('#!'+sys.executable+'\n'+"import os,sys\nassert os.environ['TERM']=='dumb'\nassert sys.stdin.isatty() and sys.stdout.isatty()\nassert 'PYTHONHOME' not in os.environ\nprint('READY',flush=True)\nfor line in sys.stdin:\n if line.startswith('console.log'):\n  print('CONSOLE_ACK',flush=True)\n elif 'save_park' in line and 'quit' in line:\n  print('SAVE_AND_QUIT_ACK',flush=True)\n  raise SystemExit(0)\n else:raise SystemExit(9)\n")
            binary.chmod(0o755)
            environment=dict(os.environ,LD_LIBRARY_PATH='./OpenRCT2/lib')
            child=subprocess.Popen([sys.executable,str(managed/'openrct2-runtime.py')],cwd=root,env=environment,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            watchdog=threading.Timer(8,lambda:child.kill() if child.poll() is None else None);watchdog.start()
            try:
                ready=child.stdout.readline()
                if not ready:
                    _,error=child.communicate(timeout=2)
                    self.fail('Native fixture failed before ready: '+error.decode(errors='replace'))
                self.assertIn(b'READY',ready)
                child.stdin.write(b'console.log("probe");\n');child.stdin.flush()
                self.assertIn(b'CONSOLE_ACK',child.stdout.readline())
                child.send_signal(signal.SIGTERM);out,error=child.communicate(timeout=5)
                self.assertEqual(child.returncode,0,error);self.assertIn(b'SAVE_AND_QUIT_ACK',out)
            finally:
                watchdog.cancel()
                if child.poll() is None:child.kill();child.wait()
                for stream in (child.stdin,child.stdout,child.stderr):
                    if stream:stream.close()
    def test_cs2d_native_strings_reject_unsupported_quotes(self):
        self.assertEqual(runtime.cs_quoted('Literal \\ path; $text'),'"Literal \\ path; $text"')
        with self.assertRaises(ValueError):runtime.cs_quoted('invalid "quote"')
    def test_staged_console_redacts_native_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            (root/'steam_template.py').write_bytes((base/'steam-template.py').read_bytes())
            (root/'native-config.py').write_bytes((base/'native-config.py').read_bytes())
            script=root/'probe.py'
            script.write_text((base/'small-native-runtime.py').read_text().split("if __name__=='__main__':")[0]+"\nraise SystemExit(run_native([sys.executable,'-c','print(\\\"native-private-credential\\\")'],Path.cwd(),['native-private-credential']))\n")
            result=subprocess.run([sys.executable,str(script)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertNotIn('native-private-credential',result.stdout)
            self.assertIn('[redacted]',result.stdout)
    def test_commands_keep_comments_and_unknown_settings(self):
        original='// operator\r\nsv_name old\r\nmp_roundtime 7\r\n'
        out=runtime.patch_commands(original,{'sv_name':'"new"','sv_hostport':'28000'})
        self.assertEqual(out,'// operator\r\nsv_name "new"\r\nmp_roundtime 7\r\nsv_hostport 28000\r\n')
        self.assertEqual(out,runtime.patch_commands(out,{'sv_name':'"new"','sv_hostport':'28000'}))
        with self.assertRaises(ValueError):runtime.patch_commands('sv_name a\nsv_name b\n',{'sv_name':'"new"'})

    def test_config_cs2d_native_paths_and_retained_rcon(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'cs2d/maps').mkdir(parents=True);(root/'cs2d/maps/de_dust2.map').write_bytes(b'fixture')
            args,cwd=runtime.configure_cs2d(root,{'SERVER_PORT':'28000','SERVER_NAME':'Name $literal'})
            self.assertIn('28000',args);self.assertEqual(cwd,root/'cs2d')
            credential=root/'.voltra/cs2d/rcon-password';value=credential.read_bytes()
            self.assertEqual(credential.stat().st_mode&0o777,0o600)
            runtime.configure_cs2d(root,{'SERVER_PORT':'28001'})
            self.assertEqual(credential.read_bytes(),value)
            self.assertIn('sv_hostport 28001',(root/'cs2d/sys/server.cfg').read_text())

    def test_newest_real_autosave_and_path_confinement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);save=root/'ServerData/save/autosave';save.mkdir(parents=True)
            (save/'save.park').write_bytes(b'fixture');(save/'ignored.log').write_bytes(b'not a park')
            args,_=runtime.configure_openrct2(root,{})
            self.assertIn(str(save/'save.park'),args)
            with self.assertRaises(ValueError):runtime.configure_openrct2(root,{'LOAD_AUTOSAVE':'false','SAVE_URI':'../other.park'})

    def test_publish_preserves_operator_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);stage=root/'stage';stage.mkdir();(stage/'binary').write_bytes(b'engine1');(stage/'config').write_bytes(b'default')
            installer.publish(root,stage,root/'game',{'game':'fixture','version':'1'},'binary')
            receipt=root/'.voltra/fixture/release.json';receipt.chmod(0o600)
            (root/'game/config').write_bytes(b'operator');(root/'game/save').write_bytes(b'save')
            (stage/'binary').write_bytes(b'engine2');(stage/'config').write_bytes(b'newdefault')
            installer.publish(root,stage,root/'game',{'game':'fixture','version':'2'},'binary')
            self.assertEqual((root/'game/config').read_bytes(),b'operator');self.assertEqual((root/'game/save').read_bytes(),b'save')
            self.assertEqual((root/'game/binary').read_bytes(),b'engine2')
            self.assertEqual(receipt.stat().st_mode&0o777,0o600)

    def test_zip_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);archive=root/'archive.zip'
            with zipfile.ZipFile(archive,'w') as out:out.writestr('../escape','bad')
            with self.assertRaises(ValueError):installer.extract_zip(archive,root/'ready')

if __name__=='__main__':unittest.main()
