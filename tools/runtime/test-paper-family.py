import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT=Path('/source/internal/panel/game_library')
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);sys.modules[name]=value;spec.loader.exec_module(value);return value
module('minecraft_install',ROOT/'minecraft-install.py')
module('limbo_install',ROOT/'scripts/limbo-install.py')
installer=module('paper_family_install',ROOT/'scripts/paper-family-install.py')

def jar():
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as package:
        package.writestr('META-INF/MANIFEST.MF','Main-Class: example.Server\r\n')
        package.writestr('example/Server.class',bytes.fromhex('cafebabe00000034'))
    return output.getvalue()

class PaperFamilyTests(unittest.TestCase):
    def test_defaults_pin_official_exact_identity_and_strong_hash(self):
        for project in ['paper','folia','purpur']:
            release=installer.select_release(project,{},'custom.jar')
            self.assertRegex(release['sha256'],r'^[0-9a-f]{64}$')
            self.assertTrue(release['build'].isdigit());self.assertNotIn('/latest',release['url'])
        self.assertEqual(installer.PINNED['folia']['version'],'1.21.11')

    def test_custom_download_placeholders_are_data_and_keep_original_controls(self):
        env={'DL_PATH':'https://example.org/{{PROJECT}}/${MINECRAFT_VERSION}/{{BUILD_NUMBER}}/{{SERVER_JARFILE}}?token=private','MINECRAFT_VERSION':'1.20.4','BUILD_NUMBER':'123','DOWNLOAD_SHA256':'A'*64}
        r=installer.select_release('purpur',env,'custom.jar')
        self.assertEqual(r['url'],'https://example.org/purpur/1.20.4/123/custom.jar?token=private');self.assertEqual(r['hash'],'a'*64)
        with self.assertRaises(ValueError):installer.custom_url('https://example.org/{{UNKNOWN}}','paper','26.3','214','x.jar')

    def test_exact_build_does_not_accept_substring_or_silent_latest(self):
        with patch.object(installer,'metadata',return_value={'id':210}):
            with self.assertRaisesRegex(ValueError,'different build'):installer.select_release('paper',{'MINECRAFT_VERSION':'1.20.4','BUILD_NUMBER':'21'},'x.jar')
        with patch.object(installer,'metadata',side_effect=ValueError('missing release')):
            with self.assertRaisesRegex(ValueError,'missing release'):installer.select_release('folia',{'MINECRAFT_VERSION':'missing','BUILD_NUMBER':'1'},'x.jar')

    def test_explicit_other_version_latest_prefers_highest_stable_build(self):
        def build(n,channel):return {'id':n,'channel':channel,'downloads':{'server:default':{'url':'https://fill-data.papermc.io/x.jar','checksums':{'sha256':'a'*64}}}}
        with patch.object(installer,'metadata',return_value=[build(12,'ALPHA'),build(10,'STABLE'),build(11,'STABLE')]):
            r=installer.select_release('folia',{'MINECRAFT_VERSION':'1.20.4','BUILD_NUMBER':'latest'},'x.jar')
        self.assertEqual(r['build'],'11');self.assertEqual(r['channel'],'STABLE')

    def test_reinstall_preserves_operator_eula_jvm_plugins_world_and_configuration_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);files={'eula.txt':b'eula=false\r\n','server.properties':b'# operator\r\nmax-players=6\r\n','user_jvm_args.txt':b'-Doperator=yes\n','plugins/operator.jar':b'plugin','world/level.dat':b'native-world'}
            before={}
            for name,data in files.items():
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(0o600);before[name]=(p.stat().st_mode,p.stat().st_uid,p.stat().st_gid)
            data=jar();digest=hashlib.sha256(data).hexdigest();release={'project':'paper','version':'fixture','build':'1','url':'https://example.org/x.jar?token=private','algorithm':'sha256','hash':digest,'sha256':digest}
            with patch.object(installer,'select_release',return_value=release),patch.object(installer,'fetch',return_value=data) as fetch:
                installer.install(root,'paper',{'SERVER_JARFILE':'custom.jar'})
                receipt=root/'.voltra/paper-family/release.json';receipt.chmod(0o640);metadata=(receipt.stat().st_mode,receipt.stat().st_uid,receipt.stat().st_gid)
                installer.install(root,'paper',{'SERVER_JARFILE':'custom.jar'});self.assertEqual(fetch.call_count,1)
            for name,data in files.items():
                p=root/name;self.assertEqual(p.read_bytes(),data);self.assertEqual((p.stat().st_mode,p.stat().st_uid,p.stat().st_gid),before[name])
            self.assertEqual((receipt.stat().st_mode,receipt.stat().st_uid,receipt.stat().st_gid),metadata);self.assertNotIn('private',receipt.read_text())

    def test_fresh_install_does_not_silently_accept_eula(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);data=jar();r={'project':'folia','version':'fixture','build':'1','url':'https://example.org/x.jar','algorithm':'sha256','hash':'','sha256':''}
            with patch.object(installer,'select_release',return_value=r),patch.object(installer,'fetch',return_value=data):installer.install(root,'folia',{})
            self.assertFalse((root/'eula.txt').exists());self.assertTrue((root/'server.properties').exists())

    def test_checksum_or_bad_jar_never_replaces_existing_server(self):
        for data,digest in [(jar(),'a'*64),(b'bad jar','')]:
            with self.subTest(data=data[:8]),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);(root/'server.jar').write_bytes(b'previous')
                r={'project':'purpur','version':'fixture','build':'1','url':'https://example.org/x.jar','algorithm':'sha256','hash':digest,'sha256':digest}
                with patch.object(installer,'select_release',return_value=r),patch.object(installer,'fetch',return_value=data):
                    with self.assertRaises((ValueError,zipfile.BadZipFile)):installer.install(root,'purpur',{})
                self.assertEqual((root/'server.jar').read_bytes(),b'previous')

    def test_confined_paths_and_config_symlinks_fail_before_publish(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root=Path(directory)
            for name in ['../out.jar','a.jar;id','/out.jar','bad".jar']:
                with self.subTest(name=name),self.assertRaises(ValueError):installer.install(root,'paper',{'SERVER_JARFILE':name})
            (root/'server.properties').symlink_to(Path(outside)/'operator.properties')
            r={'project':'paper','version':'fixture','build':'1','url':'https://example.org/x.jar','algorithm':'sha256','hash':'','sha256':''}
            with patch.object(installer,'select_release',return_value=r),patch.object(installer,'fetch',return_value=jar()):
                with self.assertRaises(ValueError):installer.install(root,'paper',{})
            self.assertFalse((root/'server.jar').exists())

if __name__=='__main__':unittest.main()
