"""Offline config and release fixtures, never native acceptance claims."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'internal/panel/game_library/scripts'
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
load('steam_template','steam-template.py');load('additional_survival_install','additional-survival-install.py');load('native_console','native-console.py');game=load('sonic_rimworld','sonic-rimworld.py')

class DedicatedConfigTests(unittest.TestCase):
    def test_sonic_preserves_advanced_commands_and_confines_private_registration(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);p=root/'adedserv.cfg';p.write_text('// operator setting\nsv_allowdownload 0\nservername "old"\npassword "old"\nmaxplayers 10\n');p.chmod(0o640)
            argv,env,cwd,stop=game.configure(root,'sonic',dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010',SRV_NAME='Literal $ server',SRV_PW='fixtureprivate',MAX_PLAYERS='8',ROOM_NR='33'))
            self.assertEqual(p.stat().st_mode&0o777,0o640);self.assertIn('sv_allowdownload 0',p.read_text());self.assertIn('servername "Literal $ server"',p.read_text());self.assertIn('clearpassword\npassword "fixtureprivate"',p.read_text())
            self.assertNotIn('-room',argv);self.assertIn('masterserver_room_id -1',p.read_text());self.assertEqual(argv[-2:],['+exec',str(root/'ServerData/.srb2/adedserv.cfg')]);self.assertEqual((root/'ServerData/.srb2/adedserv.cfg').read_bytes(),p.read_bytes());self.assertEqual(cwd,root/'SRB2');self.assertEqual(stop,'quit')
            argv,_,_,_=game.configure(root,'sonic',dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010',REGISTER_SERVER='true',ROOM_NR='28'))
            self.assertEqual(argv[argv.index('-room')+1],'28')
    def test_sonic_rejects_console_injection_and_native_player_overflow(self):
        with tempfile.TemporaryDirectory() as directory:
            for key,value in [('SRV_NAME','quote";quit'),('SRV_PW','bad\nquit'),('MAX_PLAYERS','33'),('REGISTER_SERVER','yes')]:
                with self.assertRaises(ValueError):game.configure(Path(directory),'sonic',dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010',**{key:value}))
    def test_openworld_preserves_unknown_keys_and_every_original_control(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);p=root/'Data/Config.json';p.parent.mkdir();p.write_text('{"OperatorExtra":{"key":"literal"},"ServerPort":1}');p.chmod(0o640)
            e=dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010',MAX_PLAYERS='17',PLAYER_VERSION='1.2',**{key:'true' for key in ['ENFORCE_MODS','USE_MOD_BLACKLIST','USE_CUSTOM_DIFF','WHITELIST','CUSTOM_SCEN']})
            argv,env,cwd,stop=game.configure(root,'openworld',e);data=json.loads(p.read_text())
            self.assertEqual(data['OperatorExtra'],{'key':'literal'});self.assertEqual(data['ServerPort'],28010);self.assertEqual(data['MaxPlayers'],17);self.assertEqual(data['PlayerVersion'],'1.2')
            for key in ['EnforceMods','UseModBlacklist','UseCustomDifficulty','UseWhitelist','AllowCustomScenarios']:self.assertIs(data[key],True)
            self.assertEqual(p.stat().st_mode&0o777,0o640);self.assertEqual(argv[-1],str(root/'OpenWorldServer.dll'));self.assertEqual(env['DOTNET_ROLL_FORWARD'],'Major');self.assertEqual(stop,'shutdown')
    def test_together_maps_current_schema_without_changing_operator_options(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);p=root/'Configs/ServerConfig.json';p.parent.mkdir();p.write_text('{"Description":"operator description","UseClientSave":false}');p.chmod(0o640)
            with patch.dict(os.environ,{'PYTHONHOME':'parent','PYTHONPATH':'parent','LD_PRELOAD':'untrusted.so'}):
                argv,env,cwd,stop=game.configure(root,'together',dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010',VERBOSE='true',MAX_PLAYERS='9',SERVER_NAME='Literal $ & server'))
            data=json.loads(p.read_text());self.assertEqual(data['Verbosity'],2);self.assertEqual(data['MaxPlayers'],9);self.assertEqual(data['Name'],'Literal $ & server');self.assertFalse(data['EnableServerBrowser']);self.assertFalse(data['EnableServerTelemetry']);self.assertFalse(data['UseUPnP']);self.assertFalse(data['UseClientSave']);self.assertEqual(data['Description'],'operator description')
            self.assertEqual(p.stat().st_mode&0o777,0o640);self.assertNotIn('PYTHONHOME',env);self.assertNotIn('LD_PRELOAD',env);self.assertEqual(stop,'quit')
    def test_unallocated_ports_and_escape_directories_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root=Path(directory)
            with self.assertRaises(ValueError):game.configure(root,'together',dict(SERVER_PORT='28011',VOLTRA_ALLOCATED_PORTS='28010'))
            (root/'Configs').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):game.configure(root,'together',dict(SERVER_PORT='28010',VOLTRA_ALLOCATED_PORTS='28010'))
            self.assertFalse((Path(outside)/'ServerConfig.json').exists())
    def test_pinned_and_latest_release_identity_and_alternate_https_hash(self):
        self.assertEqual(game.selected('sonic','2.2.15'),game.PINNED['sonic'])
        with patch.object(game,'get',return_value=json.dumps({'tag_name':game.PINNED['together']['version']}).encode()):self.assertEqual(game.selected('together','latest'),game.PINNED['together'])
        payload=b'official alternate fixture';metadata={'tag_name':'v0.9','assets':[{'name':'linux-x64.zip','browser_download_url':'https://github.com/D12-Dev/OpenWorld/releases/download/v0.9/linux-x64.zip','size':len(payload),'digest':None}]}
        with tempfile.TemporaryDirectory() as directory,patch.object(game,'get',side_effect=[json.dumps(metadata).encode(),payload]):
            result=game.selected('openworld','v0.9',Path(directory));self.assertEqual((Path(directory)/result['sha256']).read_bytes(),payload)
        with self.assertRaises(ValueError):game.selected('together','../../invalid')
    def test_profiles_preserve_all_original_variables_and_existing_review_status(self):
        catalog=json.loads((ROOT/'internal/panel/game_library/upstream/catalog.json').read_text());old=json.loads((ROOT/'internal/panel/game_library/overrides.json').read_text());profiles=json.loads((ROOT/'.local/sonic-rimworld/profiles.json').read_text())
        self.assertEqual(len(profiles),3)
        for path,profile in profiles.items():
            entry=next(x for x in catalog['entries'] if x['path']==path);self.assertEqual(profile['upstream_sha256'],entry['sha256']);self.assertEqual(profile['verification'],old.get(path,{}).get('verification','not_verified'))
            names={v['env_variable'] for v in profile['egg']['variables']};self.assertTrue(all(v['env_variable'] in names for v in entry['egg']['variables']));self.assertEqual(profile['required_ports'],1)

if __name__=='__main__':unittest.main()
