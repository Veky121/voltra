import importlib.util
from pathlib import Path
import tempfile
import unittest

def load(name):
    spec=importlib.util.spec_from_file_location(name,Path('internal/panel/game_library/scripts')/(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class SAMP(unittest.TestCase):
    def test_native_legacy_config_and_secret_persistence(self):
        runtime=load('samp-runtime')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'samp').mkdir();p=root/'samp/server.cfg';p.write_bytes('gamemode0 custom 1\nfilterscripts foo\nplugins mysql.so\necho café\nrcon_password changeme\nport 1\n'.encode('cp1252'))
            env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','SERVER_NAME':'Café "literal" $','MAX_PLAYERS':'12'}
            password=runtime.configure(root,env);self.assertEqual(len(password),32);self.assertEqual(runtime.configure(root,env),password);raw=p.read_bytes().decode('cp1252');self.assertIn('plugins mysql.so',raw);self.assertIn('gamemode0 custom 1',raw);self.assertIn('filterscripts foo',raw);self.assertIn('echo café',raw);self.assertIn('hostname Café "literal" $',raw);self.assertNotIn('changeme',raw);self.assertEqual(raw.count('rcon_password '),1)
    def test_original_version_and_fail_closed_archive(self):
        installer=load('gta-legacy-install')
        with self.assertRaises(ValueError):installer.identity('samp',{'Version':'0.3.7'})
        identity=installer.identity('samp',{'Version':'0.3.7-R2','DEDICATED_ARCHIVE_URL':'https://example.test/server.tar.gz','DEDICATED_ARCHIVE_SHA256':'a'*64});self.assertTrue(identity['version'].startswith('0.3.7-R2-'))
        upper=installer.identity('samp',{'VERSION':'0.3.DL-R1','DEDICATED_ARCHIVE_URL':'https://example.test/server.tar.gz','DEDICATED_ARCHIVE_SHA256':'a'*64});self.assertTrue(upper['version'].startswith('0.3.DL-R1-'))

if __name__=='__main__':unittest.main()
