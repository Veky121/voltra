"""MIT. Real filesystem plus isolated publisher/error fixtures; no native claims."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),BASE/(name+'.py'));module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module);return module
load('steam-template');load('native-config');load('native-console');game=load('unreal-building')
class Building(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.addCleanup(self.temp.cleanup)
        self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','RCON_PORT':'28002','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002'}
    def binary(self,name):
        binary=self.root/game.metadata()[name]['binary'];binary.parent.mkdir(parents=True,exist_ok=True);binary.write_bytes(b'fixture binary');return binary
    def config(self,name,env=None):return game.configure(self.root,name,{**self.env,**(env or {})})
    def test_brickadia_original_literal_args_and_three_ini_fields(self):
        self.binary('brickadia');argv,child,secrets,_=self.config('brickadia',{'SERVER_HOSTING_TOKEN':'fixture-only-token','WORLD_NAME':'my world','SERVER_NAME':'quoted " $x; name','SERVER_LIST_PUBLIC':'False'})
        self.assertIn('-world=my world',argv);self.assertIn('-token=fixture-only-token',argv);self.assertIn('fixture-only-token',secrets);self.assertEqual(child['HOME'],str(self.root))
        data=(self.root/game.metadata()['brickadia']['config']).read_text();self.assertIn('ServerName = quoted " $x; name',data);self.assertIn('ServerPassword = ',data);self.assertIn('bPubliclyListed = False',data)
    def test_brickadia_missing_operator_token_blocks(self):
        self.binary('brickadia')
        with self.assertRaises(ValueError):self.config('brickadia')
    def test_brickadia_world_traversal_rejected(self):
        self.binary('brickadia')
        for name in ('../world','a/b','a\\b'):
            with self.assertRaises(ValueError):self.config('brickadia',{'SERVER_HOSTING_TOKEN':'fixture','WORLD_NAME':name})
    def test_longvinter_all_ten_settings_and_original_layout(self):
        self.binary('longvinter');argv,_,_,_=self.config('longvinter');info=game.metadata()['longvinter'];data=(self.root/info['config']).read_text()
        self.assertEqual(sum(len(keys) for keys in info['ini'].values()),10)
        for section,keys in info['ini'].items():
            self.assertIn('['+section+']',data)
            for key,name in keys.items():self.assertIn(key+' = '+info['defaults'][name],data)
        self.assertIn('longvinter-linux-server/Longvinter/Binaries/Linux',argv[0]);self.assertIn('-Port=28000',argv);self.assertIn('-QueryPort=28001',argv)
    def test_longvinter_original_eos_admin_password_constraints(self):
        self.binary('longvinter')
        self.config('longvinter',{'ADMIN_ID':'01'*16+' '+'ab'*16})
        for changes in ({'ADMIN_ID':'wrong'},{'SERVER_PASSWORD':'semicolon;injection'},{'ENABLE_PVP':'maybe'},{'MAX_TENTS':'-1'}):
            with self.assertRaises(ValueError):self.config('longvinter',changes)
    def test_frozen_password_quotes_and_original_rcon_arguments(self):
        self.binary('frozen');argv,_,secrets,_=self.config('frozen',{'RCON_PASSWORD':'rcon " $x','SERVER_PASSWORD':'a"b\\c'})
        self.assertIn('-RconPassword=rcon " $x',argv);self.assertIn('rcon " $x',secrets)
        data=(self.root/game.metadata()['frozen']['config']).read_text();self.assertIn('[/Script/Engine.GameSession]',data);self.assertIn('MaxPlayers = 10',data);self.assertIn('ServerPassword = "a\\"b\\\\c"',data)
    def test_unknown_settings_comments_and_balance_preserved(self):
        self.binary('frozen');target=self.root/game.metadata()['frozen']['config'];target.parent.mkdir(parents=True);target.write_text(';operator comment\n[/Script/FrozenFlame.GameBalance]\nbLimitlessSupport=True\n')
        self.config('frozen');self.assertIn(';operator comment',target.read_text());self.assertIn('bLimitlessSupport=True',target.read_text());self.assertEqual(target.stat().st_mode&0o777,0o600)
    def test_duplicate_ini_or_newline_injection_rejected(self):
        self.binary('frozen')
        with self.assertRaises(ValueError):self.config('frozen',{'SERVER_NAME':'name\nInjected=1'})
        target=self.root/game.metadata()['frozen']['config'];target.parent.mkdir(parents=True);target.write_text('[/Script/Engine.GameSession]\nMaxPlayers=3\nMaxPlayers=4\n')
        with self.assertRaises(ValueError):self.config('frozen')
    def test_all_ports_allocated_distinct_and_in_range(self):
        self.binary('frozen')
        for env in ({'QUERY_PORT':'28000'},{'RCON_PORT':'28001'},{'RCON_PORT':'29999'},{'QUERY_PORT':'65536'}):
            with self.assertRaises(ValueError):self.config('frozen',env)
    def test_longvinter_sdk_and_official_steam_server_are_separate(self):
        self.binary('longvinter');calls=[]
        with patch.object(game,'update',side_effect=lambda root,app,**kwargs:calls.append((root,app,kwargs))):game.install(self.root,'longvinter',{})
        self.assertEqual([call[1] for call in calls],[1007,1639880]);self.assertEqual(calls[1][0],self.root/'longvinter-linux-server');self.assertEqual(calls[1][2]['required'],('Longvinter/Binaries/Linux/LongvinterServer-Linux-Shipping',))
    def test_frozen_default_download_only_if_missing(self):
        self.binary('frozen');target=self.root/game.metadata()['frozen']['config']
        with patch.object(game,'update'),patch.object(game,'default_config',return_value=b';publisher default\n') as download:game.install(self.root,'frozen',{})
        self.assertEqual(download.call_count,1);self.assertEqual(target.read_bytes(),b';publisher default\n')
        target.write_bytes(b';operator file\n')
        with patch.object(game,'update'),patch.object(game,'default_config') as download:game.install(self.root,'frozen',{})
        download.assert_not_called();self.assertEqual(target.read_bytes(),b';operator file\n')
    def test_failed_publisher_restores_world_hash_mode_and_owner(self):
        self.binary('longvinter');target=self.root/'longvinter-linux-server/Longvinter/Saved/SaveGames/world.bin';target.parent.mkdir(parents=True);target.write_bytes(b'world persistence fixture');target.chmod(0o640);os.chown(target,988,988)
        def update(*args,**kwargs):target.unlink();target.write_bytes(b'publisher replaced');raise RuntimeError('fixture failure')
        with patch.object(game,'update',side_effect=update),self.assertRaises(RuntimeError):game.install(self.root,'longvinter',{})
        self.assertEqual(target.read_bytes(),b'world persistence fixture');self.assertEqual((target.stat().st_mode&0o777,target.stat().st_uid,target.stat().st_gid),(0o640,988,988))
    def test_symlink_protected_config_rejected_before_publisher(self):
        self.binary('frozen');outside=self.root/'outside';outside.write_text('untouched');target=self.root/game.metadata()['frozen']['config'];target.parent.mkdir(parents=True);target.symlink_to(outside)
        with patch.object(game,'update') as update,self.assertRaises(ValueError):game.install(self.root,'frozen',{})
        update.assert_not_called();self.assertEqual(outside.read_text(),'untouched')
    def test_config_checksum_and_size_fail_closed(self):
        class Response(io.BytesIO):
            def geturl(self):return 'https://publisher.invalid/config'
        good=b';configuration fixture\n';release={'url':'https://publisher.invalid/config','sha256':hashlib.sha256(good).hexdigest()}
        with patch.object(game.urllib.request,'urlopen',return_value=Response(good)):self.assertEqual(game.default_config(release),good)
        for payload in (b'tampered',b'x'*65537):
            with patch.object(game.urllib.request,'urlopen',return_value=Response(payload)),self.assertRaises(ValueError):game.default_config(release)
    def test_blank_frozen_app_disables_startup_update_only(self):
        self.binary('frozen')
        with patch.object(game.Path,'cwd',return_value=self.root),patch.object(sys,'argv',['fixture','run','frozen']),patch.dict(os.environ,{**self.env,'SRCDS_APPID':'','VOLTRA_STEAM_AUTO_UPDATE':'1'},clear=True),patch.object(game,'install') as install,patch.object(game,'run',return_value=0):self.assertEqual(game.main(),0)
        install.assert_not_called()
        with patch.object(game,'update') as update,patch.object(game,'default_config',return_value=b';default'):game.install(self.root,'frozen',{'SRCDS_APPID':''})
        self.assertEqual(update.call_args.args[1],1348640)
    def test_wrong_original_app_id_rejected_before_download(self):
        with patch.object(game,'update') as update,self.assertRaises(ValueError):game.install(self.root,'longvinter',{'SRCDS_APPID':'1639880'})
        update.assert_not_called()
if __name__=='__main__':unittest.main()
