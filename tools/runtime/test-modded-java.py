import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

ROOT=Path(__file__).resolve().parents[2]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
minecraft=load('minecraft_install','internal/panel/game_library/minecraft-install.py')
load('limbo_install','internal/panel/game_library/scripts/limbo-install.py')
adapter=load('modded_java','internal/panel/game_library/scripts/modded-java-install.py')
sys.modules['modded_java_install']=adapter
spigot=load('spigot_build','internal/panel/game_library/scripts/spigot-build-install.py')


class ModdedJavaTests(unittest.TestCase):
    def test_pinned_defaults_and_validation(self):
        for loader in ('fabric','quilt','forge','neoforge'):
            plan=adapter.resolve(loader,{'MC_VERSION':'latest'})
            self.assertEqual(plan['version'],'26.3');self.assertEqual(plan['java'],25)
            self.assertEqual(plan['installer']['algorithm'],'sha256')
            self.assertRegex(plan['installer']['hash'],r'^[0-9a-f]{64}$')
            self.assertRegex(plan['installer']['publisher_sha1'],r'^[0-9a-f]{40}$')
        with self.assertRaises(ValueError):adapter.resolve('forge',{'BUILD_TYPE':'surprise'})
        with self.assertRaises(ValueError):adapter.resolve('forge',{'FORGE_VERSION':'66.1.0'})
        with self.assertRaises(ValueError):adapter.resolve('neoforge',{'NEOFORGE_VERSION':'../../26.3'})

    def test_original_fabric_installer_and_snapshot_controls(self):
        def metadata(url):
            if '/loader/' in url:return [{'loader':{'version':'0.20.1','stable':False}},{'loader':{'version':'0.19.5','stable':True}}]
            return [{'version':'1.1.2','stable':True,'url':'https://maven.fabricmc.net/new.jar'},{'version':'1.1.1','stable':False,'url':'https://maven.fabricmc.net/old.jar'}]
        with mock.patch.object(adapter,'game_release',return_value=('26.4-snapshot-5',25,{})),mock.patch.object(adapter,'metadata',side_effect=metadata),mock.patch.object(adapter,'checked_maven',side_effect=lambda url:{'url':url}):
            plan=adapter.resolve('fabric',{'MC_VERSION':'snapshot','LOADER_VERSION':'snapshot','FABRIC_VERSION':'1.1.1'})
            self.assertEqual(plan['loader_version'],'0.20.1');self.assertEqual(plan['installer_version'],'1.1.1');self.assertTrue(plan['installer']['url'].endswith('old.jar'))

    def test_explicit_forge_override_and_old_neoforge_namespace(self):
        def release(version):return version,17,{}
        with mock.patch.object(adapter,'game_release',side_effect=release),mock.patch.object(adapter,'checked_maven',side_effect=lambda url:{'url':url}):
            forge=adapter.resolve('forge',{'MC_VERSION':'26.3','FORGE_VERSION':'1.20.1-47.4.0'})
            self.assertEqual(forge['version'],'1.20.1');self.assertIn('/1.20.1-47.4.0/',forge['installer']['url'])
            neo=adapter.resolve('neoforge',{'MC_VERSION':'26.3','NEOFORGE_VERSION':'1.20.1-47.1.106'})
            self.assertEqual(neo['version'],'1.20.1');self.assertIn('net/neoforged/forge/1.20.1-',neo['launch'])
        self.assertEqual(adapter.neo_game('26.3.0.95'),'26.3')
        self.assertEqual(adapter.neo_game('21.1.264'),'1.21.1')
        with self.assertRaises(ValueError):adapter.neo_game('26.3.95')

    def test_forge_exact_promotion_keys_and_recommended_fallback(self):
        with mock.patch.object(adapter,'game_release',return_value=('1.20.1',17,{})),mock.patch.object(adapter,'metadata',return_value={'promos':{'1.20.1-latest':'47.4.0','1.20.10-recommended':'wrong'}}),mock.patch.object(adapter,'checked_maven',side_effect=lambda url:{'url':url}):
            plan=adapter.resolve('forge',{'MC_VERSION':'1.20.1','BUILD_TYPE':'recommended'})
            self.assertEqual(plan['loader_version'],'47.4.0')

    def test_staging_publish_preserves_operator_data_and_eula(self):
        def install(plan,root,work_directory=None):
            self.assertTrue(root.is_relative_to(work_directory))
            (root/'server.jar').write_bytes(b'vanilla');(root/'fabric-server-launch.jar').write_bytes(b'launcher')
            (root/'eula.txt').write_text('eula=true\n');(root/'server.properties').write_text('replacement')
            (root/'mods').mkdir();(root/'mods/never.jar').write_bytes(b'never')
        with tempfile.TemporaryDirectory() as directory,mock.patch.object(minecraft,'install',side_effect=install):
            root=Path(directory);(root/'eula.txt').write_text('eula=false\n');(root/'server.properties').write_text('motd=operator\n');(root/'mods').mkdir();(root/'mods/user.jar').write_bytes(b'user')
            (root/'world').mkdir();(root/'world/level.dat').write_bytes(b'world')
            before={p.relative_to(root).as_posix():(p.read_bytes(),p.stat().st_mode,p.stat().st_uid,p.stat().st_gid) for p in root.rglob('*') if p.is_file()}
            adapter.install('fabric',root,{'SERVER_JARFILE':'custom.jar'})
            for name,proof in before.items():
                p=root/name;self.assertEqual((p.read_bytes(),p.stat().st_mode,p.stat().st_uid,p.stat().st_gid),proof)
            self.assertEqual((root/'custom.jar').read_bytes(),b'launcher');self.assertEqual((root/'minecraft-server.jar').read_bytes(),b'vanilla');self.assertFalse((root/'mods/never.jar').exists())
            self.assertEqual(json.loads((root/'.voltra/modded-java/release.json').read_text())['program_launch'],'custom.jar')
            adapter.install('fabric',root,{'SERVER_JARFILE':'custom.jar'})
            self.assertEqual(minecraft.install.call_count,1)
            (root/'custom.jar').write_bytes(b'corrupt')
            adapter.install('fabric',root,{'SERVER_JARFILE':'custom.jar'})
            self.assertEqual(minecraft.install.call_count,2)

    def test_publish_rolls_back_program_files_on_write_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'root';root.mkdir();staging=Path(directory)/'staging';staging.mkdir()
            for name in ('first.jar','launch.jar'):(root/name).write_bytes(b'old');(staging/name).write_bytes(b'new')
            real=adapter.write
            def write(path,data):
                if path.name=='launch.jar':raise OSError('fixture disk failure')
                real(path,data)
            with mock.patch.object(adapter,'write',side_effect=write),self.assertRaises(OSError):adapter.publish(staging,root,'launch.jar')
            for name in ('first.jar','launch.jar'):self.assertEqual((root/name).read_bytes(),b'old')

    def test_prevalidation_rejects_symlink_before_any_program_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'root';root.mkdir();staging=Path(directory)/'staging';staging.mkdir();(root/'first.jar').write_bytes(b'old');(staging/'first.jar').write_bytes(b'new');(staging/'libraries').mkdir();(staging/'libraries/file.jar').write_bytes(b'new');(root/'libraries').symlink_to(Path(directory),target_is_directory=True)
            with self.assertRaises(ValueError):adapter.publish(staging,root,'first.jar')
            self.assertEqual((root/'first.jar').read_bytes(),b'old')

    def test_spigot_official_source_build_and_verified_cache(self):
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as package:package.writestr('META-INF/MANIFEST.MF','Manifest-Version: 1.0\nMain-Class: fixture.Main\n')
        tool=b'fixture official BuildTools'
        pins={'version':'26.3','java':25,'source':{'refs':{'Spigot':'reviewed'},'javaVersions':[69,70]},'buildtools':{'url':'https://hub.spigotmc.org/build.jar','hash':adapter.hashlib.sha256(tool).hexdigest()}}
        def run(command,cwd,**kwargs):
            self.assertIn('--rev',command);self.assertNotIn('shell',kwargs)
            target=Path(command[command.index('--output-dir')+1]);(target/'server.jar').write_bytes(output.getvalue())
        with tempfile.TemporaryDirectory() as directory,mock.patch.dict(spigot.PINS,spigot=pins),mock.patch.object(spigot,'metadata',return_value=pins['source']),mock.patch.object(spigot,'fetch',return_value=tool),mock.patch.object(minecraft,'bootstrap_java',return_value='/java'),mock.patch.object(spigot.subprocess,'run',side_effect=run) as command:
            root=Path(directory);(root/'eula.txt').write_text('eula=false\n')
            spigot.install(root,{'DL_VERSION':'26.3','SERVER_JARFILE':'custom.jar'})
            self.assertEqual((root/'custom.jar').read_bytes(),output.getvalue());self.assertEqual((root/'eula.txt').read_text(),'eula=false\n')
            spigot.install(root,{'DL_VERSION':'26.3','SERVER_JARFILE':'custom.jar'})
            self.assertEqual(command.call_count,1)

    def test_spigot_publication_uses_server_disk_when_system_tmp_is_unavailable(self):
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as package:
            package.writestr('META-INF/MANIFEST.MF','Main-Class: fixture.Main\n')
        temporary_directory=tempfile.TemporaryDirectory
        with temporary_directory() as directory:
            root=Path(directory)
            def server_disk_only(*args,**kwargs):
                self.assertTrue(Path(kwargs['dir']).resolve().is_relative_to(root))
                return temporary_directory(*args,**kwargs)
            with mock.patch.object(spigot,'fetch',return_value=output.getvalue()),mock.patch.object(spigot.tempfile,'TemporaryDirectory',side_effect=server_disk_only):
                spigot.install(root,{'DL_PATH':'https://example.invalid/server.jar'})
            self.assertEqual((root/'server.jar').read_bytes(),output.getvalue())
            self.assertTrue((root/'.voltra/spigot/release.json').is_file())
            self.assertEqual(list(root.glob('.voltra-spigot-publish-*')),[])

    def test_spigot_original_custom_url_is_data_not_shell(self):
        self.assertEqual(spigot.download_url('https://example.invalid/{{DL_VERSION}}/${DL_VERSION}.jar','1.21.11'),'https://example.invalid/1.21.11/1.21.11.jar')
        with self.assertRaises(ValueError):spigot.download_url('https://example.invalid/{{UNKNOWN}}','26.3')
        with tempfile.TemporaryDirectory() as directory,mock.patch.object(spigot,'fetch',return_value=b'invalid'):
            root=Path(directory);(root/'server.jar').write_bytes(b'old program')
            with self.assertRaises(ValueError):spigot.install(root,{'DL_PATH':'https://example.invalid/server.jar','DOWNLOAD_SHA256':'0'*64})
            self.assertEqual((root/'server.jar').read_bytes(),b'old program')


if __name__=='__main__':unittest.main()
