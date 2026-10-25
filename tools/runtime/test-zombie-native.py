import importlib.util
import json
import os
import signal
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('zombie',Path('internal/panel/game_library/scripts/zombie-native.py'));z=importlib.util.module_from_spec(spec);spec.loader.exec_module(z)

class Zombie(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','RCON_PORT':'28002','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','SKIP_INSTALL':'1','UPDATE_SERVER':'0','DISABLE_MOD_UPDATES':'1','RCON_PASSWORD':'private-rcon'}
    def tearDown(self):self.temp.cleanup()
    def binary(self,game):
        path=self.root/z.GAMES[game][2];path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'\x7fELF\x02\x01fixture' if game=='dayz' else b'MZ synthetic');return path
    def dayz(self):
        self.binary('dayz');cfg=self.root/'serverDZ.cfg';cfg.write_text('// hostname = "comment";\nhostname = "before";\nclass Missions {class DayZ {template = "dayzOffline.chernarusplus"; hostname="nested";};};\ncustomSetting=42;\n')
        mission=self.root/'mpmissions/dayzOffline.chernarusplus';mission.mkdir(parents=True);(mission/'init.c').write_text('// synthetic mission fixture');return cfg
    def test_dayz_private_transport_gate_no_writes(self):
        with mock.patch.object(z.steam,'update') as update:
            for patch in [{'SKIP_INSTALL':'0'},{'UPDATE_SERVER':'1'},{'DISABLE_MOD_UPDATES':'0'}]:
                with self.assertRaisesRegex(ValueError,'No account credentials were sent'):z.install(self.root,'dayz',{**self.env,**patch,'STEAM_PASS':'never-send'})
            update.assert_not_called();self.assertEqual(list(self.root.iterdir()),[])
    def test_existing_dayz_elf_mission_and_grammar_validation(self):
        self.dayz();self.assertEqual(z.install(self.root,'dayz',self.env)['mode'],'operator-files')
        binary=self.root/'DayZServer';binary.write_bytes(b'MZ Windows')
        with self.assertRaisesRegex(ValueError,'Linux64 ELF'):z.install(self.root,'dayz',self.env)
        binary.write_bytes(b'\x7fELF\x02\x01fixture');(self.root/'mpmissions/dayzOffline.chernarusplus/init.c').unlink()
        with self.assertRaisesRegex(ValueError,'mission init.c'):z.install(self.root,'dayz',self.env)
    def test_dayz_typed_cfg_nested_comments_flags_and_rcon(self):
        cfg=self.dayz();env={**self.env,'SERVER_HOSTNAME':'Literal $ & "quoted"','NIGHT_MULT':'0.5','SERVER_PASSWORD':'join-private'}
        argv,secrets,log=z.configure(self.root,'dayz',env);content=cfg.read_text()
        self.assertIn('"Literal $ & ""quoted"""',content);self.assertIn('// hostname = "comment";',content);self.assertIn('hostname="nested";',content);self.assertIn('customSetting=42;',content);self.assertIn('serverNightTimeAcceleration = 0.5;',content)
        self.assertIn('-bepath=./battleye',argv);self.assertIn('-freezecheck',argv);self.assertNotIn('private-rcon',str(argv));self.assertIn('private-rcon',secrets);self.assertIsNone(log)
        battleye=(self.root/'battleye/beserver_x64.cfg').read_text();self.assertIn('RestrictRCon 0',battleye);self.assertIn('RConPort 28002',battleye);self.assertIn('RConPassword private-rcon',battleye)
    def test_dayz_mod_html_manual_server_lowercase_and_keys(self):
        self.dayz();(self.root/'modlist.html').write_text('<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=12345">fixture</a><a href="https://evil.invalid/?id=999">ignored</a>')
        for name in ('@12345','ManualMod','servermod'):
            path=self.root/name/'Keys';path.mkdir(parents=True);(path/(name.lstrip('@')+'.bikey')).write_bytes(name.encode())
        env={**self.env,'MODIFICATIONS':'ManualMod;','SERVERMODS':'servermod;','MODS_LOWERCASE':'1'}
        clients,servers=z.dayz_mods(self.root,env);self.assertEqual(clients,['manualmod','@12345']);self.assertEqual(servers,['servermod']);self.assertTrue((self.root/'manualmod/keys/manualmod.bikey').is_file());self.assertEqual(len(list((self.root/'keys').glob('*.bikey'))),3)
    def test_dayz_lowercase_collision_and_missing_workshop_fail_explicitly(self):
        mod=self.root/'mod';mod.mkdir();(mod/'A.pbo').write_text('A');(mod/'a.pbo').write_text('a')
        with self.assertRaisesRegex(ValueError,'case collision'):z.dayz_mods(self.root,{**self.env,'MODIFICATIONS':'mod','MODS_LOWERCASE':'1','MOD_FILE':''})
        self.assertTrue((mod/'A.pbo').exists())
        with self.assertRaisesRegex(ValueError,'private Workshop acquisition is unavailable'):z.dayz_mods(self.root,{**self.env,'MODIFICATIONS':'@999','MOD_FILE':''})
    def test_dayz_startup_injection_managed_override_and_port_rejection(self):
        for value in ['-log; touch /tmp/evil','-config=/etc/passwd','-storage=../../escape','-mod=@evil']:
            with self.assertRaises(ValueError):z.dayz_arguments({'STARTUP_PARAMS':value})
        self.assertEqual(z.dayz_arguments({'STARTUP_PARAMS':'-cpuCount=4 -limitFPS=120'}),['-cpuCount=4','-limitFPS=120'])
        for patch in [{'QUERY_PORT':'28000'},{'RCON_PORT':'28001'},{'QUERY_PORT':'65536'}]:
            with self.assertRaises(ValueError):z.ports({**self.env,**patch},[('QUERY_PORT',27016),('RCON_PORT',2305)])
    def test_scum_original_ini_unknown_admin_and_save_state(self):
        self.binary('scum');path=self.root/'SCUM/Saved/Config/WindowsServer/ServerSettings.ini';path.parent.mkdir(parents=True);path.write_text(';operator\n[General]\nscum.ServerName=old\nscum.Custom=keep\n[World]\nscum.OperatorSetting=4\n');path.chmod(0o640)
        env={**self.env,'SERVER_NAME':'literal $ & server','SERVER_DESCRIPTION':'desc','SERVER_PASSWORD':'private-join','SERVER_PLAYSTYLE':'PVE','MAX_PLAYERS':'48'}
        argv,secrets,log=z.configure(self.root,'scum',env);value=path.read_text();self.assertIn(';operator',value);self.assertIn('scum.Custom=keep',value);self.assertIn('scum.OperatorSetting=4',value);self.assertIn('scum.ServerName= literal $ & server',value);self.assertEqual(path.stat().st_mode&0o777,0o640);self.assertIn('-MaxPlayers=48',argv);self.assertEqual(log,'SCUM/Saved/Logs/SCUM.log');self.assertIn('private-join',secrets)
    def test_scum_private_steam_rejected_before_side_effects(self):
        with mock.patch.object(z.steam,'update') as update:
            with self.assertRaisesRegex(ValueError,'Private Steam'):z.install(self.root,'scum',{'STEAM_USER':'account','STEAM_PASS':'secret'})
            update.assert_not_called();self.assertEqual(list(self.root.iterdir()),[])
    def test_scum_reinstall_failure_preserves_admin_db_configs_modes(self):
        self.binary('scum');paths=[self.root/'SCUM/Saved/Config/WindowsServer/AdminUsers.ini',self.root/'SCUM/Saved/SaveFiles/world.db',self.root/'SCUM/Saved/Config/WindowsServer/ServerSettings.ini']
        for i,path in enumerate(paths):path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(('owned'+str(i)).encode());path.chmod(0o640)
        def fail(*args,**kwargs):
            for path in paths:path.write_bytes(b'publisher overwrite')
            raise RuntimeError('synthetic install failure')
        with mock.patch.object(z.steam,'update',side_effect=fail):
            with self.assertRaises(RuntimeError):z.install(self.root,'scum',{'WINDOWS_INSTALL':'1'})
        for i,path in enumerate(paths):self.assertEqual(path.read_bytes(),('owned'+str(i)).encode());self.assertEqual(path.stat().st_mode&0o777,0o640)
    def test_dead_matter_sdk_client_appid_and_saved_retention(self):
        self.binary('dead-matter');save=self.root/'DeadMatter/Saved/SaveGames/owned.sav';save.parent.mkdir(parents=True);save.write_bytes(b'owned save')
        calls=[];proton=type('Proton',(),{'provision':mock.Mock()})();original=z.helper
        def install(root,appid,env,**kwargs):
            calls.append((appid,kwargs['platform']));root.mkdir(parents=True,exist_ok=True)
            if appid==1007:(root/'steamclient64.dll').write_bytes(b'fixture SDK')
            else:save.write_bytes(b'publisher overwrite')
            return {'buildid':'synthetic'}
        with mock.patch.object(z.steam,'update',side_effect=install),mock.patch.object(z,'helper',side_effect=lambda name:proton if name=='enshrouded-proton' else original(name)):
            z.install(self.root,'dead-matter',{'WINDOWS_INSTALL':'1'})
        self.assertEqual(calls,[(2584780,'windows'),(1007,'windows')]);self.assertEqual(save.read_bytes(),b'owned save');self.assertEqual((self.root/'steam_appid.txt').read_text(),'2184150\n');self.assertEqual((self.root/'DeadMatter/Binaries/Win64/steamclient64.dll').read_bytes(),b'fixture SDK');proton.provision.assert_called_once()
    def test_log_skips_history_follows_rotation_truncation_and_redacts(self):
        path=self.root/'logs/game.log';path.parent.mkdir();path.write_bytes(b'historical\n');f=z.NativeLog(self.root,'logs/game.log',['private']);output=[]
        with path.open('ab') as stream:stream.write(b'new private\n')
        f.scan(output.append);self.assertEqual(b''.join(output),b'new [redacted]\n')
        path.rename(path.with_suffix('.old'));path.write_bytes(b'rotation\n');output=[];f.scan(output.append);self.assertEqual(b''.join(output),b'rotation\n')
        path.write_bytes(b'x\n');output=[];f.scan(output.append);self.assertEqual(b''.join(output),b'x\n');self.assertIn(b'historical',path.with_suffix('.old').read_bytes())
    def test_log_external_parent_and_leaf_links_rejected(self):
        outside=self.root/'outside';outside.mkdir();(outside/'log').write_bytes(b'secret');(self.root/'logs').symlink_to(outside,target_is_directory=True)
        with self.assertRaises(OSError):z.NativeLog(self.root,'logs/log',[])
        (self.root/'logs').unlink();(self.root/'logs').mkdir();(self.root/'logs/log').symlink_to(outside/'log')
        with self.assertRaises(OSError):z.NativeLog(self.root,'logs/log',[])
    def test_log_fifo_rejected_without_blocking(self):
        path=self.root/'logs/game.log';path.parent.mkdir();os.mkfifo(path)
        with self.assertRaisesRegex(ValueError,'regular file'):z.NativeLog(self.root,'logs/game.log',[])
    def test_duplicate_battleye_rejected_before_cfg_change(self):
        cfg=self.dayz();before=cfg.read_bytes();path=self.root/'battleye/beserver_x64.cfg';path.parent.mkdir();path.write_text('RConPort 1\nRConPort 2\n')
        with self.assertRaisesRegex(ValueError,'Duplicate managed BattlEye'):z.configure(self.root,'dayz',self.env)
        self.assertEqual(cfg.read_bytes(),before)
    def test_native_supervisor_owns_exit_stop_and_secret_env(self):
        self.dayz();console=type('Console',(),{'run':mock.Mock(return_value=17)})();original=z.helper
        with mock.patch.object(z,'helper',side_effect=lambda name:console if name=='native-console' else original(name)):
            self.assertEqual(z.run(self.root,'dayz',self.env),17)
        args,kwargs=console.run.call_args;self.assertEqual(args[3],'\x03');self.assertNotIn('RCON_PASSWORD',args[2]);self.assertTrue(kwargs['terminal_input']);self.assertEqual(kwargs['stop_signal'],signal.SIGINT)

unittest.main()
