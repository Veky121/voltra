"""MIT. Source fixtures with no proprietary payload or Steam sessions."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),BASE/(name+'.py'));module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module);return module
load('steam-template');load('native-config');load('native-console');game=load('unreal-survival-next')
class Next(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.addCleanup(self.temp.cleanup)
        self.env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001','SERVER_QUERY_PORT':'28001'}
    def binary(self,name):
        target=self.root/game.metadata()[name]['binary'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'fixture binary');return target
    def config(self,name,env=None):return game.configure(self.root,name,{**self.env,**(env or {})})
    def test_astro_all_eleven_ini_controls_and_explicit_port(self):
        self.binary('astro');argv,_,_,_,_=self.config('astro');info=game.metadata()['astro'];content=(self.root/'AstroColony/Saved/Config/LinuxServer/ServerSettings.ini').read_text()
        entries=info['ini']['/Script/ACFeature.EHServerSubsystem'];self.assertEqual(len(entries),11)
        for key,name in entries.items():self.assertIn(key+' = '+info['defaults'][name],content)
        self.assertIn('-Port=28000',argv);self.assertIn('-QueryPort=28001',argv)
    def test_astro_unknown_fields_comments_password_literal(self):
        self.binary('astro');target=self.root/'AstroColony/Saved/Config/LinuxServer/ServerSettings.ini';target.parent.mkdir(parents=True);target.write_text(';note\n[/Script/ACFeature.EHServerSubsystem]\nUnmanaged=keep\n')
        self.config('astro',{'SERVER_PASSWORD':'literal $x; "'});content=target.read_text();self.assertIn(';note',content);self.assertIn('Unmanaged=keep',content);self.assertIn('literal $x; "',content);self.assertEqual(target.stat().st_mode&0o777,0o600)
    def test_astro_port_collision_rejected(self):
        self.binary('astro')
        with self.assertRaises(ValueError):self.config('astro',{'SERVER_QUERY_PORT':'28000'})
    def test_aska_all_original_properties_and_steamappid(self):
        self.binary('aska');target=self.root/'server properties.txt';target.write_text(';operator\nsave id = abc123\nunknown = retain\npassword = old\n')
        argv,env,secrets,_,_=self.config('aska',{'STEAM_GSLT':'fixture-only-token','SERVER_PASSWORD':'secret $x'})
        self.assertEqual(argv[-2:],['-propertiesPath','server properties.txt']);self.assertEqual(env['SteamAppId'],'1898300');self.assertNotIn('fixture-only-token',' '.join(argv));self.assertIn('fixture-only-token',secrets)
        data=target.read_text();self.assertIn('save id = abc123',data);self.assertIn('unknown = retain',data)
        for key in game.metadata()['aska']['properties']:self.assertIn(key+' = ',data)
        self.assertEqual(target.stat().st_mode&0o777,0o600)
    def test_aska_missing_real_operator_token_blocks(self):
        self.binary('aska')
        with self.assertRaises(ValueError):self.config('aska')
        self.assertFalse((self.root/'server properties.txt').exists())
    def test_properties_duplicate_and_newline_injection_rejected(self):
        with self.assertRaises(ValueError):game.patch_properties('password = one\npassword = two\n',{'password':'new'})
        self.binary('aska')
        with self.assertRaises(ValueError):self.config('aska',{'STEAM_GSLT':'fixture','DISPLAY_NAME':'name\nauthentication token = x'})
    def test_aloft_legacy_create_exact_original_controls(self):
        self.binary('aloft');argv,env,_,create,_=self.config('aloft',{'ADMIN_IDS':'76561198000000001 76561198000000002'})
        self.assertIn('create#Aloft#500#0#',create)
        for value in ('load#Aloft#','servername#A_Pterodactyl_Hosted_Server#','log#ERROR#','isvisible#true#','privateislands#false#','playercount#8#','serverport#28000#','admin#76561198000000001#','admin#76561198000000002#'):self.assertIn(value,argv)
        self.assertEqual(env['WINEPREFIX'],str(self.root/'.wine'));self.assertEqual(env['WINEDLLOVERRIDES'],'mscoree,mshtml=')
    def test_aloft_current_creation_tokens_are_explicit(self):
        self.binary('aloft');_,_,_,create,_=self.config('aloft',{'WORLD_GENERATION_SYNTAX':'current','ISLAND_PRESET':'huge','CORRUPTION_PRESET':'shrooms','CREATIVE_MODE':'1'})
        for value in ('create#Aloft#','islandcount#huge#','corruptioncount#shrooms#','creative#1#'):self.assertIn(value,create)
        self.assertNotIn('create#Aloft#500#1#',create)
    def test_existing_aloft_world_never_recreated(self):
        self.binary('aloft');(self.root/game.metadata()['aloft']['defaults']['SAVE_PATH']/'w_Aloft').mkdir(parents=True)
        self.assertIsNone(self.config('aloft')[3])
    def test_aloft_delimiter_traversal_admin_injection_rejected(self):
        self.binary('aloft')
        for env in ({'SAVE_NAME':'../escape'},{'SERVER_NAME':'name#admin#1'},{'ADMIN_IDS':'76561198000000001;bad'},{'SAVE_PATH':'../../outside'}):
            with self.assertRaises(ValueError):self.config('aloft',env)
    def test_literal_winetricks_verbs_and_private_prefix_stamped(self):
        with patch.object(game.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)) as run:
            game.prerequisites(self.root,'aloft',{});game.prerequisites(self.root,'aloft',{})
        self.assertEqual(run.call_count,1);self.assertEqual(run.call_args.args[0],['winetricks','-q','mono','vcrun2022','wmp11','mf','sound=disabled']);self.assertEqual(run.call_args.kwargs['env']['WINEPREFIX'],str(self.root/'.wine'))
    def test_winetricks_failure_or_shell_injection_never_stamped(self):
        with patch.object(game.subprocess,'run',return_value=types.SimpleNamespace(returncode=1)),self.assertRaises(ValueError):game.prerequisites(self.root,'aloft',{})
        self.assertFalse((self.root/'.voltra/aloft-winetricks.json').exists())
        with self.assertRaises(ValueError):game.prerequisites(self.root,'aloft',{'WINETRICKS_RUN':'mono; touch sentinel'})
    def test_failed_aska_publisher_restores_private_operator_bytes(self):
        target=self.root/'server properties.txt';target.write_bytes(b'password = old private\nsave id = old\n');target.chmod(0o640);os.chown(target,988,988)
        def publisher(*args,**kwargs):target.unlink();target.write_bytes(b'publisher');raise RuntimeError('fixture failure')
        with patch.object(game,'update',side_effect=publisher),self.assertRaises(RuntimeError):game.install(self.root,'aska',{})
        self.assertEqual(target.read_bytes(),b'password = old private\nsave id = old\n');self.assertEqual((target.stat().st_mode&0o777,target.stat().st_uid,target.stat().st_gid),(0o640,988,988))
    def test_original_app_platform_and_required_binary(self):
        for name in ('astro','aloft','aska'):
            with patch.object(game,'update',return_value={'fixture':True}) as update:game.install(self.root,name,{})
            info=game.metadata()[name];self.assertEqual(update.call_args.args[1],info['app']);self.assertEqual(update.call_args.kwargs['platform'],info['platform']);self.assertEqual(update.call_args.kwargs['required'],(info['binary'],))
    def test_failed_creation_withholds_load_and_returns_real_status(self):
        self.binary('aloft')
        with patch.object(game.Path,'cwd',return_value=self.root),patch.object(sys,'argv',['fixture','run','aloft']),patch.dict(os.environ,self.env,clear=True),patch.object(game,'prerequisites'),patch.object(game,'run',return_value=7) as run:
            self.assertEqual(game.main(),7);self.assertEqual(run.call_count,1)
    def test_missing_world_after_zero_creation_does_not_fake_success(self):
        self.binary('aloft')
        with patch.object(game.Path,'cwd',return_value=self.root),patch.object(sys,'argv',['fixture','run','aloft']),patch.dict(os.environ,self.env,clear=True),patch.object(game,'prerequisites'),patch.object(game,'run',return_value=0) as run,self.assertRaises(ValueError):game.main()
        self.assertEqual(run.call_count,1)
    def test_creation_then_load_is_sequential(self):
        self.binary('aloft');calls=[]
        def run(root,argv,*args,**kwargs):
            calls.append(argv)
            if len(calls)==1:(root/game.metadata()['aloft']['defaults']['SAVE_PATH']/'w_Aloft').mkdir(parents=True)
            return 0
        with patch.object(game.Path,'cwd',return_value=self.root),patch.object(sys,'argv',['fixture','run','aloft']),patch.dict(os.environ,self.env,clear=True),patch.object(game,'prerequisites'),patch.object(game,'run',side_effect=run):self.assertEqual(game.main(),0)
        self.assertEqual(len(calls),2);self.assertIn('create#Aloft#500#0#',calls[0]);self.assertIn('load#Aloft#',calls[1])
if __name__=='__main__':unittest.main()
