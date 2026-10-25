"""MIT. Source fixtures, including real tiny-process stop; no native game proof."""
import importlib.util
import os
from pathlib import Path
import queue
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

SOURCE=Path('internal/panel/game_library/scripts/ghost-love-renown.py').resolve()
spec=importlib.util.spec_from_file_location('family',SOURCE);games=importlib.util.module_from_spec(spec);spec.loader.exec_module(games)


def env(**values):
    return {'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003,27015,27016,7787',
            'QUERY_PORT':'28001','BEACON_PORT':'28002','RCON_PORT':'28003',
            'ADMIN_PASSWORD':'operator-admin','RCON_PASSWORD':'operator-rcon',**values}


def pe():
    data=bytearray(96);data[:2]=b'MZ';struct.pack_into('<I',data,60,64);data[64:68]=b'PE\0\0';struct.pack_into('<H',data,68,0x8664);return bytes(data)


class FamilyTests(unittest.TestCase):
    def test_ghost_every_original_literal_flag_and_space_map(self):
        with tempfile.TemporaryDirectory() as directory:
            result=games.plan(Path(directory),'ghost',env(MAP='Ghost Ship',GAME_NAME='Name $() literal',GAME_MODE='6v6 Hunt',REGION='Western Europe',B_DIFFICULTY='Hard',PASSWORD='join_secret',ADDITIONAL_ARGS='-NoBots -NoAutobalance'))
            for arg in ['-server','-log','-port=28000','-queryport=28001','-BeaconPort=28002','-multihome=0.0.0.0','-Map="Ghost Ship"','-Gamename="Name $() literal"','-Gamemode="6v6 Hunt"','-Region="Western Europe"','-BotDifficulty="Hard"','-password="join_secret"','-NoBots','-NoAutobalance']:
                self.assertIn(arg,result['args'])
            self.assertIn('join_secret',result['credentials'])

    def test_ghost_additional_native_flags_no_shell_or_managed_override(self):
        for value in ['-port=1','-QueryPort=1','-PASSWORD=leak','; touch outside','-Map=other','-ABSLOG=/outside','-log']:
            with self.subTest(value=value),self.assertRaises(ValueError):games.extras({'ADDITIONAL_ARGS':value})
        self.assertEqual(games.extras({'ADDITIONAL_ARGS':'-Custom="literal $()"'}),['-Custom=literal $()'])
        with tempfile.TemporaryDirectory() as directory:
            selected=games.plan(Path(directory),'ghost',env(ADDITIONAL_ARGS='-OperatorAuthToken=private-extra'))
            self.assertIn('private-extra',selected['credentials'])

    def test_love_original_public_default_and_additive_real_password(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);result=games.plan(root,'love',env())
            self.assertEqual(result['args'],['-port=28000','-queryport=28001','-servername="A Pterodactyl Server"','-log'])
            result=games.plan(root,'love',env(SERVER_PASSWORD='operator-secret'))
            self.assertIn('-serverpassword="operator-secret"',result['args']);self.assertIn('operator-secret',result['credentials'])

    def test_distinct_allocated_roles_and_renown_zero_not_disabled(self):
        for game,key,value in [('ghost','BEACON_PORT','28001'),('love','QUERY_PORT','28000'),('renown','RCON_PORT','0'),('renown','QUERY_PORT',''),('ghost','QUERY_PORT','65536')]:
            with self.subTest(game=game,key=key),self.assertRaises(ValueError):games.allocated(env(**{key:value}),game)
        self.assertEqual(len(games.allocated(env(),'renown')),4)

    def test_renown_original_controls_public_private_independent(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);result=games.configure(root,'renown',env(SERVER_NAME='Operator name',SERVER_PASSWORD='join-key',MAX_PLAYERS='64',PUBLIC='False',SERVER_LIST='True',USE_FIRST_MAP='False',FIRST_PERSON_ONLY='0',MAP_ROTATION='RSurv-Other_p',SAVE_NAME='Operator_2'))
            options=result['configs']['Renown_Combat/Saved/Config/LinuxServer/Game.ini'][games.RENOWN_SECTION]
            expected={'ServerName':'Operator name','ServerPassword':'join-key','AdminPassword':'operator-admin','EnableRCON':'True','RCONPassword':'operator-rcon','RCONPort':'28003','MaxPlayers':'64','Public':'False','PrivateSession':'True','UseFirstMap':'False','MapRotation':'RSurv-Other_p','GameSaveName':'Operator_2'}
            for key,value in expected.items():self.assertEqual(options[key],value)
            self.assertEqual(result['configs']['Renown_Combat/Saved/Config/LinuxServer/Engine.ini']['Server']['FirstPersonOnly'],'0')
            for arg in ['Renown_Combat','-PORT=28000','-QUERYPORT=28001','-BeaconPort=28002','-RCONPort=28003','-LOG=Server.log',*games.renown_seeds()['eos_args']]:self.assertIn(arg,result['args'])

    def test_original_renown_seeds_keep_nonform_gameplay_queue_party_and_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);games.configure(root,'renown',env());text=(root/'Renown_Combat/Saved/Config/LinuxServer/Game.ini').read_text()
            for value in ['ResourceGainMultiplier=1','GlobalDecayDamageMultiplier=1','bEnableServerQueue=True','DefaultMaxPartySize=5','TotalNetBandwidth=4000000','AdminWhitelist=','BanList=']:
                self.assertIn(value,text)

    def test_existing_renown_unknown_repeated_admin_mod_and_save_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'Renown_Combat/Saved/Config/LinuxServer/Game.ini';path.parent.mkdir(parents=True)
            path.write_text('['+games.RENOWN_SECTION.lower()+']\nAdminPassword=old-private\nAdminWhitelist=first\nAdminWhitelist=second\n[Operator]\nMod=one\nMod=two\n')
            saved=root/'Renown_Combat/Saved/SaveGames/Operator.sav';saved.parent.mkdir(parents=True);saved.write_bytes(b'world')
            result=games.configure(root,'renown',env())
            for value in ['AdminWhitelist=first','AdminWhitelist=second','Mod=one','Mod=two']:self.assertIn(value,path.read_text())
            self.assertIn('old-private',result['credentials']);self.assertEqual(saved.read_bytes(),b'world');self.assertEqual(path.stat().st_mode&0o777,0o600)

    def test_original_placeholder_prerequisites_and_disabled_rcon(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for values in [{'ADMIN_PASSWORD':'ChangeMe'},{'RCON_PASSWORD':'RconPassword'},{'SAVE_NAME':'../other'}]:
                with self.subTest(values=values),self.assertRaises(ValueError):games.plan(root,'renown',env(**values))
            self.assertEqual(games.plan(root,'renown',env(ENABLE_RCON='False',RCON_PASSWORD=''))['configs']['Renown_Combat/Saved/Config/LinuxServer/Game.ini'][games.RENOWN_SECTION]['EnableRCON'],'False')

    def test_platform_identity_private_and_unsafe_flags_fail_before_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for values in [{'WINDOWS_INSTALL':'0'},{'SRCDS_APPID':'1'},{'INSTALL_FLAGS':'$(touch outside)'},{'STEAM_USER':'operator','STEAM_PASS':'private'}]:
                with self.subTest(values=values),patch.object(games.steam,'update',side_effect=AssertionError('must not acquire')),self.assertRaises(ValueError):games.install(root,'ghost',env(**values))

    def test_failed_game_or_later_runtime_update_retains_exact_configs_metadata(self):
        for game in games.GAMES:
            for later in [False,True] if game!='renown' else [False]:
                with self.subTest(game=game,later=later),tempfile.TemporaryDirectory() as directory:
                    root=Path(directory);path=root/games.GAMES[game][1]/'Saved/Config/operator.ini';path.parent.mkdir(parents=True);path.write_bytes(b'operator\r\n');path.chmod(0o640);os.utime(path,ns=(1700000000000000000,1700000000000000000))
                    def update(*args,**kwargs):
                        path.write_bytes(b'overwritten')
                        if not later:raise ValueError('game failed')
                    with patch.object(games.steam,'update',side_effect=update),patch.object(games,'windows_sdk'),patch.object(games.proton,'provision',side_effect=ValueError('runtime failed')),self.assertRaises(ValueError):games.install(root,game,env())
                    self.assertEqual(path.read_bytes(),b'operator\r\n');self.assertEqual(path.stat().st_mode&0o777,0o640);self.assertEqual(path.stat().st_mtime_ns,1700000000000000000)

    def test_windows_sdk_ambiguity_and_partial_publication_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);prefix=games.GAMES['love'][3].rsplit('/',1)[0]+'/'
            target=root/(prefix+'steamclient64.dll');target.parent.mkdir(parents=True);target.write_bytes(b'old-sdk');target.chmod(0o640)
            def update(stage,*args,**kwargs):
                self.assertNotIn('SRCDS_BETAID',args[1])
                for name in ('steamclient64.dll','tier0_s64.dll','vstdlib_s64.dll'):(stage/name).write_bytes(pe())
                return {'appid':1007,'buildid':1,'StateFlags':4}
            original=games.steam._publish;failed=False
            def publish(root,name,*args,**kwargs):
                nonlocal failed
                if name.endswith('tier0_s64.dll') and not failed:failed=True;raise OSError('injected publication failure')
                return original(root,name,*args,**kwargs)
            with patch.object(games.steam,'update',side_effect=update),patch.object(games.steam,'_publish',side_effect=publish),self.assertRaises(OSError):games.windows_sdk(root,'love',{'SRCDS_BETAID':'game-branch'})
            self.assertEqual(target.read_bytes(),b'old-sdk');self.assertEqual(target.stat().st_mode&0o777,0o640)
            self.assertFalse((root/(prefix+'tier0_s64.dll')).exists())

    def test_windows_sdk_rejects_non_pe_before_publishing(self):
        with tempfile.TemporaryDirectory() as directory:
            def update(stage,*args,**kwargs):
                for name in ('steamclient64.dll','tier0_s64.dll','vstdlib_s64.dll'):(stage/name).write_bytes(b'not-PE')
                return {}
            with patch.object(games.steam,'update',side_effect=update),patch.object(games.steam,'_publish',side_effect=AssertionError('no publish')),self.assertRaises(ValueError):games.windows_sdk(Path(directory),'ghost',{})

    def test_log_tail_old_data_kept_new_secrets_redacted_and_rotation_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'native.log';path.write_bytes(b'old-log\n');done=threading.Event();chunks=[]
            thread=threading.Thread(target=games.follow_log,args=(root,path,path.stat().st_size,done,['private-secret'],chunks.append));thread.start()
            try:
                time.sleep(.15)
                with path.open('ab') as out:out.write(b'new private-secret line\n')
                time.sleep(.3);path.rename(root/'old.log');path.write_bytes(b'rotated-log\n');time.sleep(.3)
            finally:done.set();thread.join(timeout=2)
            output=b''.join(chunks);self.assertNotIn(b'old-log',output);self.assertNotIn(b'private-secret',output);self.assertIn(b'new ',output);self.assertIn(b'rotated-log',output)
            self.assertEqual((root/'old.log').read_bytes(),b'old-log\nnew private-secret line\n')

    def test_actual_adapter_stop_sigint_stdin_exit_and_log_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            childscript=root/'native.py';childscript.write_text("import signal,sys,time\nfrom pathlib import Path\ndef stop(s,f):\n Path('signal').write_text(str(s));sys.exit(0)\nsignal.signal(signal.SIGINT,stop)\nprint('REAL_PROCESS_READY',flush=True)\nfor line in sys.stdin: print('ECHO:'+line.strip(),flush=True)\n")
            wrapper=root/'wrapper.py';wrapper.write_text("import importlib.util,os,sys\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('games',sys.argv[1]);g=importlib.util.module_from_spec(s);s.loader.exec_module(g)\nroot=Path.cwd();sys.exit(g.run(root,'renown',{'binary':Path(sys.executable),'args':['-u','native.py'],'log':root/'native.log','credentials':[],'ready':b'REAL_PROCESS_READY'},dict(os.environ)))\n")
            log=root/'native.log';log.write_bytes(b'old-real-log\n')
            child=subprocess.Popen([sys.executable,'-B','-u',str(wrapper),str(SOURCE)],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);lines=queue.Queue()
            def read():
                for line in child.stdout:lines.put(line)
            reader=threading.Thread(target=read,daemon=True);reader.start()
            try:
                self.assertEqual(lines.get(timeout=5),b'REAL_PROCESS_READY\n');child.stdin.write(b'operator-command\n');child.stdin.flush();self.assertEqual(lines.get(timeout=5),b'ECHO:operator-command\n')
                child.send_signal(signal.SIGTERM);self.assertEqual(child.wait(timeout=5),0);self.assertEqual((root/'signal').read_text(),str(int(signal.SIGINT)));self.assertEqual(log.read_bytes(),b'old-real-log\n')
            finally:
                if child.poll() is None:child.kill();child.wait(timeout=5)
                child.stdin.close();reader.join(timeout=2);child.stdout.close()


if __name__=='__main__':unittest.main()
