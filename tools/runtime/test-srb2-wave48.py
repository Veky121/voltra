"""Source fixtures. Every process/network/acquisition boundary is mocked."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'internal/panel/game_library/scripts'
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
load('steam_template',BASE/'steam-template.py');load('additional_survival_install',BASE/'additional-survival-install.py');load('native_console',BASE/'native-console.py')
game=load('srb2_wave48',BASE/'sonic-rimworld.py')
stager=load('srb2_stage48',ROOT/'tools/runtime/stage-srb2-wave48.py')
ENV=dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010',SRB2_VERSION='2.2.15')

class SRB2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        for obj,name in [(game,'get'),(game.release,'download'),(game.publisher,'extract_zip'),(game.release,'extract'),(game.subprocess,'run'),(game,'bundle_libraries'),(game,'run')]:
            p=patch.object(obj,name,side_effect=AssertionError('unmocked boundary '+name));p.start();self.addCleanup(p.stop)
        # Windows has no fchown; metadata adapter only, not a POSIX ownership claim.
        p=patch('os.fchown',create=True);p.start();self.addCleanup(p.stop)
        p=patch('os.fchmod',side_effect=lambda fd,mode:None,create=True);p.start();self.addCleanup(p.stop)
        p=patch('os.chown',create=True);p.start();self.addCleanup(p.stop)
    def test_refusal_before_any_operator_write_or_acquisition(self):
        path=self.root/'adedserv.cfg';path.write_bytes(b'// operator\r\ncustom \xff\n')
        for key,value in [('SRB2_VERSION','2.2.14'),('SERVER_PORT','28011'),('MAX_PLAYERS','33'),('SRV_PW','bad\nquit'),('REGISTER_SERVER','yes')]:
            with self.subTest(key=key),self.assertRaises(ValueError):game.install(self.root,'sonic',{**ENV,key:value})
            self.assertEqual(path.read_bytes(),b'// operator\r\ncustom \xff\n');self.assertFalse((self.root/'.voltra').exists())
    def test_invalid_native_destination_does_not_rewrite_authority(self):
        path=self.root/'adedserv.cfg';path.write_bytes(b'operator old\n')
        native=self.root/'ServerData/.srb2/adedserv.cfg';native.mkdir(parents=True)
        with self.assertRaises(ValueError):game.configure(self.root,'sonic',ENV)
        self.assertEqual(path.read_bytes(),b'operator old\n')
    def test_invalid_native_parent_does_not_rewrite_authority(self):
        path=self.root/'adedserv.cfg';path.write_bytes(b'operator old\n')
        parent=self.root/'ServerData/.srb2';parent.parent.mkdir();parent.write_bytes(b'not directory')
        with self.assertRaises(ValueError):game.configure(self.root,'sonic',ENV)
        self.assertEqual(path.read_bytes(),b'operator old\n')
    def test_unknown_bytes_repeated_commands_and_private_port(self):
        path=self.root/'adedserv.cfg';unknown=b'// comment \xff\r\nexec "mods/a.cfg"\r\nexec "mods/b.cfg"\ncustom "x;y"\n'
        path.write_bytes(unknown+b'SERVERNAME "stale"\npassword "stale"\n')
        argv,_,_,stop=game.configure(self.root,'sonic',{**ENV,'SRV_PW':'fixture-secret'})
        self.assertTrue(path.read_bytes().startswith(unknown));self.assertNotIn(b'stale',path.read_bytes())
        self.assertEqual((self.root/'ServerData/.srb2/adedserv.cfg').read_bytes(),path.read_bytes())
        self.assertNotIn('-room',argv);self.assertEqual(argv[argv.index('-port')+1],'28010');self.assertEqual(stop,'quit')
    def test_latest_new_release_refused_before_download_and_state(self):
        with patch.object(game,'selected',return_value={'version':'SRB2_release_9.0'}):
            with self.assertRaises(ValueError):game.install(self.root,'sonic',{**ENV,'SRB2_VERSION':'latest'})
        self.assertEqual(list(self.root.iterdir()),[])
    def test_mock_install_update_success_and_failure_preserve_saves_mods(self):
        protected={'adedserv.cfg':b'// operator\xff','ServerData/save.dat':b'save','SRB2/addons/mod.pk3':b'mod'}
        for name,data in protected.items():
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
        def extract_zip(archive,target):
            for name in ['srb2.pk3','zones.pk3','characters.pk3','LICENSE.txt','LICENSE-3RD-PARTY.txt','README.txt']:(target/name).write_bytes(b'asset')
        def build(*args,**kwargs):
            p=kwargs['cwd']/'bin/lsrb2d';p.parent.mkdir();p.write_bytes(b'mocked executable')
        with patch.object(game.release,'download'),patch.object(game.publisher,'extract_zip',side_effect=extract_zip),patch.object(game.release,'extract'),patch.object(game.subprocess,'run',side_effect=build),patch.object(game,'bundle_libraries'):
            game.install(self.root,'sonic',ENV);game.install(self.root,'sonic',ENV)
            with patch.object(game.subprocess,'run',side_effect=RuntimeError('mock build failure')):
                with self.assertRaises(RuntimeError):game.install(self.root,'sonic',ENV)
        for name,data in protected.items():self.assertEqual((self.root/name).read_bytes(),data)
        self.assertEqual((self.root/'SRB2/lsrb2d').read_bytes(),b'mocked executable')
    def test_exact_emitted_geometry_and_profile_preservation(self):
        profile=stager.stage();old=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text())[stager.RECIPE]
        script=profile['egg']['scripts']['installation']['script']
        import re
        files=dict(re.findall(r"cat > (\S+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE",script,re.S))
        self.assertIn('.voltra/sonic_rimworld.py',files)
        self.assertEqual(files['.voltra/sonic_rimworld.py'],(BASE/'sonic-rimworld.py').read_text())
        for name in ['steam_template.py','additional_survival_install.py','native_console.py','native-release.py','small-native-install.py','sonic-rimworld-releases.json','sonic-rimworld-licenses.json']:self.assertIn('.voltra/'+name,files)
        old['egg']['scripts']['installation']['script']=script
        self.assertEqual(profile,old)

if __name__=='__main__':unittest.main(verbosity=2)
