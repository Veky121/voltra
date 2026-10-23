import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

SCRIPTS=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,SCRIPTS/file)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    return module
load('limbo_install','limbo-install.py')
load('minecraft_pack_install','minecraft-pack-install.py')
fork=load('java_fork_install','java-fork-install.py')


class ForkTests(unittest.TestCase):
    def test_reviewed_defaults_pinned(self):
        for kind in ('glowstone','magma','spongeforge'):
            with self.subTest(kind=kind):
                result=fork.resolve(kind,{})
                self.assertRegex(result['sha256'],'^[0-9a-f]{64}$')
                self.assertGreater(result['bytes'],0)

    def test_glowstone_original_snapshot_selector(self):
        r=fork.resolve('glowstone',{'VERSION':'1.12.2-SNAPSHOT'})
        self.assertIn('repository=snapshots',r['url'])
        self.assertIn('maven.baseVersion=1.12.2-SNAPSHOT',r['url'])

    def test_github_credentials_need_original_pair(self):
        with self.assertRaisesRegex(ValueError,'both'):
            fork.resolve('glowstone',{'GITHUB_USER':'fixture'})

    def test_github_custom_package_match_and_exact_tag(self):
        with patch.object(fork,'metadata',return_value={'tag_name':'tag1','assets':[{'name':'other.txt','size':5,'browser_download_url':'https://example.invalid/other'},{'name':'GlowStone-custom.jar','size':10,'browser_download_url':'https://example.invalid/jar'}]}) as metadata:
            result=fork.github_release('Publisher/Project','tag1','glowstone.*jar')
        self.assertEqual(result['version'],'tag1')
        self.assertIn('/releases/tags/tag1',metadata.call_args.args[0])

    def test_magma_explicit_release_does_not_fallback(self):
        with patch.object(fork,'github_release',side_effect=ValueError('missing exact release')) as github:
            with self.assertRaisesRegex(ValueError,'exact'):
                fork.resolve('magma',{'MC_VERSION':'1.18.2','TAG_VERSION':'missing'})
        self.assertEqual(github.call_args.args[:2],('magmamaintained/Magma-1.18.2','missing'))

    def test_mohist_custom_template_is_data_and_checksum_retained(self):
        with patch.object(fork,'public_url',side_effect=lambda url:url):
            r=fork.resolve('mohist',{'DL_PATH':'https://publisher.invalid/{{PROJECT}}/${MC_VERSION}/${BUILD_NUMBER}.jar','PROJECT':'banner','MC_VERSION':'1.20.1','BUILD_NUMBER':'$(literal)','DOWNLOAD_SHA256':'a'*64})
        self.assertIn('banner/1.20.1/%24%28literal%29.jar',r['url'])
        self.assertEqual(r['sha256'],'a'*64)

    def test_mohist_build_id_is_exact(self):
        builds={'builds':[{'number':123,'gitSha':'a'*40,'url':'https://publisher.invalid/123','fileSha256':'a'*64},{'number':1234,'gitSha':'b'*40,'url':'https://publisher.invalid/1234','fileSha256':'b'*64}]}
        current=[{'id':12,'commit':{'hash':'a'*40},'file_sha256':'a'*64,'build_date':'2025-01-01'}]
        with patch.object(fork,'metadata',side_effect=lambda url:current if url.startswith('https://api.mohistmc.com/') else builds):
            selected=fork.resolve('mohist',{'MC_VERSION':'1.18.2','BUILD_NUMBER':'123'})
            self.assertEqual(selected['version'],'a'*40)
            self.assertEqual(selected['api_id'],12)
            with self.assertRaises(ValueError):fork.resolve('mohist',{'MC_VERSION':'1.18.2','BUILD_NUMBER':'12'})
            self.assertEqual(fork.resolve('mohist',{'MC_VERSION':'1.18.2','BUILD_NUMBER':'api:12'})['api_id'],12)

    def test_unavailable_publishers_have_explicit_prerequisites(self):
        with self.assertRaisesRegex(ValueError,'Archived'):
            fork.resolve('krypton',{'KRYPTON_VERSION':'latest','KRYPTON_DISTRIBUTION':'publisher'})
        self.assertRegex(fork.resolve('mohist',{})['sha256'],'^[0-9a-f]{64}$')

    def test_sponge_minecraft_selector_prefers_stable(self):
        xml=b'<metadata><versioning><versions><version>1.19.4-45.1.0-10.0.0</version><version>1.19.4-45.1.0-10.0.1-RC1</version></versions></versioning></metadata>'
        with patch.object(fork,'fetch',return_value=xml):
            r=fork.resolve('spongeforge',{'SF_MC_VERSION':'1.19.4'})
        self.assertEqual(r['version'],'1.19.4-45.1.0-10.0.0')
        self.assertTrue(r['url'].endswith('-universal.jar'))

    def test_sponge_exact_legacy_and_xml_declarations(self):
        r=fork.resolve('spongeforge',{'SF_MC_VERSION':'1.12.2-2838-7.4.7'})
        self.assertIn('/legacy-transfer/',r['url'])
        self.assertFalse(r['url'].endswith('-universal.jar'))
        with patch.object(fork,'fetch',return_value=b'<!DOCTYPE unsafe><metadata/>'):
            with self.assertRaises(ValueError):fork.resolve('spongeforge',{'SF_MC_VERSION':'1.19.4'})

    def test_empty_or_mod_only_jar_not_a_runnable_server(self):
        with tempfile.TemporaryDirectory() as directory:
            jar=Path(directory)/'server.jar'
            jar.write_bytes(b'')
            with self.assertRaises(zipfile.BadZipFile):fork.jar_check(jar)
            with zipfile.ZipFile(jar,'w') as archive:archive.writestr('META-INF/MANIFEST.MF','Manifest-Version:1.0\n')
            with self.assertRaises(ValueError):fork.jar_check(jar)
            fork.jar_check(jar,runnable=False)

    def test_glowstone_native_config_generation_staged_and_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'server';root.mkdir();(root/'config').mkdir();(root/'config/glowstone.yml').write_text('operator: retained\n')
            def acquire(release,path,root):
                with zipfile.ZipFile(path,'w') as archive:archive.writestr('META-INF/MANIFEST.MF','Manifest-Version:1.0\nMain-Class: fixture.Server\n')
                return 'a'*64
            def run(command,**kwargs):
                self.assertEqual(command[-1],'--generate-config');self.assertEqual(kwargs['timeout'],180)
                self.assertNotEqual(Path(kwargs['cwd']),root)
                config=Path(kwargs['cwd'])/'config/glowstone.yml';config.parent.mkdir();config.write_text('publisher: default\n')
            with patch.dict(sys.modules,{'minecraft_install':SimpleNamespace(bootstrap_java=lambda *args:'/private/java'), 'modded_java_install':SimpleNamespace()}):
                with patch.object(fork,'acquire',side_effect=acquire),patch.object(fork.subprocess,'run',side_effect=run):
                    fork.install('glowstone',root,{'SERVER_JARFILE':'custom.jar'})
            self.assertEqual((root/'config/glowstone.yml').read_text(),'operator: retained\n')
            self.assertTrue((root/'custom.jar').is_file());self.assertFalse((root/'eula.txt').exists())

    def test_existing_modern_forge_argfile_needs_no_dummy_jar(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'unix_args.txt').write_text('-Dfixture=operator\n')
            with patch.dict(sys.modules,{'minecraft_install':SimpleNamespace(),'modded_java_install':SimpleNamespace()}):
                with patch.object(fork,'resolve',side_effect=AssertionError('Unexpected network resolution')):
                    result=fork.install('spongeforge',root,{'USE_EXISTING_JAR':'true'})
            self.assertIn('operator-owned',result['source'])

    def test_existing_krypton_extracts_only_bounded_default_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with zipfile.ZipFile(root/'Krypton.jar','w') as archive:
                archive.writestr('META-INF/MANIFEST.MF','Main-Class:fixture.Server\n')
                archive.writestr('config.conf','server { port=25565 }\n')
            with patch.dict(sys.modules,{'minecraft_install':SimpleNamespace(),'modded_java_install':SimpleNamespace()}):
                fork.install('krypton',root,{'SERVER_JAR':'Krypton.jar','USE_EXISTING_JAR':'true'})
                (root/'config.conf').write_text('operator config\n')
                fork.install('krypton',root,{'SERVER_JAR':'Krypton.jar','USE_EXISTING_JAR':'true'})
            self.assertEqual((root/'config.conf').read_text(),'operator config\n')

    def test_sponge_version_change_does_not_delete_operator_mods(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'mods').mkdir();old=root/'mods/spongeforge-old.jar';old.write_bytes(b'operator')
            with patch.dict(sys.modules,{'minecraft_install':SimpleNamespace(),'modded_java_install':SimpleNamespace()}):
                with self.assertRaisesRegex(ValueError,'previous SpongeForge'):
                    fork.install('spongeforge',root,{})
            self.assertEqual(old.read_bytes(),b'operator')


if __name__=='__main__':unittest.main()
