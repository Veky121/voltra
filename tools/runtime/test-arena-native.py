import importlib.util
import json
import os
from pathlib import Path
import signal
import struct
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('arena',Path('internal/panel/game_library/scripts/arena-native.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class Arena(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000','AUTO_UPDATE':'0','INSTALL_MODE':'existing'}
    def tearDown(self):self.temp.cleanup()
    def pe(self,name,machine):
        path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);data=bytearray(128);data[:2]=b'MZ';struct.pack_into('<I',data,60,64);data[64:68]=b'PE\0\0';struct.pack_into('<H',data,68,machine);path.write_bytes(data);return path
    def iw4(self):
        self.pe('iw4x.exe',0x14c);self.pe('iw4x.dll',0x14c)
        for name in ['main/fixture.iwd','zone/english/fixture.ff','iw4x/zone/fixture.ff']:
            path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'synthetic structural asset, never executed')
        path=self.root/'userraw/server.cfg';path.parent.mkdir();path.write_text('//operator\nsv_hostname "old"\nset g_password "old"\nset rcon_password "private-rcon"\nset sv_mapRotation "gametype war map mp_rust"\nexec bans.cfg\n');path.chmod(0o640);return path
    def r5(self):
        self.pe('r5apex_ds.exe',0x8664);path=self.root/'paks/Win64_Server/fixture.rpak';path.parent.mkdir(parents=True);path.write_bytes(b'synthetic structural server-only pak');(self.root/'platform/cfg').mkdir(parents=True)
    def test_private_and_unverified_archive_modes_fail_before_writes(self):
        for game,mode in [('iw4x','steam'),('r5','download')]:
            with self.assertRaises(ValueError):a.install(self.root,game,{**self.env,'INSTALL_MODE':mode,'STEAM_USER':'account','STEAM_PASS':'private'})
            self.assertEqual(list(self.root.iterdir()),[])
    def test_pe_architecture_and_asset_prerequisites(self):
        self.iw4();a.validate(self.root,'iw4x',self.env);self.pe('iw4x.exe',0x8664)
        with self.assertRaisesRegex(ValueError,'architecture'):a.validate(self.root,'iw4x',self.env)
        self.pe('iw4x.exe',0x14c);(self.root/'main/fixture.iwd').unlink()
        with self.assertRaisesRegex(ValueError,'assets are missing'):a.validate(self.root,'iw4x',self.env)
    def test_iw4_literal_argv_config_mod_admin_rotation_retention(self):
        path=self.iw4();(self.root/'mods/operator').mkdir(parents=True)
        argv,secrets=a.configure(self.root,'iw4x',{**self.env,'MOD_DIR':'mods/operator','SERVER_NAME':'^3Literal $ & Name','SERVER_PASSWORD':'private-join'})
        value=path.read_text();self.assertIn('sv_hostname "^3Literal $ & Name"',value);self.assertIn('set g_password "private-join"',value);self.assertIn('set sv_mapRotation "gametype war map mp_rust"',value);self.assertIn('exec bans.cfg',value);self.assertIn('//operator',value);self.assertEqual(path.stat().st_mode&0o777,0o640);self.assertIn('mods/operator',argv);self.assertIn('+map_rotate',argv);self.assertNotIn('private-join',str(argv));self.assertIn('private-rcon',secrets)
    def test_invalid_settings_and_duplicate_commands_do_not_publish(self):
        path=self.iw4();before=path.read_bytes()
        for patch in [{'SERVER_NAME':'bad";exec evil'},{'SERVER_PASSWORD':'bad\nexec evil'},{'MOD_DIR':'../../escape'},{'SERVER_PORT':'28001'}]:
            with self.assertRaises(ValueError):a.configure(self.root,'iw4x',{**self.env,**patch})
            self.assertEqual(path.read_bytes(),before)
        path.write_bytes(before+b'sv_hostname "duplicate"\n');before=path.read_bytes()
        with self.assertRaisesRegex(ValueError,'Duplicate managed'):a.configure(self.root,'iw4x',self.env)
        self.assertEqual(path.read_bytes(),before)
    def test_launcher_hash_and_original_auto_setting(self):
        self.iw4();launcher=self.root/'iw4x-launcher';launcher.write_bytes(b'\x7fELF\x02\x01synthetic updater never executed')
        with self.assertRaisesRegex(ValueError,'independently reviewed'):a.validate(self.root,'iw4x',{**self.env,'AUTO_UPDATE':'1'})
        env={**self.env,'AUTO_UPDATE':'1','IW4X_LAUNCHER_SHA256':a.sha256(launcher)};a.validate(self.root,'iw4x',env);launcher.write_bytes(b'changed')
        with self.assertRaises(ValueError):a.validate(self.root,'iw4x',env)
        a.validate(self.root,'iw4x',self.env)
    def test_r5_original_args_playlist_server_only_assets_and_rcon(self):
        self.r5();cfg=self.root/'platform/cfg/tools/rcon_server.cfg';cfg.parent.mkdir();cfg.write_text('sv_rcon_password "private-rcon"\nrcon_key "private-key"\n');before=cfg.read_bytes()
        argv,secrets=a.configure(self.root,'r5',{**self.env,'PLAYLIST':'fs_dm','SERVER_NAME':'literal $ & name','ARGS':'-devsdk -wconsole +exec server.cfg'})
        self.assertEqual(argv[2:4],['-noconsole','-port']);self.assertIn('fs_dm',argv);self.assertIn('-devsdk',argv);self.assertIn('+exec',argv);self.assertIn('private-rcon',secrets);self.assertIn('private-key',secrets);self.assertEqual(cfg.read_bytes(),before)
    def test_r5_typed_overrides_and_chains_fail_before_writes(self):
        self.r5();before={str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        for patch in [{'PLAYLIST':'fs_dm;+exec evil'},{'ARGS':'+hostname override'},{'ARGS':'-port 29000'},{'ARGS':'-insecure'},{'ARGS':'-wconsole; touch /tmp/evil'},{'SERVER_NAME':'name";bad'}]:
            with self.assertRaises(ValueError):a.configure(self.root,'r5',{**self.env,**patch})
            self.assertEqual(before,{str(p):p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
    def test_player_state_always_retained_even_matching_baseline(self):
        self.iw4();player=self.root/'players/profile.dat';player.parent.mkdir();player.write_bytes(b'owned');player.chmod(0o640)
        a.install(self.root,'iw4x',self.env)
        for failure in (False,True):
            try:
                with a.preserve(self.root):
                    player.write_bytes(b'publisher overwrite');(self.root/'userraw/server.cfg').write_bytes(b'publisher overwrite')
                    if failure:raise RuntimeError('synthetic updater failure')
            except RuntimeError:pass
            self.assertEqual(player.read_bytes(),b'owned');self.assertEqual(player.stat().st_mode&0o777,0o640);self.assertIn('sv_mapRotation',(self.root/'userraw/server.cfg').read_text())
    def test_installer_never_executes_uploaded_binary(self):
        self.iw4()
        with mock.patch.object(a.subprocess,'Popen') as launch:
            self.assertFalse(a.install(self.root,'iw4x',self.env)['native_verified']);launch.assert_not_called()
    def test_symlinks_and_special_assets_rejected(self):
        self.iw4();path=self.root/'main/fixture.iwd';path.unlink();os.mkfifo(path)
        with self.assertRaisesRegex(ValueError,'special'):a.validate(self.root,'iw4x',self.env)
    def runtime(self,game,env,code):
        original=a.helper;console=type('Console',(),{'run':mock.Mock(return_value=code)})();display=type('Display',(),{'poll':lambda self:None,'terminate':mock.Mock(),'wait':mock.Mock()})()
        exists=Path.exists
        with mock.patch.object(a,'helper',side_effect=lambda name:console if name=='native-console' else original(name)),mock.patch.object(a.subprocess,'Popen',return_value=display),mock.patch.object(Path,'exists',lambda path:True if str(path)=='/tmp/.X11-unix/X99' else exists(path)):
            self.assertEqual(a.run(self.root,game,env),code)
        display.terminate.assert_called_once();return console
    def test_actual_signal_raw_exit_and_native_environment_both_games(self):
        self.iw4();console=self.runtime('iw4x',{**self.env,'STEAM_PASS':'private','SERVER_PASSWORD':'private'},19)
        args,kwargs=console.run.call_args;self.assertEqual(kwargs['stop_signal'],signal.SIGINT);self.assertTrue(kwargs['terminal_query_reply']);self.assertNotIn('STEAM_PASS',args[2]);self.assertNotIn('SERVER_PASSWORD',args[2]);self.assertEqual(args[0],self.root)
        self.r5();console=self.runtime('r5',{**self.env,'DL_URL':'https://example.invalid/private'},21);self.assertEqual(console.run.call_args.kwargs['stop_signal'],signal.SIGINT);self.assertNotIn('DL_URL',console.run.call_args.args[2])
    def test_root_updater_guard_before_process_and_config_changes(self):
        path=self.iw4();before=path.read_bytes()
        with mock.patch.object(a.os,'geteuid',return_value=0),mock.patch.object(a.subprocess,'Popen') as launch:
            with self.assertRaisesRegex(ValueError,'as root'):a.run(self.root,'iw4x',{**self.env,'AUTO_UPDATE':'1'})
            launch.assert_not_called();self.assertEqual(path.read_bytes(),before)
    def test_updater_failure_keeps_raw_exit_and_skips_game(self):
        self.iw4();launcher=self.root/'iw4x-launcher';launcher.write_bytes(b'\x7fELF\x02\x01synthetic launcher');launcher.chmod(0o700)
        env={**self.env,'AUTO_UPDATE':'1','IW4X_LAUNCHER_SHA256':a.sha256(launcher)}
        with mock.patch.object(a.os,'geteuid',return_value=1000):console=self.runtime('iw4x',env,29)
        console.run.assert_called_once();self.assertEqual(console.run.call_args.args[1],[str(launcher),'--update']);self.assertEqual(console.run.call_args.kwargs['stop_signal'],signal.SIGINT)
    def test_config_crlf_inline_comments_and_native_exec_confinement(self):
        content='sv_hostname "before" //retain name note\r\nset g_password "old" //retain password note\r\nexec bans.cfg\r\n'
        updated=a.patch_iw4(content,'new','pass');self.assertIn('//retain name note\r\n',updated);self.assertIn('//retain password note\r\n',updated);self.assertTrue(updated.endswith('exec bans.cfg\r\n'))
        for value in ['+exec ../../outside.cfg','+exec /etc/passwd','+exec']:
            with self.assertRaises(ValueError):a.extra_args(value)

unittest.main()
