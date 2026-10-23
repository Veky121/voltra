import importlib.util
import json
from pathlib import Path
import shutil
import stat
import tempfile
import unittest
from unittest import mock
import zipfile

spec=importlib.util.spec_from_file_location('foundry',Path('internal/panel/game_library/scripts/foundry-native.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

class Foundry(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.env={'SERVER_PORT':'28000','TIMED_URL':'https://example.invalid/private-secret'}
    def tearDown(self):self.temp.cleanup()
    def archive(self,names=('main.mjs',)):
        archive=self.root/'fixture.zip'
        with zipfile.ZipFile(archive,'w') as z:
            for name in names:z.writestr(name,'// synthetic fixture, no publisher code')
        return archive
    def install(self,archive):f.install(self.root,self.env,lambda url,out:shutil.copyfile(archive,out))
    def test_options_install_preserved_startup_typed(self):
        p=self.root/'data/Config/options.json';p.parent.mkdir(parents=True);p.write_text('{"port":1,"proxySSL":true,"world":"operator","unknown":[1]}')
        before=p.read_bytes();f.options(self.root,self.env);self.assertEqual(before,p.read_bytes())
        f.options(self.root,self.env,True);v=json.loads(p.read_text());self.assertEqual(v['port'],28000);self.assertTrue(v['proxySSL']);self.assertEqual(v['unknown'],[1]);self.assertEqual(v['world'],'operator')
    def test_reinstall_data_and_secret_receipt(self):
        archive=self.archive();self.install(archive)
        data=self.root/'data/worlds/proof';data.parent.mkdir(parents=True);data.write_bytes(b'owned')
        admin=self.root/'data/Config/admin.txt';admin.write_text('private')
        options=(self.root/'data/Config/options.json').read_bytes();self.install(archive)
        self.assertEqual(data.read_bytes(),b'owned');self.assertEqual(admin.read_text(),'private');self.assertEqual((self.root/'data/Config/options.json').read_bytes(),options)
        receipt=(self.root/'.voltra/foundry-install.json').read_text();self.assertNotIn('private-secret',receipt);self.assertFalse(json.loads(receipt)['licensed_runtime_verified'])
        self.assertFalse(list(self.root.glob('.foundry-install-*')))
    def test_traversal_absolute_drive_backslash_duplicates(self):
        for names in [('../escape',),('/escape',),('C:/escape',),('a\\escape',),('main.js','main.js')]:
            with self.subTest(names=names):
                with self.assertRaises(ValueError):f.extract(self.archive(names),self.root/'out')
    def test_symlink_archive(self):
        archive=self.root/'link.zip'
        with zipfile.ZipFile(archive,'w') as z:
            entry=zipfile.ZipInfo('main.js');entry.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(entry,'/etc/passwd')
        with self.assertRaises(ValueError):f.extract(archive,self.root/'out')
    def test_invalid_package_preserves_old_app(self):
        app=self.root/'app';app.mkdir();(app/'main.js').write_text('old')
        with self.assertRaises(ValueError):self.install(self.archive(('not-node.txt',)))
        self.assertEqual((app/'main.js').read_text(),'old')
    def test_checksum_failure_preserves_old_app(self):
        app=self.root/'app';app.mkdir();(app/'main.js').write_text('old');self.env['FOUNDRY_SHA256']='0'*64
        with self.assertRaises(ValueError):self.install(self.archive())
        self.assertEqual((app/'main.js').read_text(),'old')
    def test_options_symlink_and_invalid_json(self):
        outside=self.root/'outside';outside.mkdir();(self.root/'data').symlink_to(outside,target_is_directory=True)
        with self.assertRaises(ValueError):f.options(self.root,self.env)
        (self.root/'data').unlink();p=self.root/'data/Config/options.json';p.parent.mkdir(parents=True);p.write_text('[]')
        with self.assertRaises(ValueError):f.options(self.root,self.env)
    def test_https_and_error_secret(self):
        for url in ['http://example.test','https://user:pass@example.test','file:///etc/passwd','https://example.test/\nsecret']:
            with self.assertRaises(ValueError):f.https(url)
        with self.assertRaises(ValueError) as ctx:f.download('https://example.invalid/private-secret',self.root/'download')
        self.assertNotIn('private-secret',str(ctx.exception))
    def test_legacy_entrypoint(self):
        self.install(self.archive(('resources/app/main.js',)));self.assertEqual(f.entrypoint(self.root/'app').relative_to(self.root/'app').as_posix(),'resources/app/main.js')
    def test_swap_failure_restores_original(self):
        app=self.root/'app';app.mkdir();(app/'main.js').write_text('original');archive=self.archive();replace=f.os.replace
        def fail_candidate(src,dst):
            if Path(src).name=='app' and '.foundry-install-' in str(src):raise OSError('synthetic swap failure')
            return replace(src,dst)
        with mock.patch.object(f.os,'replace',side_effect=fail_candidate):
            with self.assertRaises(OSError):self.install(archive)
        self.assertEqual((app/'main.js').read_text(),'original');self.assertFalse((self.root/'.voltra/foundry-app-backup').exists())
    def test_runtime_no_secret_argv_environment(self):
        self.install(self.archive());self.env['FOUNDRY_SHA256']='a'*64
        fake=type('Console',(),{})();fake.run=mock.Mock(return_value=23)
        fake_spec=type('Spec',(),{'loader':type('Loader',(),{'exec_module':lambda *args:None})()})()
        with mock.patch.object(f.importlib.util,'spec_from_file_location',return_value=fake_spec),mock.patch.object(f.importlib.util,'module_from_spec',return_value=fake):
            self.assertEqual(f.run(self.root,self.env),23)
        args,kwargs=fake.run.call_args
        self.assertNotIn('TIMED_URL',args[2]);self.assertNotIn('FOUNDRY_SHA256',args[2]);self.assertNotIn('private-secret',str(args[1]));self.assertEqual(args[3],'\x03');self.assertTrue(kwargs['terminal_input']);self.assertEqual(kwargs['credentials'],(self.env['TIMED_URL'],))

unittest.main()
