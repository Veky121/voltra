import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

BASE=Path('internal/panel/game_library/scripts')
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/file)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
load('native_config','native-config.py');runtime=load('minecraft_special_runtime','minecraft-special-runtime.py')
load('limbo_install','limbo-install.py');load('native_release','native-release.py');load('native_zip_release','native-zip-release.py')
special=load('minecraft_special_install','minecraft-special-install.py')

def jar():
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w')as z:z.writestr('META-INF/MANIFEST.MF','Main-Class: example.Server\n')
    return output.getvalue()

class Special(unittest.TestCase):
    def test_cuberite_native_ini_keeps_plugins_and_fixes_wings_alignment(self):
        text='; operator comment\n[Server] ; native section comment\nPorts   =28000\nPorts=25565\nDescription =old\nDescription=native fallback\n[Plugins]\nPlugin=Core\nPlugin =ChatLog\n[Unknown]\nOperator=keep\n'
        result=runtime.native_ini(text,{'Server':{'Ports':'28000','Description':'Voltra "Cuberite" $ + 517077'}})
        self.assertEqual(result.count('Ports='),1)
        self.assertIn('Ports=28000\n',result)
        self.assertIn('Description=Voltra "Cuberite" $ + 517077\n',result)
        self.assertIn('Plugin=Core\nPlugin=ChatLog',result)
        self.assertIn('; operator comment',result);self.assertIn('Operator=keep',result)
        with tempfile.TemporaryDirectory()as temp:
            root=Path(temp);(root/'settings.ini').write_text(text)
            runtime.configure(root,{'SERVER_PORT':'28000','WEB_PORT':'28001','SERV_DESC':'literal','ADMIN_PASS':'private-test-password'})
            self.assertEqual((root/'webadmin.ini').stat().st_mode&0o777,0o600)
            with self.assertRaises(ValueError):runtime.configure(root,{'SERVER_PORT':'28000','WEB_PORT':'28000','ADMIN_PASS':'private-test-password'})

    def test_pinned_default_and_historical_checksum(self):
        self.assertEqual(special.purpur_release({})['build'],'2654')
        with patch.object(special,'metadata',return_value={'result':'SUCCESS','build':'123'}):
            with self.assertRaises(ValueError):special.purpur_release({'MINECRAFT_VERSION':'1.21.4','BUILD_NUMBER':'123'})
            self.assertEqual(special.purpur_release({'MINECRAFT_VERSION':'1.21.4','BUILD_NUMBER':'123','DOWNLOAD_SHA256':'a'*64})['build'],'123')
        with self.assertRaises(ValueError):special.jar_name('../outside.jar')

    def test_crossplay_config_keys_secrets_and_operator_retention(self):
        with tempfile.TemporaryDirectory()as temp:
            root=Path(temp)
            with patch.object(special,'verified',return_value=jar()):special.install(root,'crossplay',{})
            config=root/'plugins/Geyser-Spigot/config.yml'
            self.assertIn('java:\n  auth-type: floodgate',config.read_text())
            self.assertIn('stun-discovery: false',config.read_text())
            self.assertEqual(config.stat().st_mode&0o777,0o600)
            config.write_text('operator-custom-config\n');key=root/'plugins/floodgate/key.pem';key.parent.mkdir();key.write_text('private-native-key')
            world=root/'world/level.dat';world.parent.mkdir();world.write_bytes(b'native-world')
            with patch.object(special,'verified',return_value=jar()):special.install(root,'crossplay',{})
            self.assertEqual(config.read_text(),'operator-custom-config\n');self.assertEqual(key.read_text(),'private-native-key');self.assertEqual(world.read_bytes(),b'native-world')

    def test_checksum_cache_and_managed_path_confinement(self):
        data=jar();release={'url':'https://example.test/server.jar','sha256':hashlib.sha256(data).hexdigest()}
        with tempfile.TemporaryDirectory()as temp,tempfile.TemporaryDirectory()as outside:
            root=Path(temp)
            with patch.object(special,'fetch',return_value=data)as fetch:
                self.assertEqual(special.verified(root,release),data);self.assertEqual(special.verified(root,release),data);self.assertEqual(fetch.call_count,1)
            with patch.object(special,'fetch',return_value=b'bad'):
                with self.assertRaises(ValueError):special.verified(root,{**release,'sha256':'a'*64})
            (root/'plugins').symlink_to(outside,target_is_directory=True)
            with patch.object(special,'verified',return_value=data):
                with self.assertRaises(ValueError):special.install(root,'crossplay',{})
            self.assertEqual(list(Path(outside).iterdir()),[])

    def test_native_programs_replace_configs_and_plugins_remain(self):
        for game,exe in [('cuberite','Cuberite'),('mcgalaxy','MCGalaxyCLI.exe')]:
            with self.subTest(game=game),tempfile.TemporaryDirectory()as temp:
                root=Path(temp);data=io.BytesIO()
                if game=='mcgalaxy':
                    with zipfile.ZipFile(data,'w')as z:z.writestr('MCGalaxy/'+exe,b'publisher')
                else:
                    with tarfile.open(fileobj=data,mode='w:gz')as z:
                        for name,value in [(exe,b'publisher'),('Plugins/Core/main.lua',b'publisher plugin')]:
                            m=tarfile.TarInfo(name);m.size=len(value);z.addfile(m,io.BytesIO(value))
                with patch.object(special,'verified',side_effect=lambda root,release: b'License' if release==special.PINS[game+'_license'] else data.getvalue()):special.install(root,game,{})
                config=root/('settings.ini'if game=='cuberite'else'properties/server.properties');config.write_text('operator-settings')
                with patch.object(special,'verified',side_effect=lambda root,release:b'License' if release==special.PINS[game+'_license'] else data.getvalue()):special.install(root,game,{})
                self.assertEqual(config.read_text(),'operator-settings')
                self.assertEqual((root/exe).read_bytes(),b'publisher')

    def test_mojang_verified_cache_reused_and_corruption_rejected(self):
        binary=b'publisher-jar';digest=hashlib.sha1(binary).hexdigest()
        meta=json.dumps({'downloads':{'server':{'url':'https://example.test/server','sha1':digest}}}).encode()
        manifest={'versions':[{'id':'1.21.4','url':'https://example.test/meta','sha1':hashlib.sha1(meta).hexdigest()}]}
        with tempfile.TemporaryDirectory()as temp:
            root=Path(temp)
            def run(command,directory):(directory/'output.jar').write_bytes(b'patched')
            with patch.object(special,'metadata',return_value=manifest),patch.object(special,'fetch',side_effect=lambda url,limit:meta if url.endswith('/meta')else binary)as fetch,patch.object(special,'build_patcher',return_value=root/'patcher.jar'),patch.object(special,'run',side_effect=run):
                special.vanillacord(root,{'VANILLA_VERSION':'1.21.4'});special.vanillacord(root,{'VANILLA_VERSION':'1.21.4'})
                self.assertEqual([x.args[0]for x in fetch.call_args_list].count('https://example.test/server'),1)
                (root/'.voltra/minecraft-special/mojang'/ (digest+'.jar')).write_bytes(b'tampered')
                with self.assertRaises(ValueError):special.vanillacord(root,{'VANILLA_VERSION':'1.21.4'})
                self.assertEqual((root/'server.jar').read_bytes(),b'patched')

    def test_mojang_metadata_mismatch_never_builds_or_replaces(self):
        with tempfile.TemporaryDirectory()as temp:
            root=Path(temp);(root/'server.jar').write_bytes(b'previous-working')
            with patch.object(special,'metadata',return_value={'versions':[{'id':'1.21.4','url':'https://example.test/meta','sha1':'0'*40}]}),patch.object(special,'fetch',return_value=b'bad'),patch.object(special,'build_patcher')as build:
                with self.assertRaises(ValueError):special.vanillacord(root,{'VANILLA_VERSION':'1.21.4'})
                build.assert_not_called();self.assertEqual((root/'server.jar').read_bytes(),b'previous-working')

if __name__=='__main__':unittest.main()
