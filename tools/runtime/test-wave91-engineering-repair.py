"""Source-only fixtures. No acquisition or native games."""
import importlib.util, json, os, shutil, subprocess, sys, tempfile, unittest, zipfile
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parents[2]
S=ROOT/'internal/panel/game_library/scripts'
def load(name):
    spec=importlib.util.spec_from_file_location(name,S/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
E=load('engineering-servers'); V=load('space-engineers-vanilla')
ENV={'SERVER_PORT':'28020','STEAM_PORT':'28021','REMOTEAPI_PORT':'28022','VOLTRA_ALLOCATED_PORTS':'28020,28021,28022','INSTALL_MODE':'operator_files'}
class Repairs(unittest.TestCase):
    def test_nested_publication_repair_and_rollback(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'Instance/Saves/World').mkdir(parents=True)
            keep={'Plugins/upload.dll':b'uploaded','Torch.cfg':b'operator config','Instance/Saves/World/Sandbox.sbc':b'world'}
            for n,b in keep.items():
                p=root/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);p.chmod(0o640)
            archive=root/'.voltra/payload.zip';archive.parent.mkdir(exist_ok=True)
            def payload(b):
                with zipfile.ZipFile(archive,'w') as z:
                    z.writestr('Torch.Server.exe',b);z.writestr('Torch.dll',b);z.writestr('Torch.cfg',b'publisher default');z.writestr('publisher.xml',b)
            def download(pin,target):shutil.copyfile(archive,target)
            env={**ENV,'INSTALL_MODE':'steam'}
            with mock.patch.object(E.release,'download',side_effect=download),mock.patch.object(E.steam,'arguments'),mock.patch.object(E.steam,'update'),mock.patch.object(E,'steam_sdk'):
                payload(b'one');E.install(root,'torch',env)
                payload(b'two')
                with (E.preserve_engineering(root) if hasattr(E,'preserve_engineering') else E.shared.preserve(root)):
                    E.install(root,'torch',env)
                self.assertEqual((root/'Torch.Server.exe').read_bytes(),b'two')
                updated=json.loads((root/'.voltra/engineering/torch/release.json').read_text())
                for n,h in updated['files'].items():self.assertEqual(E.release.sha256(root/n),h)
                E.install(root,'torch',env)
                receipt=root/'.voltra/engineering/torch/release.json'
                for n,h in json.loads(receipt.read_text())['files'].items():self.assertEqual(E.release.sha256(root/n),h)
                old=receipt.read_bytes();payload(b'three')
                original=E.native.private_write
                def fail(path,text):
                    if Path(path)==receipt:raise OSError('fixture receipt refusal')
                    return original(path,text)
                with mock.patch.object(E.native,'private_write',side_effect=fail):
                    with self.assertRaises(OSError):E.install(root,'torch',env)
                self.assertEqual(receipt.read_bytes(),old)
                self.assertEqual((root/'Torch.Server.exe').read_bytes(),b'two')
            for n,b in keep.items():
                self.assertEqual((root/n).read_bytes(),b)
                self.assertEqual((root/n).stat().st_mode&0o777,0o640)
    def test_fresh_operator_world_refusal(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            with mock.patch.object(V.base,'install') as install:
                with self.assertRaisesRegex(ValueError,'Sandbox.sbc'):V.main('install',root,ENV)
                install.assert_not_called()
            self.assertFalse((root/'config/SpaceEngineers-Dedicated.cfg').exists())
    def test_existing_uploaded_checkpoint(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'config/Saves/World/Sandbox.sbc';p.parent.mkdir(parents=True);p.write_bytes(b'<MyObjectBuilder_Checkpoint/>');p.chmod(0o640)
            self.assertIsNone(V.preflight(root,ENV));self.assertEqual(p.read_bytes(),b'<MyObjectBuilder_Checkpoint/>');self.assertEqual(p.stat().st_mode&0o777,0o640)
    @unittest.skipUnless(os.name=='posix','POSIX owned-process signal fixture')
    def test_synthetic_shutdown(self):
        for mode,expected in [('ignore',-15),('success',0),('crash',7)]:
            child="import signal,time,sys; signal.signal(signal.SIGINT, "+("signal.SIG_IGN" if mode=='ignore' else "lambda *args:sys.exit("+str(expected)+")")+"); print('fixture-ready',flush=True); time.sleep(30)"
            driver="import importlib.util,sys,signal,os;sys.path.insert(0,"+repr(str(S))+");spec=importlib.util.spec_from_file_location('nc',"+repr(str(S/'native-console.py'))+");m=importlib.util.module_from_spec(spec);es=importlib.util.spec_from_file_location('es',"+repr(str(S/'engineering-servers.py'))+");em=importlib.util.module_from_spec(es);es.loader.exec_module(em);spec.loader.exec_module(m);code=m.run('.',sys.argv[1:],dict(os.environ),'stop',terminal_input=True,stop_signal=signal.SIGINT,stop_signal_timeout=.2);print('RESULT',code)"
            p=subprocess.Popen([sys.executable,'-B','-c',driver,sys.executable,'-u','-c',child],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
            try:
                self.assertIn('fixture-ready',p.stdout.readline());p.send_signal(15);out=p.communicate(timeout=15)[0];self.assertIn('RESULT '+str(expected),out)
                if expected:self.assertIn('raw_status='+str(expected),out)
                if mode=='ignore':self.assertIn('Save completion is unconfirmed',out)
            finally:
                if p.poll() is None:p.kill();p.wait()
if __name__=='__main__':unittest.main()
