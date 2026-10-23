"""Offline validation and preservation fixtures; native acceptance is separate."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

base=Path('internal/panel/game_library/scripts')
sys.path.insert(0,str(base.resolve()))

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,base/file)
    result=importlib.util.module_from_spec(spec);sys.modules[name]=result;spec.loader.exec_module(result);return result

module('steam_template','steam-template.py');module('native_console','native-console.py')
native=module('native_release','native-release.py');module('native_zip_release','native-zip-release.py')
runtime=module('quake_family_runtime','quake-family-runtime.py')
installer=module('etlegacy_install','etlegacy-install.py')


class QuakeFamilyTests(unittest.TestCase):
    def test_public_native_cache_is_verified_and_copied_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cache=root/'.voltra/public-cache';cache.mkdir(parents=True)
            data=b'immutable publisher archive';digest=hashlib.sha256(data).hexdigest();(cache/digest).write_bytes(data)
            target=root/'.voltra/game/stage/archive';target.parent.mkdir(parents=True)
            with patch.object(native.urllib.request,'urlopen',side_effect=AssertionError('unexpected network')):
                native.download({'url':'https://publisher.invalid/file','sha256':digest,'bytes':len(data)},target)
            self.assertEqual(target.read_bytes(),data);target.write_bytes(b'changed independent copy')
            self.assertEqual((cache/digest).read_bytes(),data)

    def test_corrupt_cache_and_symlinks_rejected_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cache=root/'cache';cache.mkdir();digest='0'*64;(cache/digest).write_bytes(b'bad')
            release={'url':'https://publisher.invalid/file','sha256':digest}
            with patch.object(native.urllib.request,'urlopen',side_effect=AssertionError('unexpected network')):
                with self.assertRaises(ValueError):native.download(release,root/'target',cache)
                (cache/digest).unlink();(cache/digest).symlink_to(root/'other')
                with self.assertRaises(ValueError):native.download(release,root/'target',cache)
            self.assertFalse((root/'target').exists())

    def game(self,root,kind):
        folder=root/kind/('q3ut4' if kind=='urbanterror' else 'etmain');folder.mkdir(parents=True)
        with zipfile.ZipFile(folder/'pak0.pk3','w') as out:
            out.writestr('maps/'+('ut4_casa' if kind=='urbanterror' else 'oasis')+'.bsp',b'native map fixture')
        return folder

    def test_urban_original_controls_retained_and_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);folder=self.game(root,'urbanterror');(folder/'server.cfg').write_bytes(b'operator config')
            env={'SERVER_PORT':'28030','SERVER_NAME':'Literal $name +value','SERVER_PASSWORD':'private +value'}
            game,argv,port=runtime.configure(env,root,'urbanterror')
            self.assertEqual(port,28030);self.assertEqual((folder/'server.cfg').read_bytes(),b'operator config')
            managed=game/'userdata/q3ut4/voltra-managed.cfg';text=managed.read_text();before=managed.stat().st_mtime_ns
            self.assertIn('set sv_hostname "Literal $name +value"',text);self.assertIn('set g_password "private +value"',text)
            self.assertIn('set bot_enable 1',text);self.assertIn('set rconpassword ""',text)
            self.assertEqual(managed.stat().st_mode&0o777,0o600)
            self.assertEqual(runtime.configure(env,root,'urbanterror')[1],argv)
            self.assertEqual(managed.stat().st_mtime_ns,before)
            self.assertLess(argv.index('server.cfg'),argv.index('voltra-managed.cfg'))

    def test_et_defaults_32_and_64_option_and_omnibot(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.game(root,'etlegacy')
            game,argv,_=runtime.configure({'SERVER_PORT':'28031'},root,'etlegacy')
            self.assertTrue(argv[0].endswith('etlded.i386'))
            _,argv,_=runtime.configure({'SERVER_PORT':'28031','ET_VERSION':'64','OMNIBOT':'1'},root,'etlegacy')
            self.assertTrue(argv[0].endswith('etlded.x86_64'))
            self.assertIn('set omnibot_enable 1',(game/'userdata/legacy/voltra-managed.cfg').read_text())
            self.assertIn('legacy/omni-bot',(game/'userdata/legacy/voltra-managed.cfg').read_text())

    def test_original_character_limits_do_not_become_ascii_only_byte_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.game(root,'urbanterror')
            env={'SERVER_PORT':'28030','SERVER_NAME':'界'*55,'JOIN_MESSAGE':'界'*50,'SERVER_PASSWORD':'界'*20,'RCON_PASSWORD':'界'*20}
            game,_,_=runtime.configure(env,root,'urbanterror')
            self.assertIn('界'*55,(game/'userdata/q3ut4/voltra-managed.cfg').read_text())

    def test_invalid_urban_controls(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.game(root,'urbanterror')
            for values in [{'EXE':'../../escape'},{'HUNKMEGS':'129'},{'SERVER_MAP':'absent'},{'SERVER_MAP':'../escape'},
                           {'SERVER_MAXCLIENTS':'33'},{'BOT_MINPLAYERS':'-1'},{'BOT_MINPLAYERS':'9','SERVER_MAXCLIENTS':'8'},
                           {'SERVER_GAMETYPE':'0'},{'SERVER_TIMELIMIT':'-1'},{'SERVER_FRIENDLYFIRE':'2'},
                           {'SERVER_NAME':'bad"quote'},{'SERVER_PASSWORD':'bad;value'},{'PUBLIC_SERVER':'2'},{'SERVER_PORT':'65536'}]:
                with self.subTest(values=values),self.assertRaises(ValueError):runtime.configure({'SERVER_PORT':'28030',**values},root,'urbanterror')

    def test_invalid_et_controls(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.game(root,'etlegacy')
            for values in [{'ET_VERSION':'arm'},{'OMNIBOT':'2'},{'MAX_PLAYERS':'65'},{'MAP':'oasis;quit'},{'MAP':'absent'}, {'RCON_PASSWORD':'bad\nquit'}]:
                with self.subTest(values=values),self.assertRaises(ValueError):runtime.configure({'SERVER_PORT':'28031',**values},root,'etlegacy')

    def test_unicode_byte_limit_and_info_rules(self):
        for value in ['bad"value','bad\nvalue','\x00','é'*128]:
            with self.assertRaises(ValueError):runtime.quoted(value)
        for value in ['bad;value','bad\\value']:
            with self.assertRaises(ValueError):runtime.quoted(value,info=True)

    def test_volume_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as external:
            root=Path(directory);(root/'urbanterror').symlink_to(external,target_is_directory=True)
            with self.assertRaises(ValueError):runtime.configure({'SERVER_PORT':'28030'},root,'urbanterror')

    def test_managed_config_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as external:
            root=Path(directory);self.game(root,'urbanterror');folder=root/'urbanterror/userdata/q3ut4';folder.mkdir(parents=True)
            (folder/'voltra-managed.cfg').symlink_to(Path(external)/'private')
            with self.assertRaises(ValueError):runtime.configure({'SERVER_PORT':'28030'},root,'urbanterror')

    def assets(self,root,broken=False):
        package=b'original data';tar=io.BytesIO()
        with tarfile.open(fileobj=tar,mode='w:gz') as archive:
            for name,payload in [('etmain/pak0.pk3',package),('Docs/EULA_Wolfenstein_Enemy_Territory.txt',b'license'),('Docs/License.rtf',b'license')]:
                member=tarfile.TarInfo('./'+name);member.size=len(payload);archive.addfile(member,io.BytesIO(payload))
        zipped=root/'fixture.zip'
        with zipfile.ZipFile(zipped,'w') as archive:archive.writestr('et260b.x86_keygen_V03.run',b'not executed\n'*401+tar.getvalue())
        def download(release,target):target.write_bytes(zipped.read_bytes())
        return download,{'pak0.pk3':('0'*64 if broken else hashlib.sha256(package).hexdigest())}

    def test_original_data_installs_without_executing_installer(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);download,packages=self.assets(root)
            with patch.object(installer,'download',side_effect=download),patch.object(installer,'PACKAGES',packages):installer.install_assets(root)
            self.assertEqual((root/'etlegacy/etmain/pak0.pk3').read_bytes(),b'original data')
            self.assertTrue((root/'etlegacy/licenses/original-et/License.rtf').is_file())

    def test_original_data_digest_failure_leaves_existing_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);download,packages=self.assets(root,broken=True)
            target=root/'etlegacy/etmain/pak0.pk3';target.parent.mkdir(parents=True);target.write_bytes(b'operator override')
            with patch.object(installer,'download',side_effect=download),patch.object(installer,'PACKAGES',packages),self.assertRaises(ValueError):installer.install_assets(root)
            self.assertEqual(target.read_bytes(),b'operator override')

    def test_original_data_reinstall_retains_operator_override_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);download,packages=self.assets(root)
            with patch.object(installer,'download',side_effect=download),patch.object(installer,'PACKAGES',packages):installer.install_assets(root)
            target=root/'etlegacy/etmain/pak0.pk3';target.write_bytes(b'operator override')
            with patch.object(installer,'download',side_effect=AssertionError('unexpected network')),patch.object(installer,'PACKAGES',packages):installer.install_assets(root)
            self.assertEqual(target.read_bytes(),b'operator override')


unittest.main()
