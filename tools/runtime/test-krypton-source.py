import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import warnings
import xml.etree.ElementTree as E
import zipfile

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('fork_fixtures',HERE/'test-java-forks.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
source=base.load('krypton_source_build','krypton-source-build.py');fork=base.fork


class SourceTests(unittest.TestCase):
    def test_default_is_explicit_repair_not_publisher_binary(self):
        result=fork.resolve('krypton',{})
        self.assertTrue(result['source_build']);self.assertNotIn('url',result)
        self.assertIn('voltra-data-cb27856f',result['version'])
        with self.assertRaisesRegex(ValueError,'pinned Minecraft'):
            fork.resolve('krypton',{'KRYPTON_VERSION':'123'})
        with self.assertRaises(ValueError):fork.resolve('krypton',{'KRYPTON_DISTRIBUTION':'unknown'})

    def test_original_numeric_ci_build_retains_exact_identity(self):
        with patch.object(fork,'metadata',return_value={'artifacts':[{'relativePath':'jar/Krypton.jar'}]}) as metadata:
            result=fork.resolve('krypton',{'KRYPTON_DISTRIBUTION':'publisher','KRYPTON_VERSION':'123'})
        self.assertEqual(result['url'],'https://ci.kryptonmc.org/job/Krypton/123/artifact/jar/Krypton.jar')
        self.assertNotIn('source_build',result)
        with patch.object(fork,'metadata',side_effect=OSError('publisher unavailable')):
            with self.assertRaisesRegex(OSError,'publisher unavailable'):
                fork.resolve('krypton',{'KRYPTON_DISTRIBUTION':'publisher','KRYPTON_VERSION':'123'})

    def test_all_acquisition_inputs_have_strong_pins(self):
        for pin in [*source.RECIPE['sources'].values(),source.RECIPE['jdk'],source.RECIPE['gradle']]:
            self.assertRegex(pin['sha256'],'^[a-f0-9]{64}$');self.assertTrue(pin['url'].startswith('https://'))
        xml=(base.SCRIPTS/'krypton-gradle-verification.xml').read_bytes()
        self.assertEqual(hashlib.sha256(xml).hexdigest(),source.RECIPE['verification_sha256'])
        ns={'g':'https://schema.gradle.org/dependency-verification'}
        nodes=E.fromstring(xml)
        self.assertEqual(nodes.find('g:configuration/g:verify-metadata',ns).text,'true')
        for artifact in nodes.findall('.//g:artifact',ns):
            self.assertTrue(artifact.findall('g:sha256',ns))

    def test_unsafe_zip_entries_rejected_before_writes(self):
        for bad in ['/absolute','root/../escape','root/./dot','root\\backslash','root//empty']:
            with self.subTest(path=bad),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);archive=root/'source.zip'
                with zipfile.ZipFile(archive,'w') as z:z.writestr('root/valid','ok');z.writestr(bad,'bad')
                if '\\' in bad:
                    archive.write_bytes(archive.read_bytes().replace(b'root/backslash',b'root\\backslash'))
                destination=root/'out';destination.mkdir()
                with self.assertRaises(ValueError):source.unpack_zip(archive,destination)
                self.assertEqual(list(destination.iterdir()),[])

    def test_duplicate_link_and_special_zip_entries_rejected(self):
        for mode in ('duplicate',0o120777,0o020666):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);archive=root/'source.zip';destination=root/'out';destination.mkdir()
                with warnings.catch_warnings(),zipfile.ZipFile(archive,'w') as z:
                    warnings.simplefilter('ignore',UserWarning)
                    z.writestr('root/entry','first')
                    if mode=='duplicate':z.writestr('root/entry','second')
                    else:
                        entry=zipfile.ZipInfo('root/special');entry.external_attr=mode<<16;z.writestr(entry,'target')
                with self.assertRaises(ValueError):source.unpack_zip(archive,destination)
                self.assertEqual(list(destination.iterdir()),[])

    def test_zip_size_limit_is_preflight(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);archive=root/'source.zip';destination=root/'out';destination.mkdir()
            with zipfile.ZipFile(archive,'w') as z:z.writestr('root/file','oversized')
            with self.assertRaisesRegex(ValueError,'limits'):source.unpack_zip(archive,destination,2)
            self.assertEqual(list(destination.iterdir()),[])

    def test_data_package_is_deterministic_with_license(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);data=root/'data';data.mkdir()
            (data/'1_19_3_blocks.json').write_text('{}');(data/'LICENSE').write_text('MIT fixture')
            source.package_data(data,root/'a.jar');source.package_data(data,root/'b.jar')
            self.assertEqual((root/'a.jar').read_bytes(),(root/'b.jar').read_bytes())
            with zipfile.ZipFile(root/'a.jar') as z:self.assertEqual(z.read('META-INF/LICENSE-ArticData'),b'MIT fixture')

    def test_source_patch_requires_original_bytes_and_verification_pin(self):
        for broken in ('source','verification'):
            with self.subTest(broken=broken),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);work=root/'work';work.mkdir();volume=root/'volume';volume.mkdir()
                (root/'krypton-gradle-verification.xml').write_bytes(b'fixture allowlist')
                recipe={'sources':{'krypton':{'folder':'krypton'},'articdata':{'folder':'articdata-src'}},
                        'build_files':{'krypton/build.gradle.kts':{'original_sha256':hashlib.sha256(b'original').hexdigest(),'text':'patched'}},
                        'verification_sha256':hashlib.sha256(b'expected other allowlist').hexdigest()}
                def acquire(pin,path,volume):
                    with zipfile.ZipFile(path,'w') as z:
                        if pin['folder']=='krypton':z.writestr('publisher/build.gradle.kts',b'changed' if broken=='source' else b'original')
                        else:z.writestr('publisher/1_19_3_blocks.json',b'{}')
                with patch.object(source,'RECIPE',recipe),patch.object(source,'__file__',str(root/'helper.py')):
                    with self.assertRaisesRegex(ValueError,'original file' if broken=='source' else 'allowlist checksum'):
                        source.prepare(work,volume,acquire)
                self.assertEqual(list(volume.iterdir()),[])

    def test_jdk_link_escape_and_write_through_rejected(self):
        for kind in ('escape','through'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);archive=root/'jdk.tar.gz'
                with tarfile.open(archive,'w:gz') as z:
                    link=tarfile.TarInfo('jdk/link');link.type=tarfile.SYMTYPE;link.linkname='../../escape' if kind=='escape' else 'internal';z.addfile(link)
                    if kind=='through':
                        entry=tarfile.TarInfo('jdk/link/file');entry.size=1;z.addfile(entry,io.BytesIO(b'x'))
                with self.assertRaises(ValueError):source.unpack_jdk(archive,root/'jdk')
                self.assertEqual(list((root/'jdk').iterdir()),[])

    def test_failed_source_build_does_not_change_operator_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'config.conf').write_text('operator config')
            with patch.dict(sys.modules,{'minecraft_install':SimpleNamespace(),'modded_java_install':SimpleNamespace()}),patch.object(source,'build',side_effect=RuntimeError('compiler failed')):
                with self.assertRaisesRegex(RuntimeError,'compiler failed'):fork.install('krypton',root,{'SERVER_JAR':'custom.jar'})
            self.assertEqual((root/'config.conf').read_text(),'operator config');self.assertFalse((root/'custom.jar').exists())

    def test_source_reinstall_uses_shared_operator_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'world').mkdir();(root/'world/level.dat').write_bytes(b'operator world')
            (root/'mods').mkdir();(root/'mods/operator.jar').write_bytes(b'operator mod');(root/'config.conf').write_text('operator config')
            def build(work,volume,ready,acquire):
                work.mkdir();jar=work/'built.jar'
                with zipfile.ZipFile(jar,'w') as z:
                    z.writestr('META-INF/MANIFEST.MF','Main-Class: org.kryptonmc.krypton.KryptonKt\n');z.writestr('config.conf','publisher default')
                return jar,{'variant':'repaired-source-v1','native_verified':False}
            with patch.dict(sys.modules,{'minecraft_install':SimpleNamespace(),'modded_java_install':SimpleNamespace()}),patch.object(source,'build',side_effect=build):
                fork.install('krypton',root,{'SERVER_JAR':'custom.jar'});fork.install('krypton',root,{'SERVER_JAR':'custom.jar'})
            self.assertEqual((root/'config.conf').read_text(),'operator config')
            self.assertEqual((root/'world/level.dat').read_bytes(),b'operator world')
            self.assertEqual((root/'mods/operator.jar').read_bytes(),b'operator mod')
            receipt=json.loads((root/'.voltra/minecraft-pack/release.json').read_text())
            self.assertFalse(receipt['identity']['source_build']['native_verified'])

    @unittest.skipUnless(os.name=='posix','Linux process-group cancellation fixture')
    def test_compiler_timeout_remains_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(source.subprocess.TimeoutExpired):
                source.run_phase([sys.executable,'-c','import time;time.sleep(30)'],directory,dict(os.environ),timeout=0.05)


if __name__=='__main__':unittest.main()
