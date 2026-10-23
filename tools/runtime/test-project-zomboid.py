import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import signal
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, Mock

steam=types.ModuleType('steam_template');exec(STEAM_SOURCE,steam.__dict__);sys.modules['steam_template']=steam
runtime=types.ModuleType('project_zomboid');exec(RUNTIME_SOURCE,runtime.__dict__)


def fixture(root):
    metadata={'mainClass':'zombie/network/GameServer','classpath':['java/','java/lwjgl.jar'],
              'vmArgs':['-Djava.awt.headless=true','-Xms16g','-Xmx16g','-Dzomboid.steam=1','-Djava.library.path=linux64/:natives/']}
    (root/'ProjectZomboid64.json').write_text(json.dumps(metadata))
    java=root/'jre64/bin/java';java.parent.mkdir(parents=True);java.write_bytes(b'publisher Java')
    return {'SERVER_PORT':'23560','VOLTRA_ALLOCATED_PORTS':'23560,23561','SERVER_NAME':'Pterodactyl','SERVER_MEMORY':'6144'}


class ZomboidTests(unittest.TestCase):
    def test_template_update_ownership_overrides_image_flag_once(self):
        for image_flag,template_flag,expected in [('0','1',1),('1','0',0)]:
            child=Mock(stdout=io.BytesIO(b''));child.wait.return_value=0
            with patch.object(runtime,'update') as update,patch.object(runtime,'configure',return_value=(['fixture-java'],{})),patch.object(runtime.subprocess,'Popen',return_value=child),patch.object(runtime.threading.Thread,'start'),patch.object(runtime.signal,'signal'):
                self.assertEqual(runtime.run(Path('/fixture'),{'AUTO_UPDATE':image_flag,'VOLTRA_STEAM_AUTO_UPDATE':template_flag}),0)
                self.assertEqual(update.call_count,expected)
                if expected:self.assertFalse(update.call_args.kwargs['validate'])

    def check_console_shutdown(self, signal_stop):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            java=root/'jre64/bin/java';java.write_text('#!/bin/sh\necho "SERVER STARTED"\nwhile IFS= read -r line; do\n if [ "$line" = "quit" ]; then echo "fixture saved"; exit 0; fi\ndone\n');java.chmod(0o755)
            modules=root/'.voltra';modules.mkdir();(modules/'steam_template.py').write_text(STEAM_SOURCE)
            child=subprocess.Popen([sys.executable,'-u','-c',RUNTIME_SOURCE],cwd=root,env={**os.environ,**env,'PYTHONPATH':str(modules)},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            try:
                self.assertEqual(child.stdout.readline().strip(),b'SERVER STARTED')
                if signal_stop:child.send_signal(signal.SIGTERM)
                else:child.stdin.write(b'quit\n');child.stdin.flush()
                # Keep the parent pipe open: this reproduces Wings' console
                # connection during shutdown instead of hiding the old bug.
                self.assertEqual(child.wait(timeout=10),0)
                output=child.stdout.read()
                self.assertIn(b'fixture saved',output)
                self.assertNotIn(b'Fatal Python error',output)
            finally:
                if child.poll() is None:child.kill();child.wait()
                child.stdin.close();child.stdout.close()

    def test_native_quit_leaves_open_dashboard_pipe_without_finalizer_abort(self):
        self.check_console_shutdown(False)

    def test_signal_stop_requests_native_quit_without_finalizer_abort(self):
        self.check_console_shutdown(True)

    def test_ini_preserves_unknown_options_comments_and_line_endings(self):
        content='# operator\r\nMods=example;another\r\nPublicName=old\r\nUnknown = retained'
        result=runtime.patch_ini(content,{'PublicName':'literal $name "quote";value','Public':'false'})
        self.assertEqual(result,'# operator\r\nMods=example;another\r\nPublicName=literal $name "quote";value\r\nUnknown = retained\r\nPublic=false\r\n')
        with self.assertRaises(ValueError):runtime.patch_ini('Public=true\nPublic=false\n',{'Public':'false'})

    def test_native_metadata_launch_and_private_bootstrap_preserve_operator_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            ini=root/'.cache/Server/Pterodactyl.ini';ini.parent.mkdir(parents=True);ini.write_text('# operator\nMods=custom;another\nPublicName=old\n')
            lua=ini.with_name('Pterodactyl_SandboxVars.lua');lua.write_bytes(b'operator Lua')
            metadata=(root/'ProjectZomboid64.json').read_bytes()
            with patch.object(runtime,'available_memory',return_value=6144):argv,child_env=runtime.configure(root,{**env,'PUBLIC_NAME':'Literal $value "quote"'})
            self.assertEqual(argv[argv.index('-Xmx4608m')],'-Xmx4608m')
            self.assertIn('-Dzomboid.steam=1',argv);self.assertNotIn('-Xmx16g',argv)
            self.assertEqual(argv[argv.index('-udpport')+1],'23561')
            self.assertEqual(argv[argv.index('-cp')+1],'java/:java/lwjgl.jar')
            self.assertIn('zombie.network.GameServer',argv)
            credential=root/'.voltra/project-zomboid/admin-password'
            self.assertEqual(credential.stat().st_mode&0o777,0o600)
            self.assertEqual(argv[argv.index('-adminpassword')+1],credential.read_text())
            self.assertEqual(ini.stat().st_mode&0o777,0o600)
            self.assertIn('Mods=custom;another',ini.read_text())
            self.assertIn('PublicName=Literal $value "quote"',ini.read_text())
            self.assertEqual(lua.read_bytes(),b'operator Lua')
            self.assertEqual((root/'ProjectZomboid64.json').read_bytes(),metadata)
            self.assertTrue(list((root/'.voltra/project-zomboid/config-backups').glob('*.ini')))
            self.assertNotIn('PYTHONHOME',child_env)

    def test_existing_native_account_is_not_overwritten_or_rebootstrapped(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            database=root/'.cache/db/Pterodactyl.db';database.parent.mkdir(parents=True)
            with sqlite3.connect(database) as connection:
                connection.execute('CREATE TABLE whitelist(username TEXT,password TEXT)')
                connection.execute('INSERT INTO whitelist VALUES(?,?)',('admin','native-secret-hash'))
            before=hashlib.sha256(database.read_bytes()).hexdigest()
            with patch.object(runtime,'available_memory',return_value=6144):argv,_=runtime.configure(root,{**env,'ADMIN_PASSWORD':'new-bootstrap-value'})
            self.assertNotIn('-adminpassword',argv)
            self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(),before)
            self.assertFalse((root/'.voltra/project-zomboid/admin-password').exists())

    def test_invalid_configuration_does_not_publish_ini(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            for key,value in [('SERVER_NAME','../world'),('STEAM_PORT','23560'),('STEAM_PORT','27015'),('VOLTRA_ALLOCATED_PORTS','23560'),('MAX_PLAYERS','0'),('JAVA_HEAP_MB','6000'),('JAVA_HEAP_MB','-1'),('PUBLIC_NAME','bad\nname'),('PUBLIC_SERVER','true'),('ADMIN_USER','')]:
                with self.subTest(key=key),patch.object(runtime,'available_memory',return_value=6144):
                    with self.assertRaises(ValueError):runtime.configure(root,{**env,key:value})
                self.assertFalse((root/'.cache/Server/Pterodactyl.ini').exists())

    def test_invalid_existing_database_is_retained_for_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'existing.db';path.write_bytes(b'not a database')
            with self.assertRaises(ValueError):runtime.administrator_exists(path,'admin')
            self.assertEqual(path.read_bytes(),b'not a database')

    def test_unchanged_launch_keeps_configuration_mtime_and_bootstrap_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            with patch.object(runtime,'available_memory',return_value=6144):
                first,_=runtime.configure(root,env);ini=root/'.cache/Server/Pterodactyl.ini';before=ini.stat().st_mtime_ns
                second,_=runtime.configure(root,env)
            self.assertEqual(first,second);self.assertEqual(before,ini.stat().st_mtime_ns)


unittest.main()
