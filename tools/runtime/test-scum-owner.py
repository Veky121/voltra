"""Offline tests execute only installer-emitted filenames in isolated subprocesses."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

BASE=Path('artifacts/game-parity-20261029/scum-owner')
class Packaging(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        profile=json.loads((BASE/'profile.pending.json').read_text())['scum/egg-scum.json']
        script=profile['egg']['scripts']['installation']['script']
        for name, content in re.findall(r'cat > "\$work/([^"/]+)" <<\'VOLTRA_SCUM_SOURCE\'\n(.*?)\nVOLTRA_SCUM_SOURCE',script,re.S):
            target=self.root/'.voltra'/name; target.parent.mkdir(exist_ok=True); target.write_text(content,encoding='utf-8')
        self.env={**os.environ,'SERVER_PORT':'7777','QUERY_PORT':'27015','VOLTRA_ALLOCATED_PORTS':'7777,27015','AUTO_UPDATE':'0'}
    def tearDown(self): self.temp.cleanup()
    def run_helper(self,mode,**values):
        return subprocess.run([sys.executable,str(self.root/'.voltra/scum-native.py'),mode],cwd=self.root,env={**self.env,**values},capture_output=True,text=True)
    def test_packaged_imports_and_preflight(self):
        p=self.run_helper('preflight'); self.assertEqual(p.returncode,0,p.stderr)
    def test_invalid_refuses_without_native_writes(self):
        for values in [{'MAX_PLAYERS':'0'},{'SERVER_PLAYSTYLE':'bad'},{'SERVER_NAME':'bad\nkey=x'},{'QUERY_PORT':'7777'},{'AUTO_UPDATE':'yes'},{'STEAM_USER':'private'},{'WINETRICKS_RUN':'arbitrary'}]:
            with self.subTest(values=values):
                p=self.run_helper('install',**values); self.assertNotEqual(p.returncode,0)
                self.assertFalse((self.root/'SCUM').exists()); self.assertFalse((self.root/'.voltra/melee-preserve').exists())
    def test_seed_once_and_native_password_preserved(self):
        binary=self.root/'SCUM/Binaries/Win64/SCUMServer.exe';binary.parent.mkdir(parents=True);binary.write_bytes(b'MZ fixture')
        p=self.run_helper('configure',SERVER_NAME='seed'); self.assertEqual(p.returncode,0,p.stderr)
        config=self.root/'SCUM/Saved/Config/WindowsServer/ServerSettings.ini'
        config.write_bytes(b'; operator\r\n[General]\r\nscum.ServerName=native\r\nscum.ServerPassword=private\r\ncustom=keep\r\n')
        before=config.read_bytes()
        p=self.run_helper('configure',SERVER_NAME='changed');self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(config.read_bytes(),before)
        self.assertNotIn('private',p.stdout+p.stderr)
    def test_ambiguous_file_refuses_before_install(self):
        config=self.root/'SCUM/Saved/Config/WindowsServer/ServerSettings.ini';config.parent.mkdir(parents=True)
        config.write_text('[General]\nscum.ServerName=a\nSCUM.SERVERNAME=b\n');before=config.read_bytes()
        p=self.run_helper('install');self.assertNotEqual(p.returncode,0);self.assertEqual(config.read_bytes(),before)
        self.assertFalse((self.root/'.voltra/melee-preserve').exists())

    @unittest.skipIf(os.name == 'nt', 'POSIX bootstrap fixture runs under local WSL')
    def test_debian_bootstrap_before_preflight_without_python_on_path(self):
        profile=json.loads((BASE/'profile.pending.json').read_text())['scum/egg-scum.json']
        script=profile['egg']['scripts']['installation']['script']
        marker='python3 "$work/scum-native.py" preflight\n'
        self.assertIn(marker,script)
        prefix=script.split(marker,1)[0]+marker
        prefix=prefix.replace('cd /mnt/server','cd "$FIXTURE_SERVER"')
        for players, expected in [('24',0),('0',1)]:
            with self.subTest(players=players), tempfile.TemporaryDirectory() as directory:
                temporary=Path(directory); server=temporary/'server'; server.mkdir()
                bin=temporary/'bin'; bin.mkdir(); log=temporary/'apt.log'
                for name in ('mktemp','cat','rm'):
                    wrapper=bin/name
                    wrapper.write_text('#!/bin/sh\nexec /usr/bin/'+name+' "$@"\n')
                    wrapper.chmod(0o700)
                apt=bin/'apt-get'
                apt.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$FIXTURE_APT_LOG"\n'
                               'case "$*" in *install*python3*) /bin/ln -s "$FIXTURE_PYTHON" "$FIXTURE_BIN/python3" ;; esac\n')
                apt.chmod(0o700)
                env={**self.env,'PATH':str(bin),'FIXTURE_SERVER':str(server),
                     'FIXTURE_BIN':str(bin),'FIXTURE_PYTHON':sys.executable,
                     'FIXTURE_APT_LOG':str(log),'MAX_PLAYERS':players}
                result=subprocess.run(['/bin/bash','-c',prefix],env=env,capture_output=True,text=True,timeout=15)
                self.assertEqual(result.returncode,expected,result.stderr)
                self.assertTrue((bin/'python3').is_symlink())
                calls=log.read_text().splitlines()
                self.assertEqual(calls[0],'update')
                self.assertIn('python3',calls[1])
                self.assertEqual(len(calls),2)
                self.assertEqual(list(server.iterdir()),[])

if __name__=='__main__': unittest.main(verbosity=2)
