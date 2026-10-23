import hashlib
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
import warnings
from unittest.mock import patch
import zipfile

native=types.ModuleType('native_release');exec(NATIVE_SOURCE,native.__dict__);sys.modules['native_release']=native
zipped=types.ModuleType('native_zip_release');exec(ZIP_SOURCE,zipped.__dict__);sys.modules['native_zip_release']=zipped
runtime={'__name__':'fixture'};exec(RUNTIME_SOURCE,runtime)


def archive(binary=b'engine one'):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as out:
        out.writestr('release/oa_ded.x86_64',binary)
        out.writestr('release/baseoa/pak0.pk3',b'stock package')
        out.writestr('release/baseoa/server.cfg',b'# stock config')
    return stream.getvalue()


class OpenArenaTests(unittest.TestCase):
    def manifest(self,body,version='0.8.8'):
        return {'version':version,'prefix':'release','url':'https://fixture.invalid/archive',
                'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)}

    def test_native_quote_constraints(self):
        self.assertEqual(runtime['quoted']('literal $value +command',127), '"literal $value +command"')
        for value,info in [('bad"quote',False),('bad\ncommand',False),('bad;info',True),('bad\\info',True),('世'*86,False)]:
            with self.assertRaises(ValueError):runtime['quoted'](value,255,info)

    def test_native_configuration_and_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);folder=root/'openarena/userdata/baseoa';folder.mkdir(parents=True)
            (folder/'server.cfg').write_bytes(b'operator config')
            with zipfile.ZipFile(folder/'custom.pk3','w') as out:out.writestr('maps/aggressor.bsp',b'map')
            env={'SERVER_PORT':'23560','SERVER_NAME':'Literal $name +value','SERVER_PASSWORD':'private +literal'}
            argv=runtime['configure'](env,root)
            self.assertEqual((folder/'server.cfg').read_bytes(),b'operator config')
            managed=folder/'voltra-managed.cfg';before=managed.stat().st_mtime_ns
            self.assertEqual(managed.stat().st_mode&0o777,0o600)
            self.assertIn('set sv_hostname "Literal $name +value"',managed.read_text())
            self.assertIn('set g_password "private +literal"',managed.read_text())
            self.assertEqual((root/'.voltra/openarena/rcon-password').stat().st_mode&0o777,0o600)
            self.assertEqual(runtime['configure'](env,root),argv)
            self.assertEqual(managed.stat().st_mtime_ns,before)
            self.assertIn('server.cfg',argv);self.assertIn('voltra-managed.cfg',argv)

    def test_invalid_controls_and_missing_maps(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);folder=root/'openarena/baseoa/maps';folder.mkdir(parents=True)
            (folder/'aggressor.bsp').write_bytes(b'map')
            for values in ({'GAME_MAP':'../map'},{'GAME_MAP':'absent'},{'MAX_PLAYERS':'65'},
                           {'GAME_TYPE':'14'},{'GAME_TYPE':'2'},{'SERVER_PASSWORD':'bad;password'},{'PUBLIC_SERVER':'true'},{'GAME_MOD':'../baseoa'},
                           {'MIN_PLAYERS':'17'},{'SERVER_NAME':'bad"quote'}):
                with self.assertRaises(ValueError):runtime['configure']({'SERVER_PORT':'23560',**values},root)

    def test_zip_rejects_traversal_links_and_duplicates(self):
        for name,mode in [('release/../escape',0),('release/link',stat.S_IFLNK|0o777)]:
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);info=zipfile.ZipInfo(name);info.external_attr=mode<<16
                with zipfile.ZipFile(root/'archive','w') as out:out.writestr(info,b'payload')
                with self.assertRaises(ValueError):zipped.extract(root/'archive',root/'target','release')

    def test_unselected_platform_links_are_not_extracted(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);info=zipfile.ZipInfo('release/other-platform/link');info.external_attr=(stat.S_IFLNK|0o777)<<16
            with zipfile.ZipFile(root/'archive','w') as out:
                out.writestr(info,b'ignored');out.writestr('release/oa_ded.x86_64',b'engine')
            zipped.extract(root/'archive',root/'target','release',['oa_ded.x86_64'])
            self.assertTrue((root/'target/oa_ded.x86_64').is_file())
            self.assertFalse((root/'target/other-platform').exists())

    def test_duplicate_zip_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with warnings.catch_warnings():
                warnings.simplefilter('ignore',UserWarning)
                with zipfile.ZipFile(root/'archive','w') as out:
                    out.writestr('release/duplicate',b'one');out.writestr('release/duplicate',b'two')
            with self.assertRaises(ValueError):zipped.extract(root/'archive',root/'target','release')

    def test_checksum_mismatch_preserves_existing_engine(self):
        body=archive()
        with tempfile.TemporaryDirectory() as directory,patch.object(native.urllib.request,'urlopen',return_value=io.BytesIO(body)):
            root=Path(directory);(root/'openarena').mkdir();(root/'openarena/oa_ded.x86_64').write_bytes(b'keep original')
            with self.assertRaises(ValueError):zipped.install_release(root,{**self.manifest(body),'sha256':'0'*64},'openarena','oa_ded.x86_64')
            self.assertEqual((root/'openarena/oa_ded.x86_64').read_bytes(),b'keep original')

    def test_install_cache_preserves_operator_files_and_execute_mode(self):
        body=archive()
        with tempfile.TemporaryDirectory() as directory,patch.object(native.urllib.request,'urlopen',side_effect=lambda *a,**k:io.BytesIO(body)):
            root=Path(directory)
            zipped.install_release(root,self.manifest(body),'openarena','oa_ded.x86_64')
            game=root/'openarena';self.assertTrue((game/'oa_ded.x86_64').stat().st_mode&0o111)
            (game/'baseoa/server.cfg').write_bytes(b'operator cfg');(game/'baseoa/custom.pk3').write_bytes(b'operator package')
            with patch.object(native.urllib.request,'urlopen',side_effect=AssertionError('cached download')):
                zipped.install_release(root,self.manifest(body),'openarena','oa_ded.x86_64')
            self.assertEqual((game/'baseoa/server.cfg').read_bytes(),b'operator cfg')
            self.assertEqual((game/'baseoa/custom.pk3').read_bytes(),b'operator package')

    def test_failed_publication_rolls_back_existing_engine(self):
        first,second=archive(),archive(b'engine two')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(native.urllib.request,'urlopen',return_value=io.BytesIO(first)):
                zipped.install_release(root,self.manifest(first),'openarena','oa_ded.x86_64')
            receipt=(root/'.voltra/openarena/release.json').read_bytes();replace=zipped.os.replace
            def publish(source,destination):
                if Path(source).name=='receipt.json':raise OSError('fixture failure')
                return replace(source,destination)
            with patch.object(native.urllib.request,'urlopen',return_value=io.BytesIO(second)),patch.object(zipped.os,'replace',side_effect=publish):
                with self.assertRaises(OSError):zipped.install_release(root,self.manifest(second,'next'),'openarena','oa_ded.x86_64')
            self.assertEqual((root/'openarena/oa_ded.x86_64').read_bytes(),b'engine one')
            self.assertEqual((root/'.voltra/openarena/release.json').read_bytes(),receipt)

    def test_update_retains_modified_stock_package_and_operator_config(self):
        first,second=archive(),archive(b'engine two')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(native.urllib.request,'urlopen',return_value=io.BytesIO(first)):
                zipped.install_release(root,self.manifest(first),'openarena','oa_ded.x86_64')
            game=root/'openarena'
            (game/'baseoa/pak0.pk3').write_bytes(b'operator stock override')
            (game/'baseoa/server.cfg').write_bytes(b'operator configuration')
            with patch.object(native.urllib.request,'urlopen',return_value=io.BytesIO(second)):
                zipped.install_release(root,self.manifest(second,'next'),'openarena','oa_ded.x86_64')
            self.assertEqual((game/'oa_ded.x86_64').read_bytes(),b'engine two')
            self.assertEqual((game/'baseoa/pak0.pk3').read_bytes(),b'operator stock override')
            self.assertEqual((game/'baseoa/server.cfg').read_bytes(),b'operator configuration')


unittest.main()
