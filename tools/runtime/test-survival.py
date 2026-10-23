import base64
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import signal
import struct
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import types
import unittest

steam = types.ModuleType('steam_template');exec(STEAM_SOURCE, steam.__dict__);sys.modules['steam_template'] = steam
rust = types.ModuleType('rust_runtime');exec(RUST_SOURCE, rust.__dict__)
installer = types.ModuleType('rust_install');exec(INSTALL_SOURCE, installer.__dict__)
keeper = types.ModuleType('core_keeper_runtime');exec(KEEPER_SOURCE, keeper.__dict__)


class SurvivalTests(unittest.TestCase):
    def fixture(self, directory):
        root = Path(directory);(root/'RustDedicated').write_bytes(b'native binary')
        return root, {'SERVER_PORT':'28020', 'VOLTRA_ALLOCATED_PORTS':'28020,28021,28022,28023'}

    def test_rust_native_config_retains_unknowns_and_literals(self):
        with tempfile.TemporaryDirectory() as directory:
            root, env = self.fixture(directory)
            target = root/'server/rust/cfg/server.cfg';target.parent.mkdir(parents=True)
            target.write_text('// operator\nserver.hostname "old"\nserver.hostname "duplicate"\nserver.tickrate 30\n')
            env.update({'HOSTNAME':'literal $name "quote"', 'APP_PORT':'-1'})
            argv, child_env, port, password = rust.configure(root, env)
            self.assertIn('server.tickrate 30', target.read_text());self.assertIn('// operator', target.read_text())
            self.assertEqual(target.read_text().count('server.hostname'), 1)
            self.assertIn('literal $name \\"quote\\"', target.read_text())
            self.assertEqual(port, 28022);self.assertGreaterEqual(len(password), 32)
            self.assertEqual(argv[argv.index('+rcon.password')+1],password)
            self.assertEqual(argv[argv.index('+app.port')+1],'1-');self.assertNotIn('PYTHONHOME', child_env)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertTrue(list((root/'.voltra/rust/config-backups').glob('*.cfg')))

    def test_rust_generated_credentials_seed_and_identity_persist(self):
        with tempfile.TemporaryDirectory() as directory:
            root, env = self.fixture(directory)
            first = rust.configure(root, env);seed = (root/'seed.txt').read_bytes()
            world = root/'server/rust/world.sav';world.write_bytes(b'world operator data')
            second = rust.configure(root, env)
            self.assertEqual(first[3], second[3]);self.assertEqual(seed, (root/'seed.txt').read_bytes())
            self.assertEqual(world.read_bytes(), b'world operator data')

    def test_rust_invalid_settings_do_not_write_managed_config(self):
        for key, value in [('HOSTNAME','bad\nquit'),('SERVER_ID','../other'),('WORLD_SIZE','999'),('WORLD_SEED','-1'),('MAX_PLAYERS','1001'),('RCON_PASS','short'),('ADDITIONAL_ARGS','+server.identity other'),('MAP_URL','http://example.invalid/map'),('VOLTRA_ALLOCATED_PORTS','28020,28021')]:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                root, env = self.fixture(directory)
                with self.assertRaises(ValueError):rust.configure(root, {**env,key:value})
                self.assertFalse((root/'server/rust/cfg/server.cfg').exists())

    def test_wipe_is_opt_in_and_retains_recoverable_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _ = self.fixture(directory)
            data = root/'server/rust/save.sav';data.parent.mkdir(parents=True);data.write_bytes(b'native save')
            self.assertEqual(installer.wipe_files(root, {'REMOVE_FILES':'server/rust/*.sav'}), [])
            removed = installer.wipe_files(root, {'REGEN_SERVER':'1','REMOVE_FILES':'server/rust/*.sav'})
            self.assertEqual(removed, ['server/rust/save.sav']);self.assertFalse(data.exists())
            self.assertEqual(next((root/'.voltra/rust/wipe-backups').rglob('save.sav')).read_bytes(), b'native save')

    def test_wipe_rejects_traversal_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root, _ = self.fixture(directory);(root/'outside').symlink_to(outside, target_is_directory=True)
            for pattern in ('../other', '/etc/passwd', '.voltra/*', 'outside', 'outside/*'):
                (root/'server').mkdir(exist_ok=True)
                with self.assertRaises(ValueError):installer.wipe_files(root, {'REGEN_SERVER':'1','REMOVE_FILES':pattern})

    def test_directory_wipe_preserves_nested_bytes_identity_permissions_and_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root,_ = self.fixture(directory);data=root/'server/rust/nested';data.mkdir(parents=True)
            world=data/'world.sav';world.write_bytes(b'native world');world.chmod(0o640);data.chmod(0o750)
            (root/'seed.txt').write_text('18473\n');before=world.stat();directory_info=data.stat()
            result=installer.wipe_files(root,{'REGEN_SERVER':'1','REMOVE_FILES':'server/rust','WORLD_SEED':'0'})
            self.assertEqual(set(result),{'server/rust','seed.txt'});self.assertFalse((root/'server/rust').exists())
            transaction=next((root/'.voltra/rust/wipe-backups').iterdir())
            backup=transaction/'server/rust/nested/world.sav';after=backup.stat()
            self.assertEqual(backup.read_bytes(),b'native world');self.assertEqual((transaction/'seed.txt').read_text(),'18473\n')
            self.assertEqual((before.st_ino,before.st_uid,before.st_gid,before.st_mode),(after.st_ino,after.st_uid,after.st_gid,after.st_mode))
            restored_dir=(transaction/'server/rust/nested').stat()
            self.assertEqual((directory_info.st_ino,directory_info.st_mode),(restored_dir.st_ino,restored_dir.st_mode))
            self.assertEqual(transaction.stat().st_mode&0o777,0o700)
            self.assertEqual(json.loads((transaction/'recovery.json').read_text())['phase'],'committed')

    def test_directory_quarantine_preserves_game_owner_and_private_backup_access(self):
        with tempfile.TemporaryDirectory() as directory:
            root,_=self.fixture(directory);data=root/'server/rust';data.mkdir(parents=True)
            world=data/'native-save.sav';world.write_text('operator state 517077');data.chmod(0o750);world.chmod(0o640)
            if os.geteuid()==0:
                for path in (root,data,world):os.chown(path,988,988)
            before=world.stat();installer.wipe_files(root,{'REGEN_SERVER':'1','REMOVE_FILES':'server/rust','WORLD_SEED':'42'})
            backup=next((root/'.voltra/rust/wipe-backups').rglob('native-save.sav'));after=backup.stat()
            self.assertEqual((before.st_ino,before.st_uid,before.st_gid,before.st_mode),(after.st_ino,after.st_uid,after.st_gid,after.st_mode))
            if os.geteuid()==0:
                code='import os,pathlib;os.setgid(988);os.setuid(988);print(pathlib.Path('+repr(str(backup))+').read_text())'
                self.assertIn('operator state 517077',subprocess.check_output([sys.executable,'-c',code],text=True))

    def test_nested_globs_collapse_ancestor_descendant_and_duplicate_matches(self):
        with tempfile.TemporaryDirectory() as directory:
            root,_=self.fixture(directory)
            for name in ('oxide/data/plugin/a.json','oxide/data/plugin/nested/b.json'):
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(name)
            result=installer.wipe_files(root,{'REGEN_SERVER':'1','REMOVE_FILES':'oxide/data/plugin/**/*.json oxide/data/plugin oxide/data/*','WORLD_SEED':'42'})
            self.assertEqual(result,['oxide/data/plugin'])
            self.assertEqual(len(list((root/'.voltra/rust/wipe-backups').rglob('a.json'))),1)
            self.assertEqual(len(list((root/'.voltra/rust/wipe-backups').rglob('b.json'))),1)

    def test_all_targets_and_protected_glob_matches_validate_before_any_move(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root,_=self.fixture(directory);data=root/'server/rust';data.mkdir(parents=True);(data/'save').write_text('world')
            (root/'.steam').mkdir();(root/'steamapps').mkdir();(root/'.voltra').mkdir()
            for pattern in ('.','./','.steam','steamapps','.v*','*','server/rust .steam'):
                with self.subTest(pattern=pattern):
                    with self.assertRaises(ValueError):installer.wipe_files(root,{'REGEN_SERVER':'1','REMOVE_FILES':pattern})
                    self.assertEqual((data/'save').read_text(),'world')
            (data/'link').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):installer.wipe_files(root,{'REGEN_SERVER':'1','REMOVE_FILES':'server/rust'})
            self.assertTrue((data/'save').exists());self.assertFalse((root/'.voltra/rust/wipe-backups').exists())

    def test_wipe_rejects_same_filesystem_mount_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root,_=self.fixture(directory);data=root/'server/rust';data.mkdir(parents=True);(data/'save').write_text('world')
            original=installer.mount_points;installer.mount_points=lambda:{data}
            try:
                with self.assertRaisesRegex(ValueError,'mounted filesystem'):installer.wipe_files(root,{'REGEN_SERVER':'1','REMOVE_FILES':'server'})
                self.assertTrue((data/'save').exists())
            finally:installer.mount_points=original

    def test_failed_quarantine_rename_rolls_back_all_previous_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root,_=self.fixture(directory)
            for name in ('a','b','c'):
                path=root/'plugins'/name;path.mkdir(parents=True);(path/'state').write_text(name)
            before={name:(root/'plugins'/name).stat().st_ino for name in ('a','b','c')}
            original=installer.os.rename;calls=[]
            def failing_rename(*args,**kwargs):
                calls.append(args)
                if len(calls)==2:raise OSError('injected same-volume rename failure')
                return original(*args,**kwargs)
            installer.os.rename=failing_rename
            try:
                with self.assertRaisesRegex(OSError,'injected'):installer.wipe_files(root,{'REGEN_SERVER':'1','REMOVE_FILES':'plugins/*','WORLD_SEED':'42'})
            finally:installer.os.rename=original
            for name in ('a','b','c'):
                self.assertEqual((root/'plugins'/name/'state').read_text(),name)
                self.assertEqual((root/'plugins'/name).stat().st_ino,before[name])
            transaction=next((root/'.voltra/rust/wipe-backups').iterdir())
            self.assertEqual(json.loads((transaction/'recovery.json').read_text())['phase'],'rolled_back')
            self.assertFalse(list(transaction.rglob('state')))

    def test_rollback_conflict_retains_backup_without_overwriting_new_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root,_=self.fixture(directory);(root/'a').write_text('original a');(root/'b').write_text('original b')
            original=installer.os.rename;calls=[]
            def conflict(*args,**kwargs):
                calls.append(args)
                if len(calls)==2:
                    (root/'a').write_text('concurrent new data')
                    raise OSError('injected second-target failure')
                return original(*args,**kwargs)
            installer.os.rename=conflict
            try:
                with self.assertRaisesRegex(RuntimeError,'needs recovery'):installer.wipe_files(root,{'REGEN_SERVER':'1','REMOVE_FILES':'a b','WORLD_SEED':'42'})
            finally:installer.os.rename=original
            transaction=next((root/'.voltra/rust/wipe-backups').iterdir())
            self.assertEqual((root/'a').read_text(),'concurrent new data');self.assertEqual((root/'b').read_text(),'original b')
            self.assertEqual((transaction/'a').read_text(),'original a')
            journal=json.loads((transaction/'recovery.json').read_text())
            self.assertEqual(journal['phase'],'rollback_failed');self.assertEqual(journal['rollback_failures'],['a'])

    def test_symlink_glob_never_enumerates_external_directory(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root,_=self.fixture(directory);external=Path(outside);(external/'private-file').write_text('must not read')
            (root/'link').symlink_to(external,target_is_directory=True)
            external_identity=(external.stat().st_dev,external.stat().st_ino)
            original=installer.os.scandir
            def guarded_scandir(path):
                info=os.fstat(path) if isinstance(path,int) else Path(path).stat()
                self.assertNotEqual((info.st_dev,info.st_ino),external_identity)
                return original(path)
            installer.os.scandir=guarded_scandir
            try:
                with self.assertRaisesRegex(ValueError,'symbolic'):installer.wipe_files(root,{'REGEN_SERVER':'1','REMOVE_FILES':'link/*'})
            finally:installer.os.scandir=original

    def test_quarantine_mount_or_symlink_is_rejected_before_steam_update(self):
        with tempfile.TemporaryDirectory() as directory,tempfile.TemporaryDirectory() as outside:
            root,_=self.fixture(directory);(root/'server').mkdir();(root/'server/save').write_text('world')
            (root/'.voltra/rust').mkdir(parents=True);backup=root/'.voltra/rust/wipe-backups';backup.symlink_to(outside,target_is_directory=True)
            calls=[];original=installer.update;installer.update=lambda *args,**kwargs:calls.append(args)
            try:
                with self.assertRaises(ValueError):installer.install(root,{'REGEN_SERVER':'1','REMOVE_FILES':'server'})
                self.assertEqual(calls,[]);self.assertTrue((root/'server/save').exists())
            finally:installer.update=original

    def test_framework_archive_rejects_escape_and_preserves_operator_plugins(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _ = self.fixture(directory);(root/'.voltra/rust').mkdir(parents=True)
            plugin = root/'oxide/plugins/operator.cs';plugin.parent.mkdir(parents=True);plugin.write_text('operator')
            archive = root/'fixture.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                for name, data in [('oxide/plugins/operator.cs', b'publisher default'),('RustDedicated_Data/Managed/patch.dll', b'patch')]:
                    info = tarfile.TarInfo(name);info.size = len(data);tar.addfile(info, io.BytesIO(data))
            installer.overlay(root, archive, 'oxide')
            self.assertEqual(plugin.read_text(), 'operator')
            self.assertEqual((root/'RustDedicated_Data/Managed/patch.dll').read_bytes(), b'patch')
            with tarfile.open(archive, 'w:gz') as tar:
                info = tarfile.TarInfo('./../escape');info.size = 1;tar.addfile(info, io.BytesIO(b'x'))
            with self.assertRaises(ValueError):installer.overlay(root, archive, 'oxide')

    def test_framework_forbidden_late_entry_cannot_partially_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _ = self.fixture(directory);(root/'.voltra/rust').mkdir(parents=True)
            archive = root/'fixture.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                for name in ('new-patch.dll','server/rust/world.sav'):
                    info = tarfile.TarInfo(name);info.size = 1;tar.addfile(info, io.BytesIO(b'x'))
            with self.assertRaises(ValueError):installer.overlay(root, archive, 'oxide')
            self.assertFalse((root/'new-patch.dll').exists())

    def test_wipe_validation_precedes_any_steam_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _ = self.fixture(directory);calls = []
            previous = installer.update
            installer.update = lambda *args,**kwargs:calls.append(args)
            try:
                with self.assertRaises(ValueError):installer.install(root, {'REGEN_SERVER':'1','REMOVE_FILES':'../outside'})
                self.assertEqual(calls, [])
                self.assertFalse((root/'.voltra').exists())
            finally:installer.update = previous

    def test_startup_update_never_applies_reinstall_wipe_flag(self):
        with tempfile.TemporaryDirectory() as directory:
            root,_=self.fixture(directory);(root/'server').mkdir();world=root/'server/save';world.write_text('operator world')
            calls=[];original=installer.update;installer.update=lambda *args,**kwargs:calls.append(args)
            try:installer.install(root,{'REGEN_SERVER':'1','REMOVE_FILES':'server'},wipe=False)
            finally:installer.update=original
            self.assertEqual(len(calls),1);self.assertEqual(world.read_text(),'operator world')
            self.assertFalse((root/'.voltra/rust/wipe-backups').exists())

    def test_metadata_install_preserves_volume_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            root, _ = self.fixture(directory)
            # The Docker invocation runs as installer root against a game-owned
            # volume; the normal WSL invocation also checks ordinary user mode.
            if os.geteuid() == 0:os.chown(root,988,988)
            expected = root.stat()
            previous = installer.update;installer.update = lambda *args,**kwargs:None
            try:installer.install(root, {'FRAMEWORK':'vanilla','REGEN_SERVER':'0'})
            finally:installer.update = previous
            metadata = root/'.voltra/rust/framework.json'
            self.assertEqual((metadata.stat().st_uid,metadata.stat().st_gid),(expected.st_uid,expected.st_gid))
            self.assertEqual(metadata.stat().st_mode & 0o777,0o600)
            if os.geteuid() == 0:
                code='import os,pathlib;os.setgid(988);os.setuid(988);print(pathlib.Path('+repr(str(metadata))+').read_text())'
                self.assertIn('vanilla',subprocess.check_output([sys.executable,'-c',code],text=True))

    def test_web_rcon_auth_masking_and_fragmented_timeout(self):
        listener = socket.socket();listener.bind(('127.0.0.1', 0));listener.listen()
        observed = []
        def server():
            with listener.accept()[0] as connection:
                request = b''
                while b'\r\n\r\n' not in request:request += connection.recv(4096)
                observed.append(request.split(b'\r\n')[0])
                key = next(line.split(b':',1)[1].strip() for line in request.split(b'\r\n') if line.startswith(b'Sec-WebSocket-Key:'))
                accept = base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
                connection.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n')
                stream = connection.makefile('rb');header = stream.read(2);length = header[1]&127
                if length == 126:length = struct.unpack('!H', stream.read(2))[0]
                mask = stream.read(4);payload = stream.read(length)
                observed.append(json.loads(bytes(b^mask[i%4] for i,b in enumerate(payload))))
                reply = json.dumps({'Identifier':1,'Message':'native saved'}).encode()
                connection.sendall(bytes([0x81,len(reply)])+reply[:2]);time.sleep(.15);connection.sendall(reply[2:])
        thread = threading.Thread(target=server);thread.start()
        client = rust.WebRCON(listener.getsockname()[1], 'private/password')
        try:
            client.send('server.save');client.socket.settimeout(.05)
            with self.assertRaises(socket.timeout):client.receive()
            client.socket.settimeout(1)
            self.assertEqual(client.receive()['Message'], 'native saved')
            self.assertEqual(observed[0], b'GET /private%2Fpassword HTTP/1.1')
            self.assertEqual(observed[1]['Message'], 'server.save')
        finally:client.close();listener.close();thread.join()

    def test_keeper_preserves_legacy_mode_and_adds_native_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);(root/'CoreKeeperServer').write_bytes(b'binary')
            env = {'SERVER_PORT':'28030','VOLTRA_ALLOCATED_PORTS':'28030,28031','WORLD_MODE':'1','WORLD_NAME':'literal $world "quotes"','WORLD_SEED':'42'}
            argv, _, _ = keeper.configure(root, env)
            self.assertEqual(argv[argv.index('-worldmode')+1], 'Hard')
            self.assertEqual(argv[argv.index('-worldname')+1], env['WORLD_NAME'])
            self.assertEqual(argv[argv.index('-worldseed')+1], '42')
            for mode in ('Normal','Hard','Creative','Casual'):
                self.assertIn(mode, keeper.configure(root, {**env,'WORLD_MODE':mode})[0])

    def test_rust_supervisor_forwards_console_and_native_term_shutdown(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            listener = socket.socket();listener.bind(('127.0.0.1',0));listener.listen();listener.settimeout(8)
            observed = []
            def server():
                try:
                    with listener.accept()[0] as connection:
                        connection.settimeout(8)
                        request = b''
                        while b'\r\n\r\n' not in request:request += connection.recv(4096)
                        key = next(line.split(b':',1)[1].strip() for line in request.split(b'\r\n') if line.startswith(b'Sec-WebSocket-Key:'))
                        accept = base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
                        connection.sendall(b'HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n')
                        stream = connection.makefile('rb')
                        while True:
                            header = stream.read(2)
                            if not header:break
                            length = header[1]&127
                            if length == 126:length = struct.unpack('!H',stream.read(2))[0]
                            mask = stream.read(4);payload = stream.read(length)
                            message = json.loads(bytes(b^mask[i%4] for i,b in enumerate(payload)))
                            observed.append(message['Message'])
                            if message['Message'] == 'server.save':
                                (root/'save.receipt').write_text('native fixture saved')
                                reply = json.dumps({'Identifier':message['Identifier'],'Message':'fixture saved'}).encode()
                                connection.sendall(bytes([0x81,len(reply)])+reply)
                            if message['Message'] == 'quit':
                                (root/'quit.receipt').write_text('native fixture quit');break
                finally:listener.close()
            thread = threading.Thread(target=server);thread.start()
            native = root/'native-fixture.py'
            native.write_text("import pathlib,time,signal\ndef stop(*_):\n pathlib.Path('quit.receipt').write_text('native SIGTERM')\n print('fixture native shutdown',flush=True)\n raise SystemExit(0)\nsignal.signal(signal.SIGTERM,stop)\nprint('Server startup complete fixture-password',flush=True)\npathlib.Path('ready.receipt').write_text('native fixture initialized')\nend=time.monotonic()+8\nwhile not pathlib.Path('quit.receipt').exists() and time.monotonic()<end:time.sleep(.02)\nraise SystemExit(0 if pathlib.Path('quit.receipt').exists() else 1)\n")
            wrapper = root/'wrapper.py'
            wrapper.write_text('import types,sys,os\nfrom pathlib import Path\nsteam=types.ModuleType("steam_template")\nexec('+repr(STEAM_SOURCE)+',steam.__dict__)\nsys.modules["steam_template"]=steam\nruntime=types.ModuleType("rust_runtime")\nexec('+repr(RUST_SOURCE)+',runtime.__dict__)\nraise SystemExit(runtime.run(Path.cwd(),[sys.executable,"native-fixture.py"],dict(os.environ),'+str(listener.getsockname()[1])+',"fixture-password"))\n')
            process = subprocess.Popen([sys.executable,str(wrapper)],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                process.stdin.write(b'server.save\n');process.stdin.flush()
                deadline = time.monotonic()+5
                while not ((root/'save.receipt').exists() and (root/'ready.receipt').exists()) and time.monotonic()<deadline:time.sleep(.02)
                self.assertTrue((root/'save.receipt').exists())
                self.assertTrue((root/'ready.receipt').exists())
                process.send_signal(signal.SIGTERM)
                output,error = process.communicate(timeout=5)
                self.assertEqual(process.returncode,0,error)
                self.assertIn(b'VOLTRA_RUST_RCON_READY',output)
                self.assertEqual(output.count(b'VOLTRA_RUST_READY'),1)
                self.assertNotIn(b'fixture-password',output)
                self.assertEqual(observed,['server.save'])
                self.assertEqual((root/'quit.receipt').read_text(),'native SIGTERM')
            finally:
                if process.poll() is None:process.kill();process.communicate()
                thread.join(timeout=9)

    def test_keeper_invalid_values_and_escaped_save_path(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory);(root/'CoreKeeperServer').write_bytes(b'binary')
            env = {'SERVER_PORT':'28030','VOLTRA_ALLOCATED_PORTS':'28030,28031'}
            for key, value in [('WORLD_NAME','bad\nname'),('GAME_ID','invalid000000000'),('MAX_PLAYERS','101'),('WORLD_INDEX','-1'),('WORLD_MODE','other')]:
                with self.assertRaises(ValueError):keeper.configure(root, {**env,key:value})
            (root/'CoreKeeperSaves').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):keeper.configure(root, env)


unittest.main()
