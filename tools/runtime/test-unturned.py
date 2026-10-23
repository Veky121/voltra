import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import types
import unittest

steam=types.ModuleType('steam_template');exec(STEAM_SOURCE,steam.__dict__);sys.modules['steam_template']=steam
console=types.ModuleType('native_console');exec(CONSOLE_SOURCE,console.__dict__);sys.modules['native_console']=console
runtime=types.ModuleType('unturned_runtime');exec(RUNTIME_SOURCE,runtime.__dict__)


def fixture(root):
    binary=root/'Unturned_Headless.x86_64';binary.write_bytes(b'publisher binary')
    return {'SERVER_PORT':'23560','VOLTRA_ALLOCATED_PORTS':'23560,23561','SRV_ID':'PterodactylUnturned','AUTO_UPDATE':'0'}


class UnturnedTests(unittest.TestCase):
    def test_commands_preserve_comments_unknown_values_and_remove_managed_duplicates(self):
        original='// operator\r\nName old\r\nname duplicate\r\nWelcome custom text\r\nPvE\r\nOwner 76561198000000000'
        result=runtime.patch_commands(original,{'name':'literal $name "quote"','pvp':'','password':None})
        self.assertEqual(result,'// operator\r\nWelcome custom text\r\nOwner 76561198000000000\r\nname literal $name "quote"\r\npvp\r\n')

    def test_lan_does_not_require_token_and_preserves_savedata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            data=root/'Servers/PterodactylUnturned/Server';data.mkdir(parents=True)
            commands=data/'Commands.dat';commands.write_text('// user\nWelcome literal operator text\nOwner 76561198000000000\nName old\n')
            world=data/'Level.dat';world.write_bytes(b'operator world')
            argv,child_env=runtime.configure(root,{**env,'SRV_NAME':'Native $name "quote"','VOLTRA_GAME_LIBRARY_PATH':'./operator-library'})
            self.assertIn('+LanServer/PterodactylUnturned',argv)
            self.assertNotIn('-GSLT',argv)
            self.assertIn('name Native $name "quote"',commands.read_text())
            self.assertIn('Owner 76561198000000000',commands.read_text())
            self.assertEqual(commands.stat().st_mode&0o777,0o600)
            self.assertEqual(child_env['LD_LIBRARY_PATH'],'./operator-library')
            self.assertEqual(world.read_bytes(),b'operator world')
            self.assertTrue(list((root/'.voltra/unturned/config-backups').glob('*.dat')))

    def test_internet_token_written_privately_without_command_line_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root);token='a'*32
            argv,_=runtime.configure(root,{**env,'PUBLIC_SERVER':'1','GSLT':token,'SRV_PW':'private password'})
            self.assertIn('+InternetServer/PterodactylUnturned',argv)
            self.assertNotIn(token,argv);self.assertNotIn('private password',argv)
            commands=root/'Servers/PterodactylUnturned/Server/Commands.dat'
            self.assertIn('gslt '+token,commands.read_text())
            self.assertEqual(commands.stat().st_mode&0o777,0o600)

    def test_invalid_controls_and_nonconsecutive_ports_do_not_create_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            for key,value in [('VOLTRA_ALLOCATED_PORTS','23560,23562'),('SERVER_PORT','65535'),('SRV_ID','../other'),('PUBLIC_SERVER','1'),('SRV_NAME','bad\nShutdown'),('GAME_MAP','../map'),('MAX_PLAYERS','49'),('GSLT','bad token'),('OWNER_ID','not-an-id'),('PVP','true')]:
                with self.subTest(key=key):
                    with self.assertRaises(ValueError):runtime.configure(root,{**env,key:value})
                self.assertFalse((root/'Servers/PterodactylUnturned/Server/Commands.dat').exists())

    def test_unchanged_configuration_keeps_mtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=fixture(root)
            first,_=runtime.configure(root,env);commands=root/'Servers/PterodactylUnturned/Server/Commands.dat';before=commands.stat().st_mtime_ns
            second,_=runtime.configure(root,env)
            self.assertEqual(first,second);self.assertEqual(before,commands.stat().st_mtime_ns)

    def test_shared_console_signal_save_and_shutdown_with_open_input_pipe(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'steam_template.py').write_text(STEAM_SOURCE);(root/'native_console.py').write_text(CONSOLE_SOURCE)
            engine=root/'engine.sh';engine.write_text('#!/bin/sh\necho "boot"\nsleep 0.1\necho "READY"\nwhile IFS= read -r line; do\n case "$line" in save) echo "saved";; shutdown) echo "closed"; exit 0;; esac\ndone\n');engine.chmod(0o755)
            script='from native_console import run\nfrom pathlib import Path\nimport os\nraise SystemExit(run(Path.cwd(),["./engine.sh"],dict(os.environ),"shutdown",ready_marker=b"READY",autosave_seconds=0.05))'
            child=subprocess.Popen([sys.executable,'-u','-c',script],cwd=root,env={**os.environ,'PYTHONPATH':str(root)},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            try:
                self.assertEqual(child.stdout.readline().strip(),b'boot')
                self.assertEqual(child.stdout.readline().strip(),b'READY')
                self.assertEqual(child.stdout.readline().strip(),b'saved')
                child.send_signal(signal.SIGTERM)
                self.assertEqual(child.wait(timeout=10),0)
                self.assertIn(b'closed',child.stdout.read())
            finally:
                if child.poll() is None:child.kill();child.wait()
                child.stdin.close();child.stdout.close()

    def test_terminal_console_for_native_key_available_readers(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'steam_template.py').write_text(STEAM_SOURCE);(root/'native_console.py').write_text(CONSOLE_SOURCE)
            engine=root/'engine.py'
            engine.write_text('import os,sys\nassert os.isatty(0) and os.isatty(1) and os.isatty(2)\nassert os.tcgetpgrp(0)==os.getpgrp()\nassert os.get_terminal_size().columns==120\nprint("READY",flush=True)\nfor line in sys.stdin:\n if line.strip()=="save": print("saved",flush=True)\n if line.strip()=="shutdown": print("closed",flush=True);break\n')
            script='from native_console import run\nfrom pathlib import Path\nimport os,sys\nraise SystemExit(run(Path.cwd(),[sys.executable,"engine.py"],dict(os.environ),"shutdown",ready_marker=b"READY",autosave_seconds=0.05,terminal_input=True))'
            child=subprocess.Popen([sys.executable,'-u','-c',script],cwd=root,env={**os.environ,'PYTHONPATH':str(root)},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            try:
                self.assertEqual(child.stdout.readline().strip(),b'READY')
                self.assertEqual(child.stdout.readline().strip(),b'saved')
                child.send_signal(signal.SIGTERM)
                self.assertEqual(child.wait(timeout=10),0)
                self.assertIn(b'closed',child.stdout.read())
            finally:
                if child.poll() is None:child.kill();child.wait()
                child.stdin.close();child.stdout.close()


unittest.main()
