"""Offline configuration and safety fixtures; not native game acceptance."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import os
import signal
import subprocess
import sys
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name):
    spec=importlib.util.spec_from_file_location(name,BASE/(name+'.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
runtime=load('among-us-runtime');installer=load('among-us-install')

class AmongUsFixtures(unittest.TestCase):
    def test_config_preserves_native_unrelated_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);path=root/'impostor/config.json';path.parent.mkdir()
            original={'Server':{'Custom':17},'HttpServer':{'Enabled':False},'AntiCheat':{'Enabled':False},'Plugin':{'operator':'quotes"$'}}
            path.write_text(json.dumps(original));result=runtime.configure_impostor(root,{'SERVER_PORT':'28099','PUBLIC_IP':'node.lan'})
            self.assertEqual(result['Server']['PublicPort'],28099);self.assertEqual(result['Server']['Custom'],17)
            self.assertFalse(result['HttpServer']['Enabled']);self.assertEqual(result['AntiCheat'],original['AntiCheat']);self.assertEqual(result['Plugin'],original['Plugin'])
            self.assertEqual(len(list((root/'.voltra/among-us/backups').iterdir())),1)
            runtime.configure_impostor(root,{'SERVER_PORT':'28099','PUBLIC_IP':'node.lan'})
            self.assertEqual(len(list((root/'.voltra/among-us/backups').iterdir())),1)

    def test_external_port_override(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'impostor').mkdir()
            result=runtime.configure_impostor(root,{'SERVER_PORT':'28001','PUBLIC_PORT':'22023'})
            self.assertEqual(result['Server']['PublicPort'],22023);self.assertEqual(result['Server']['ListenPort'],28001)

    def test_invalid_ports_fail(self):
        for value in ['0','65536','12;echo hacked','-1','2\n']:
            with self.subTest(value=value),self.assertRaises(ValueError):runtime.port({'PORT':value},'PORT',9736)

    def test_crew_default_allocation_and_literal_name(self):
        result=runtime.crew_environment(Path('/tmp'),{'SERVER_PORT':'28010','NAME':'quoted " $ +','HTTPS':''})
        self.assertEqual(result['PORT'],'28010');self.assertEqual(result['NAME'],'quoted " $ +')

    def test_native_https_nonempty_false_remains_enabled(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'crewlink').mkdir()
            with self.assertRaises(ValueError):runtime.crew_environment(root,{'HTTPS':'false'})
            for name in ['privkey.pem','fullchain.pem']:(root/'crewlink'/name).write_text('fixture')
            result=runtime.crew_environment(root,{'HTTPS':'false'})
            self.assertEqual(result['SSLPATH'],str(root/'crewlink'))

    def test_certificate_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(ValueError):runtime.crew_environment(Path(temporary),{'HTTPS':'1','SSLPATH':'../outside'})

    def test_certificate_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as temporary,tempfile.TemporaryDirectory() as other:
            root=Path(temporary);(root/'crewlink').mkdir()
            for name in ['privkey.pem','fullchain.pem']:
                source=Path(other)/name;source.write_text('fixture');(root/'crewlink'/name).symlink_to(source)
            with self.assertRaises(ValueError):runtime.crew_environment(root,{'HTTPS':'1'})

    def test_legacy_import_retains_original_and_imports_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'.voltra/impostor').mkdir(parents=True);(root/'impostor').mkdir()
            (root/'config.json').write_text('{"operator":17}');(root/'config.json').chmod(0o640)
            (root/'impostor/config.json').write_text('{}')
            installer.migrate(root,'impostor',['config.json'])
            self.assertEqual((root/'impostor/config.json').read_text(),'{"operator":17}')
            self.assertEqual((root/'impostor/config.json').stat().st_mode&0o777,0o640)
            (root/'impostor/config.json').write_text('{"new":19}')
            installer.migrate(root,'impostor',['config.json'])
            self.assertEqual((root/'impostor/config.json').read_text(),'{"new":19}');self.assertTrue((root/'config.json').exists())

    def test_legacy_symlink_directory_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'.voltra/impostor').mkdir(parents=True);(root/'impostor').mkdir();(root/'plugins').mkdir()
            (root/'plugins/unsafe').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):installer.migrate(root,'impostor',['plugins'])

    def test_pinned_release_does_not_need_network(self):
        with patch.object(installer,'api',side_effect=AssertionError('network')):
            self.assertEqual(installer.impostor_release('v1.10.9')['sha256'],installer.IMPOSTOR['sha256'])

    def test_no_silent_version_fallback(self):
        with patch.object(installer,'api',return_value={'assets':[]}):
            with self.assertRaises(ValueError):installer.impostor_release('v0.0.0')

    def test_legacy_checksum_explicit(self):
        asset={'name':'Impostor-Server_1.0_linux-x64.tar.gz','browser_download_url':'https://github.com/Impostor/Impostor/releases/download/v1.0/a','size':17}
        with patch.object(installer,'api',return_value={'assets':[asset],'tag_name':'v1.0'}):
            with self.assertRaises(ValueError):installer.impostor_release('v1.0')
            self.assertEqual(installer.impostor_release('v1.0','a'*64)['sha256'],'a'*64)

    def test_branch_injection_rejected(self):
        for value in ['../master','master;echo pwn','$(touch x)','a b']:
            with self.subTest(value=value),self.assertRaises(ValueError):installer.crew_release(Path('/tmp'),value)

    def test_pinned_crew_no_network(self):
        with patch.object(installer,'api',side_effect=AssertionError('network')):
            self.assertEqual(installer.crew_release(Path('/tmp'),'master')['version'],installer.CREW_COMMIT)
            with self.assertRaises(ValueError):installer.crew_release(Path('/tmp'),'master','shellcommand')

    def test_dotnet_default_and_legacy_identity(self):
        with patch.object(installer.urllib.request,'urlopen',side_effect=AssertionError('network')):
            self.assertEqual(installer.dotnet_release(Path('/tmp'),'8'),(installer.DOTNET,'dotnet'))
            with self.assertRaises(ValueError):installer.dotnet_release(Path('/tmp'),'8;command')
        self.assertEqual(set(installer.LEGACY_DOTNET),{'6','7'})
        self.assertTrue(all(len(v['publisher_sha512'])==128 for v in installer.LEGACY_DOTNET.values()))

    def test_wrapper_preserves_unexpected_native_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);managed=root/'.voltra';managed.mkdir();(root/'impostor').mkdir()
            for name in ['among-us-runtime.py','native-config.py']:(managed/name).write_bytes((BASE/name).read_bytes())
            binary=root/'impostor/Impostor.Server';binary.write_text('#!'+sys.executable+'\nraise SystemExit(7)\n');binary.chmod(0o755)
            result=subprocess.run([sys.executable,str(managed/'among-us-runtime.py'),'impostor'],env={**os.environ,'VOLTRA_SERVER_ROOT':str(root)},capture_output=True,timeout=5)
            self.assertEqual(result.returncode,7,result.stderr.decode())

    def test_wrapper_delivers_sigint_without_forcing_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);managed=root/'.voltra';managed.mkdir();(root/'impostor').mkdir()
            for name in ['among-us-runtime.py','native-config.py']:(managed/name).write_bytes((BASE/name).read_bytes())
            binary=root/'impostor/Impostor.Server';binary.write_text('#!'+sys.executable+'\nimport signal,time\nsignal.signal(signal.SIGINT,lambda *_:exit(0))\nprint("READY",flush=True)\nwhile True:time.sleep(.1)\n');binary.chmod(0o755)
            child=subprocess.Popen([sys.executable,str(managed/'among-us-runtime.py'),'impostor'],env={**os.environ,'VOLTRA_SERVER_ROOT':str(root)},stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                self.assertEqual(child.stdout.readline(),b'READY\n');child.send_signal(signal.SIGTERM);out,error=child.communicate(timeout=5)
                self.assertEqual(child.returncode,0,error.decode())
            finally:
                if child.poll() is None:child.kill();child.communicate()

if __name__=='__main__':unittest.main()
