import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import re
from unittest.mock import patch
import zipfile

HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('krypton_source_tests',HERE/'test-krypton-source.py');base=importlib.util.module_from_spec(s);s.loader.exec_module(base)
cache=base.cache


class CacheTests(unittest.TestCase):
    def fixture(self,root,extra=None):
        key='1'*64;identity={'platform':'linux/amd64','files':{'compiler':'abc'}}
        jar=b'fixture source JAR';jarsha=hashlib.sha256(jar).hexdigest()
        files={'Krypton.jar':jar,'config.conf':b'port=25565',
               'licenses/krypton-repaired-source/build-provenance.json':json.dumps({'sha256':jarsha,'config_only_exit_code':0,'native_verified':False}).encode()}
        if extra:files.update(extra)
        manifest={'context_sha256':key,'context':identity,'native_verified':False,'publisher_release':False,
                  'files':{k:{'sha256':hashlib.sha256(v).hexdigest(),'bytes':len(v)} for k,v in files.items()}}
        archive=root/'bundle.zip'
        with zipfile.ZipFile(archive,'w') as z:
            for name,data in files.items():z.writestr(name,data)
            z.writestr('manifest.json',json.dumps(manifest))
        sha=hashlib.sha256(archive.read_bytes()).hexdigest();blob=root/'.voltra/public-cache'/sha;blob.parent.mkdir(parents=True);blob.write_bytes(archive.read_bytes())
        pins={'available':True,'context_sha256':key,'bundle_sha256':sha,'bundle_bytes':archive.stat().st_size,'jar_sha256':jarsha}
        (root/'krypton-source-cache.json').write_text(json.dumps(pins));ready=root/'ready';ready.mkdir()
        return key,identity,blob,ready

    def restore(self,root,key,identity,ready):
        with patch.object(cache,'__file__',str(root/'helper.py')),patch.object(cache,'context',return_value=(key,identity)),patch.object(cache.platform,'system',return_value='Linux'),patch.object(cache.platform,'machine',return_value='x86_64'):
            return cache.restore(root,ready)

    def test_verified_cache_independent_output_and_no_publisher_claim(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);key,identity,blob,ready=self.fixture(root);before=blob.read_bytes()
            jar,proof=self.restore(root,key,identity,ready);self.assertEqual(jar.read_bytes(),b'fixture source JAR');self.assertFalse(proof['native_verified'])
            jar.write_bytes(b'operator changed');self.assertEqual(blob.read_bytes(),before)
            self.assertIn('not publisher release',proof['source_output_cache']['origin'])

    def test_absent_or_stale_source_cache_returns_compile_path(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);key,identity,blob,ready=self.fixture(root)
            self.assertIsNone(self.restore(root,'changed-source',identity,ready));blob.unlink()
            self.assertIsNone(self.restore(root,key,identity,ready));self.assertEqual(list(ready.iterdir()),[])

    def test_corruption_fails_closed_before_publication(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);key,identity,blob,ready=self.fixture(root);blob.write_bytes(blob.read_bytes()[:-1]+b'x')
            with self.assertRaisesRegex(ValueError,'immutable bundle'):self.restore(root,key,identity,ready)
            self.assertEqual(list(ready.iterdir()),[])

    def test_operator_state_and_traversal_rejected(self):
        for name in ('world/level.dat','../config.conf','licenses/../state','licenses/link\\name'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as d:
                root=Path(d);key,identity,blob,ready=self.fixture(root,{name:b'never publish'})
                # ZipInfo normalizes backslashes on Windows, so this case is also covered
                # by raw-name archive fixtures in test-krypton-registry.py.
                if '\\' in name:continue
                with self.assertRaises(ValueError):self.restore(root,key,identity,ready)
                self.assertEqual(list(ready.iterdir()),[])

    def test_context_includes_exact_compiler_inputs(self):
        key,identity=cache.context();self.assertRegex(key,'^[a-f0-9]{64}$')
        for file in ('krypton-source-releases.json','krypton-source-build.py','krypton-registry-data.py','KryptonRegistrySupplement.java','krypton-config.py','krypton-gradle-verification.xml'):
            self.assertIn(file,identity['files'])

    def test_actual_installer_import_aliases_preserve_context_bytes(self):
        stage=Path('.local/java-forks/profiles.json')
        if not stage.exists():self.skipTest('Generate five-profile stage first')
        script=json.loads(stage.read_text())['minecraft/java/krypton/egg-krypton.json']['egg']['scripts']['installation']['script']
        expected=cache.context()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for name,text in re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_FORK_SOURCE'\n(.*?)VOLTRA_FORK_SOURCE\n",script,re.S):
                (root/name).write_bytes(text.encode())
            for imported,source in re.findall(r'cp \.voltra/([^ ]+) \.voltra/([^\n]+)',script):
                (root/source).write_bytes((root/imported).read_bytes())
            with patch.object(cache,'__file__',str(root/'krypton_source_cache.py')):
                self.assertEqual(cache.context(),expected)

    def test_raw_crlf_and_actual_wings_lf_context_match_exact_six_texts(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);raw=root/'raw';staged=root/'wings-lf';raw.mkdir();staged.mkdir()
            for file in cache.INPUTS:
                text=(base.base.SCRIPTS/file).read_bytes().replace(b'\r\n',b'\n')
                (raw/file).write_bytes(text.replace(b'\n',b'\r\n'));(staged/file).write_bytes(text)
            with patch.object(cache,'__file__',str(raw/'helper.py')):before=cache.context()
            with patch.object(cache,'__file__',str(staged/'helper.py')):after=cache.context()
            self.assertEqual(before,after);self.assertEqual(after[1]['schema'],2)
            # A content change remains a different context; no whitespace stripping.
            file=staged/cache.INPUTS[0];file.write_bytes(file.read_bytes()+b' ')
            with patch.object(cache,'__file__',str(staged/'helper.py')):self.assertNotEqual(cache.context(),after)


if __name__=='__main__':unittest.main()
