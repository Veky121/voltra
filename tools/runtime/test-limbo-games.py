import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec=importlib.util.spec_from_file_location('limbo',Path('/source/internal/panel/game_library/scripts/limbo-install.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def jar(config='settings.yml',major=65):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as package:
        package.writestr('META-INF/MANIFEST.MF','Main-Class: example.Server\r\n')
        package.writestr('example/Server.class',bytes.fromhex('cafebabe0000')+major.to_bytes(2,'big'))
        package.writestr(config,'# publisher default\nbind:\n  ip: localhost\n  port: 25565\n')
    return output.getvalue()


class LimboInstallerTests(unittest.TestCase):
    def test_default_releases_are_immutable_verified_and_latest_alias_is_explicit(self):
        for kind in module.RELEASES:
            release=module.select_release(kind,{'VERSION':'latest'})
            self.assertRegex(release['sha256'],r'^[0-9a-f]{64}$')
            self.assertNotIn('lastSuccessfulBuild',release['url'])
        self.assertIn('/v1.13.0/',module.select_release('nano-limbo',{'VERSION':'latest'})['url'])

    def test_native_configuration_bytes_mode_owner_and_release_receipt_survive_reinstall(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);config=root/'settings.yml';original=b'# operator\r\nbind:\r\n  ip: localhost\r\n  port: 25565\r\ncustom: keep\r\n'
            config.write_bytes(original);config.chmod(0o600);before=config.stat()
            data=jar();release={'url':'https://example.org/server.jar?token=private-download','sha256':hashlib.sha256(data).hexdigest(),'version':'fixture'}
            with patch.object(module,'select_release',return_value=release),patch.object(module,'fetch',return_value=data) as download:
                module.install(root,'nano-limbo',{'SERVER_JARFILE':'custom.jar'})
                receipt=root/'.voltra/limbo/release.json';receipt.chmod(0o640);receipt_before=receipt.stat()
                module.install(root,'nano-limbo',{'SERVER_JARFILE':'custom.jar'})
                self.assertEqual(download.call_count,1)
            self.assertEqual(config.read_bytes(),original)
            self.assertEqual((config.stat().st_mode,config.stat().st_uid,config.stat().st_gid),(before.st_mode,before.st_uid,before.st_gid))
            self.assertEqual((receipt.stat().st_mode,receipt.stat().st_uid,receipt.stat().st_gid),(receipt_before.st_mode,receipt_before.st_uid,receipt_before.st_gid))
            self.assertEqual(json.loads(receipt.read_text())['class_major'],65)
            self.assertNotIn('private-download',receipt.read_text())

    def test_custom_url_and_explicit_version_are_not_silently_replaced_by_latest(self):
        custom=module.select_release('nano-limbo',{'DOWNLOAD_URL':'https://example.org/private-name.jar','DOWNLOAD_SHA256':'A'*64,'VERSION':'not-used'})
        self.assertEqual(custom['url'],'https://example.org/private-name.jar');self.assertEqual(custom['sha256'],'a'*64)
        with patch.object(module,'fetch',side_effect=ValueError('release not found')):
            with self.assertRaisesRegex(ValueError,'release not found'):module.select_release('nano-limbo',{'VERSION':'missing'})

    def test_invalid_jar_never_replaces_existing_program_or_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'server.jar').write_bytes(b'operator program')
            with patch.object(module,'select_release',return_value={'url':'https://example.org/x.jar','sha256':'','version':'custom'}),patch.object(module,'fetch',return_value=b'not a jar'):
                with self.assertRaises(zipfile.BadZipFile):module.install(root,'nano-limbo',{})
            self.assertEqual((root/'server.jar').read_bytes(),b'operator program');self.assertFalse((root/'settings.yml').exists())

    def test_bad_checksum_and_invalid_filename_are_rejected_before_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(module,'fetch',return_value=jar()):
                with self.assertRaisesRegex(ValueError,'checksum'):module.install(root,'nano-limbo',{})
                for filename in ['../outside.jar','/absolute.jar','bad".jar','a.jar;id']:
                    with self.subTest(filename=filename),self.assertRaises(ValueError):module.install(root,'nano-limbo',{'SERVER_JARFILE':filename})
            self.assertFalse((root/'server.jar').exists())

    def test_symlink_config_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root=Path(directory);(root/'settings.yml').symlink_to(Path(outside)/'operator.yml')
            data=jar()
            with patch.object(module,'select_release',return_value={'url':'https://example.org/x.jar','sha256':'','version':'custom'}),patch.object(module,'fetch',return_value=data):
                with self.assertRaisesRegex(ValueError,'leaves'):module.install(root,'nano-limbo',{})
            self.assertFalse((root/'server.jar').exists())

    def test_public_https_validation_rejects_credentials_and_private_redirects(self):
        for url in ['http://example.org/x','https://user:pass@example.org/x','https://example.org/x#fragment','https://example.org:444/x']:
            with self.subTest(url=url),self.assertRaises(ValueError):module.public_url(url)
        with patch.object(module.socket,'getaddrinfo',return_value=[(None,None,None,None,('127.0.0.1',443))]):
            with self.assertRaises(ValueError):module.public_url('https://public.example/x')

    def test_unsupported_class_and_oversized_default_configuration_rejected(self):
        with self.assertRaises(ValueError):module.inspect_jar(jar(major=70),'nano-limbo')
        self.assertEqual(module.inspect_jar(jar(major=69),'nano-limbo')[3],69)
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as package:
            package.writestr('META-INF/MANIFEST.MF','x'*65537)
        with self.assertRaisesRegex(ValueError,'manifest'):module.inspect_jar(output.getvalue(),'nano-limbo')
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as package:
            package.writestr('META-INF/MANIFEST.MF','Main-Class: example.Server\r\n')
            package.writestr('example/Server.class',bytes.fromhex('cafebabe00000041'))
            package.writestr('settings.yml','x'*(1024**2+1))
        with self.assertRaisesRegex(ValueError,'configuration'):module.inspect_jar(output.getvalue(),'nano-limbo')


if __name__=='__main__':unittest.main()
