#!/usr/bin/env python3
"""MIT. ARK offline source fixtures. These are not native ARK game proofs."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

SOURCE = Path('internal/panel/game_library/scripts/ark-family.py').resolve()
spec = importlib.util.spec_from_file_location('ark', SOURCE)
ark = importlib.util.module_from_spec(spec);spec.loader.exec_module(ark)


def environment(**values):
    return {'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000,28001,28002,28003,28004,28005',
            'ARK_ADMIN_PASSWORD': 'fixture-only-password', **values}


class RconFixture:
    def __init__(self, reject=False):
        self.reject = reject
        self.commands = []
        self.finished = threading.Event()
        self.server = socket.socket();self.server.bind(('127.0.0.1', 0));self.server.listen()
        self.server.settimeout(.1)
        self.port = self.server.getsockname()[1]
        self.thread = threading.Thread(target=self.run, daemon=True)

    def __enter__(self):
        self.thread.start();return self

    def __exit__(self, *args):
        self.finished.set();self.thread.join(timeout=2);self.server.close()

    def run(self):
        while not self.finished.is_set():
            try:
                connection, _ = self.server.accept()
            except socket.timeout:
                continue
            with connection:
                connection.settimeout(1)
                try:
                    identity, kind, body = ark.read_packet(connection)
                    response = ark.packet(-1 if self.reject else identity, 2, '')
                    # Actual fragmented TCP framing, not one mocked recv per packet.
                    for byte in response:
                        connection.sendall(bytes([byte]))
                    if self.reject:
                        continue
                    if kind != 3 or body != 'fixture-only-password':
                        raise AssertionError('Fixture credential mismatch')
                    identity, kind, body = ark.read_packet(connection)
                    self.commands.append(body)
                    if body != 'DoExit':
                        connection.sendall(ark.packet(identity, 0, 'fixture response'))
                except (EOFError, OSError):
                    pass


class ArkTests(unittest.TestCase):
    def test_evolved_every_native_role_and_ordered_mods(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = ark.build(root, 'evolved', environment(QUERY_PORT='28003', RCON_PORT='28004',
                        SERVER_MAP='Fjordur', SESSION_NAME='Voltra $ + server', ARK_PASSWORD='join-secret',
                        MOD_ID='123,456,123', BATTLE_EYE='0', MAX_PLAYERS='23', ARGS='-crossplay -clusterid=MyCluster'))
            self.assertEqual(plan['binary'], root / ark.GAMES['evolved'][2])
            self.assertTrue(plan['args'][0].startswith('Fjordur?listen?SessionName="Voltra $ + server"'))
            for value in ['?ServerPassword=join-secret', '?ServerAdminPassword=fixture-only-password',
                          '?Port=28000', '?RCONPort=28004', '?QueryPort=28003', '?RCONEnabled=True',
                          '?MaxPlayers=23', '?GameModIds=123,456']:
                self.assertIn(value, plan['args'][0])
            for flag in ['-automanagedmods', '-server', '-log', '-NoBattlEye', '-crossplay', '-clusterid=MyCluster']:
                self.assertIn(flag, plan['args'])
            self.assertEqual(plan['sections']['ServerSettings']['ActiveMods'], '123,456')

    def test_ascended_parameters_flags_mod_namespace_and_pve(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = ark.build(Path(directory), 'ascended', environment(RCON_PORT='28004', QUERY_PORT='28003',
                       SERVER_MAP='TheCenter_WP', SESSION_NAME='ASA $ +', SERVER_PASSWORD='join-secret',
                       ARGS_PARAMS='?OverrideOfficialDifficulty=6?CustomAuthToken=fixture-token',
                       ARGS_FLAGS='-crossplay -clusterid=ClusterA', MOD_IDS='123-dev,456,123-dev',
                       SERVER_PVE='0', MAX_PLAYERS='120', BATTLE_EYE='0'))
            self.assertIn('?OverrideOfficialDifficulty=6', plan['args'][0])
            self.assertIn('?ServerPVE=False', plan['args'][0])
            self.assertIn('-mods=123-dev,456', plan['args'])
            self.assertIn('-Port=28000', plan['args'])
            self.assertIn('-WinLiveMaxPlayers=120', plan['args'])
            self.assertIn('-oldconsole', plan['args']);self.assertIn('-servergamelog', plan['args'])
            self.assertIn('fixture-token', plan['credentials'])
            self.assertEqual(plan['sections']['ServerSettings']['ServerPVE'], 'False')

    def test_pixark_exact_original_fixed_controls_and_query_companion(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = ark.build(Path(directory), 'pixark', environment(SRV_NAME='PixWorld', MAX_PLAYERS='17'))
            self.assertEqual(plan['ports'], {'Port': 28000, 'QueryPort': 28002, 'RCONPort': 28003, 'CubePort': 28004})
            for value in ['CubeWorld_Light?listen', '?DelayRegisterServer=True', '?bRawSockets=True',
                          '?AltSaveDirectoryName=PteroPixArk', '?SessionName=PixWorld', '?MaxPlayers=17']:
                self.assertIn(value, plan['args'][0])
            for flag in ['-Seed=12345', '-OreSeed=1234', '-ConfigsUseAltDir', '-CULTUREFORCOOKING=en',
                         '-NoBattlEye', '-NoHangDetection', '-CubePort=28004', '-cubeworld=PixWorld', '-nosteamclient']:
                self.assertIn(flag, plan['args'])
            self.assertIn('Saved/PteroPixArk/Config/WindowsServer/', plan['config'])

    def test_invalid_ports_url_and_flags_are_not_shell_or_role_bypasses(self):
        for game, changes in [('evolved', {'QUERY_PORT': '28001'}), ('ascended', {'RCON_PORT': '28000'}),
                              ('pixark', {'QPORT': '28001'}), ('pixark', {'QPORT': '27015'}),
                              ('evolved', {'MOD_ID': '1,,2'}), ('ascended', {'MOD_IDS': 'WorkshopName'}),
                              ('ascended', {'ARGS_PARAMS': '?Port=1234'}),
                              ('ascended', {'ARGS_PARAMS': '?Foo=1?foo=2'}),
                              ('ascended', {'ARGS_PARAMS': 'Foo=1'}),
                              ('evolved', {'SESSION_NAME': 'oops?RCONEnabled=False'}),
                              ('evolved', {'ARGS': '-Port=7777'}),
                              ('evolved', {'ARGS': '-crossplay; touch /tmp/not-created'}),
                              ('evolved', {'SERVER_MAP': '../outside'}),
                              ('pixark', {'SRV_NAME': 'not allowed spaces'})]:
            with self.subTest(game=game, changes=changes), tempfile.TemporaryDirectory() as folder, self.assertRaises(ValueError):
                ark.build(Path(folder), game, environment(**changes))

    def test_config_keeps_unknown_gameplay_repeat_arrays_and_private_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = ark.build(root, 'evolved', environment(SESSION_NAME='Typed Server', MOD_ID='12,34'))
            path = root / plan['config'];path.parent.mkdir(parents=True)
            path.write_text('; operator comment\n[ServerSettings]\nTamingSpeedMultiplier=8\nServerPassword=old\n[/Script/ShooterGame.ShooterGameMode]\nOverrideNamedEngramEntries=one\nOverrideNamedEngramEntries=two\n')
            ark.configure(root, 'evolved', environment(SESSION_NAME='Typed Server', MOD_ID='12,34', ARK_PASSWORD='new-secret'))
            content = path.read_text()
            self.assertIn('; operator comment', content)
            self.assertIn('TamingSpeedMultiplier=8', content)
            self.assertIn('OverrideNamedEngramEntries=one', content);self.assertIn('OverrideNamedEngramEntries=two', content)
            self.assertIn('ActiveMods = 12,34', content)
            self.assertIn('ServerPassword= new-secret', content)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            backups = list((root / '.voltra/ark/config-backups').glob('*'))
            self.assertEqual(len(backups), 1)
            self.assertIn('ServerPassword=old', backups[0].read_text())

    def test_steam_control_mapping_and_private_credentials_fail_before_update(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for game, (app, platform, binary) in ark.GAMES.items():
                selected, target, _, options = ark.steam_options(game, {'SRCDS_BETAID': 'preaquatica' if game == 'evolved' else ''})
                self.assertEqual((selected, target), (app, platform))
                argv = ark.steam.arguments(root, app, options, platform=platform, force_platform=True)
                self.assertIn('+app_info_print', argv);self.assertIn('+app_update', argv)
                self.assertIn(platform, argv)
                if game == 'evolved':
                    self.assertEqual(argv[argv.index('-beta') + 1], 'preaquatica')
            with patch.object(ark.steam, 'update', side_effect=AssertionError('must not spawn')):
                for values in [{'STEAM_USER':'real-user','STEAM_PASS':'private-secret'},
                               {'SRCDS_BETAPASS':'private-secret','SRCDS_BETAID':'secret'}, {'INSTALL_FLAGS':'+quit'},
                               {'WINDOWS_INSTALL':'1'}, {'SRCDS_APPID':'2430930'}]:
                    with self.subTest(values=values), self.assertRaises(ValueError):
                        ark.install(root, 'evolved', values)

    def test_interrupted_steam_reinstall_preserves_exact_config_metadata_world_and_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'ShooterGame/Saved/Config/LinuxServer/GameUserSettings.ini'
            config.parent.mkdir(parents=True)
            data = b'; literal bytes\r\n[ServerSettings]\r\nOperator=retained\r\n'
            config.write_bytes(data);config.chmod(0o640);before=config.stat()
            world = root / 'ShooterGame/Saved/world.ark';world.write_bytes(b'owned-world')
            log = root / 'ShooterGame/Saved/old.log';log.write_bytes(b'old-log')
            def interruption(*args, **kwargs):
                self.assertEqual(args[1],376030);self.assertEqual(kwargs['platform'],'linux')
                config.write_bytes(b'publisher-default')
                raise RuntimeError('fixture interrupted Steam')
            with patch.object(ark.steam, 'update', side_effect=interruption):
                with self.assertRaises(RuntimeError):
                    ark.install(root, 'evolved', {})
            self.assertEqual(config.read_bytes(), data)
            self.assertEqual(config.stat().st_mode, before.st_mode)
            self.assertEqual(config.stat().st_mtime_ns, before.st_mtime_ns)
            self.assertEqual(world.read_bytes(), b'owned-world');self.assertEqual(log.read_bytes(),b'old-log')

    def test_engine_steam_real_original_relative_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / '.voltra/steamcmd';(source/'linux32').mkdir(parents=True)
            (source/'steamcmd.sh').write_text('fixture bootstrap');(source/'linux32/steamcmd').write_bytes(b'fixture')
            ark.engine_steam(root)
            target = root / 'Engine/Binaries/ThirdParty/SteamCMD/Linux'
            self.assertTrue(target.is_dir());self.assertFalse(target.is_symlink())
            self.assertEqual((target/'steamapps').resolve(), root/'Steam/steamapps')
            self.assertEqual((target/'steamcmd.sh').read_text(), 'fixture bootstrap')
            (target/'operator').write_text('keep');ark.engine_steam(root)
            self.assertEqual((target/'operator').read_text(),'keep')

    def test_pixark_prerequisite_and_platform_gate(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for values in [{}, {'WINE_PREREQUISITES_READY':'1'}, {'WINEARCH':'win32'}]:
                with self.subTest(values=values), self.assertRaises(ValueError):
                    ark.environment(root,'pixark',values)
            prefix=root/'.voltra/ark/pixark-prefix';prefix.mkdir(parents=True);(prefix/'system.reg').write_text('operator fixture')
            env=ark.environment(root,'pixark',{'VOLTRA_ARK_WINETRICKS_RUN':'vcrun2019 dotnet6','WINE_PREREQUISITES_READY':'1','WINEDEBUG':'+timestamp','WINEARCH':'win64','WINEPATH':'/home/container'})
            self.assertEqual(env['WINEPREFIX'],str(prefix));self.assertEqual(env['WINEDEBUG'],'+timestamp')
            self.assertEqual(env['SteamAppId'],'593600')

    def test_path_and_foreign_wine_process_protection(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as outside:
            root=Path(folder);(root/'linked').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):ark.confined(root,'linked/file')
            proc=root/'proc';proc.mkdir()
            for pid, binary in [('123',str(root/ark.GAMES['ascended'][2])),('124','/foreign/ArkAscendedServer.exe'),('125',str(root/ark.GAMES['pixark'][2]))]:
                (proc/pid).mkdir();(proc/pid/'cmdline').write_bytes(binary.encode()+b'\0literal\0')
            self.assertEqual(ark.native_pids(root,'ascended',proc),[123])

    def test_rcon_real_fragmented_frames_authentication_and_exit_disconnect(self):
        with RconFixture() as server:
            self.assertEqual(ark.command(server.port,'fixture-only-password','ListPlayers'),'fixture response')
            self.assertEqual(ark.command(server.port,'fixture-only-password','DoExit',allow_disconnect=True),'')
            self.assertEqual(server.commands,['ListPlayers','DoExit'])
        with RconFixture(reject=True) as server:
            with self.assertRaisesRegex(ValueError,'authentication rejected'):
                ark.command(server.port,'fixture-only-password','ListPlayers')
        one,two=socket.socketpair()
        try:
            one.sendall(struct.pack('<i',70000))
            with self.assertRaises(ValueError):ark.read_packet(two)
        finally:one.close();two.close()

    def test_real_source_fixture_supervisor_save_exit_and_asa_keepalive_order(self):
        # A tiny Python protocol fixture exercises real processes/sockets/signals.
        # It is not ARK, a player, a downloaded game or a native acceptance claim.
        for game in ('evolved', 'ascended'):
            with self.subTest(game=game), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                probe = socket.socket();probe.bind(('127.0.0.1', 0));port=probe.getsockname()[1];probe.close()
                binary=root/ark.GAMES[game][2];binary.parent.mkdir(parents=True)
                body = '''import importlib.util,os,socket,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('ark',SOURCE)
ark=importlib.util.module_from_spec(spec);spec.loader.exec_module(ark)
root=Path(os.environ['FIXTURE_ROOT'])
server=socket.socket();server.bind(('127.0.0.1',int(os.environ['FIXTURE_PORT'])));server.listen()
while True:
 connection,_=server.accept()
 with connection:
  identity,kind,password=ark.read_packet(connection)
  connection.sendall(ark.packet(identity,2,''))
  identity,kind,command=ark.read_packet(connection)
  with (root/'fixture-commands').open('a') as log:log.write(command+'\\n')
  if command=='SaveWorld':(root/'fixture-world-save').write_text('fixture-only-save')
  if command=='DoExit':sys.exit(0)
  connection.sendall(ark.packet(identity,0,'fixture-only response'))
'''.replace('SOURCE',repr(str(SOURCE)))
                binary.write_text('#!'+sys.executable+'\n'+body);binary.chmod(0o755)
                launcher=root/'fixture-supervisor.py'
                launcher.write_text('''import importlib.util,os,sys,types
from pathlib import Path
s=importlib.util.spec_from_file_location('ark',SOURCE)
ark=importlib.util.module_from_spec(s);s.loader.exec_module(ark)
root=Path.cwd();game=GAME
plan=ark.build(root,game,{'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003,28004','ARK_ADMIN_PASSWORD':'fixture-only-password'})
plan['ports']['RCONPort']=int(os.environ['FIXTURE_PORT'])
plan['args']=[]
if game=='ascended':
 class FakeProton:
  def location(self,root):return root/'fixture-proton'
 ark.helper=lambda name:FakeProton()
sys.exit(ark.run(root,game,plan,dict(os.environ)))
'''.replace('SOURCE',repr(str(SOURCE))).replace('GAME',repr(game)))
                proton=root/'fixture-proton'
                proton.write_text('#!'+sys.executable+'\nimport os,sys\nos.execv(sys.argv[2],sys.argv[2:])\n');proton.chmod(0o755)
                process=subprocess.Popen([sys.executable,'-B',str(launcher)],cwd=root,
                        env={**os.environ,'FIXTURE_ROOT':str(root),'FIXTURE_PORT':str(port),'PYTHONDONTWRITEBYTECODE':'1'},stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                try:
                    deadline=time.monotonic()+10
                    while not (root/'fixture-commands').exists():
                        if time.monotonic()>deadline or process.poll() is not None:
                            self.fail('Source protocol fixture did not initialize: '+process.communicate(timeout=2)[1].decode())
                        time.sleep(.05)
                    process.send_signal(signal.SIGTERM)
                    out,error=process.communicate(timeout=15)
                    self.assertEqual(process.returncode,0,error.decode())
                    self.assertIn(b'VOLTRA_ARK_READY',out)
                    self.assertNotIn(b'fixture-only-password',out)
                    commands=(root/'fixture-commands').read_text().splitlines()
                    self.assertEqual(commands,['ListPlayers','SaveWorld',*(['KeepAlive'] if game=='ascended' else []),'DoExit'])
                    self.assertEqual((root/'fixture-world-save').read_text(),'fixture-only-save')
                finally:
                    if process.poll() is None:process.kill();process.wait()


unittest.main()
