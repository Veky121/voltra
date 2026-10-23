"""Real filesystem fixtures; no game downloads or native compatibility claims."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),BASE/(name+'.py'))
    result=importlib.util.module_from_spec(spec);sys.modules[spec.name]=result;spec.loader.exec_module(result);return result
steam=load('steam-template');load('native-config');load('native-console');proton=load('enshrouded-proton');installer=load('unreal-survival-install');runtime=load('unreal-survival-runtime')

class Unreal(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.addCleanup(self.temp.cleanup)
        self.env={'SERVER_PORT':'28000','QUERY_PORT':'28001','BEACON_PORT':'28002','SHUTDOWN_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003','WINDOWS_INSTALL':'0'}
    def binary(self,game,index=0):
        path=self.root/installer.metadata()[game]['binaries'][index];path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture binary');return path
    def config(self,game,env=None):return runtime.configure(self.root,game,{**self.env,**(env or {})})
    def test_humanitz_all_original_settings_modern(self):
        self.binary('humanitz');argv,_,_,_=self.config('humanitz')
        content=(self.root/'HumanitZServer/GameServerSettings.ini').read_text()
        info=installer.metadata()['humanitz']
        for section,entries in info['ini'].items():
            self.assertIn('['+section+']',content)
            for key,env in entries.items():self.assertIn(key+' = '+info['defaults'][env],content)
        self.assertIn('HumanitZServer',argv)
    def test_legacy_layout_keeps_unknown_ini_and_comments(self):
        self.binary('humanitz',1);path=self.root/'TSSGame/GameServerSettings.ini';path.write_text(';operator comment\n[Host Settings]\nUnknown=keep\nServerName=old\n')
        self.config('humanitz',{'SERVER_NAME':'Unicode ž " literal $x'})
        content=path.read_text();self.assertIn(';operator comment',content);self.assertIn('Unknown=keep',content);self.assertIn('Unicode ž " literal $x',content);self.assertEqual(path.stat().st_mode&0o777,0o600)
    def test_duplicate_ini_rejected(self):
        self.binary('humanitz');path=self.root/'HumanitZServer/GameServerSettings.ini';path.write_text('[Host Settings]\nServerName=one\nServerName=two\n')
        with self.assertRaises(ValueError):self.config('humanitz')
    def test_front_all_original_argv_are_literal(self):
        self.binary('front');argv,_,secrets,_=self.config('front',{'SRV_NAME':'quoted " name; $(touch bad)','SRV_PW':'private; "'})
        self.assertIn('-ServerName=quoted " name; $(touch bad)',argv);self.assertIn('private; "',secrets)
        info=installer.metadata()['front']
        for flag,key in info['args'].items():self.assertTrue(any(arg.startswith('-'+flag+'=') for arg in argv),key)
        for arg in info['fixed_args']:self.assertIn(arg,argv)
        self.assertIn('-UserDir='+str(self.root/'TheFrontManager/new')+'/',argv)
    def test_front_windows_option_is_explicit(self):
        self.binary('front',1)
        with patch.object(proton,'location',return_value=Path('/private/proton')):
            argv,child,_,_=self.config('front',{'WINDOWS_INSTALL':'1'})
        self.assertEqual(argv[:2],['/private/proton','run']);self.assertIn('2334200',child['STEAM_COMPAT_DATA_PATH'])
    def test_front_save_path_traversal_rejected(self):
        self.binary('front')
        for name in ('../escape','a/b','space name','a\\b'):
            with self.assertRaises(ValueError):self.config('front',{'CFG_NAME':name})
    def test_abiotic_flags_and_private_prefix(self):
        self.binary('abiotic')
        with patch.object(proton,'location',return_value=Path('/private/proton')):
            argv,child,_,_=self.config('abiotic',{'SERVER_PASSWORD':'a"b;$(x)','NUM_PLAYERS':'7'})
        self.assertIn('-ServerPassword=a"b;$(x)',argv);self.assertIn('-NoAsyncLoadingThread',argv);self.assertIn('-MaxServerPlayers=7',argv)
        self.assertTrue(Path(child['STEAM_COMPAT_DATA_PATH']).is_relative_to(self.root))
    def test_ports_must_be_distinct_selected(self):
        self.binary('front')
        for changes in ({'QUERY_PORT':'28000'},{'QUERY_PORT':'29999'},{'QUERY_PORT':'65536'}):
            with self.assertRaises(ValueError):self.config('front',changes)
    def test_control_injection_rejected(self):
        self.binary('humanitz')
        with self.assertRaises(ValueError):self.config('humanitz',{'SERVER_NAME':'one\nInjected=1'})
    def test_wrong_layout_and_symlink_rejected(self):
        self.binary('humanitz');self.binary('humanitz',1)
        with self.assertRaises(ValueError):self.config('humanitz')
    def test_install_failure_restores_bytes_mode_ownership(self):
        path=self.root/'HumanitZServer/GameServerSettings.ini';path.parent.mkdir();path.write_bytes(b';retain\n');path.chmod(0o640);os.chown(path,988,988)
        def publisher(*args,**kwargs):path.unlink();path.write_bytes(b'publisher bytes');raise RuntimeError('simulated failure')
        with patch.object(installer,'update',side_effect=publisher),self.assertRaises(RuntimeError):installer.install(self.root,'humanitz',{})
        self.assertEqual(path.read_bytes(),b';retain\n');self.assertEqual((path.stat().st_mode&0o777,path.stat().st_uid,path.stat().st_gid),(0o640,988,988))
    def test_front_installs_original_sdk_tool_and_platform(self):
        self.binary('front');calls=[]
        with patch.object(installer,'update',side_effect=lambda root,app,**kwargs:calls.append((app,kwargs['platform']))):installer.install(self.root,'front',{'WINDOWS_INSTALL':'0'})
        self.assertEqual(calls,[(1007,'linux'),(2334200,'linux')])
    def test_preservation_path_symlink_rejected_before_publisher(self):
        external=self.root/'outside';external.write_text('keep');(self.root/'HumanitZServer').mkdir();(self.root/'HumanitZServer/GameServerSettings.ini').symlink_to(external)
        with patch.object(installer,'update') as update,self.assertRaises(ValueError):installer.install(self.root,'humanitz',{})
        update.assert_not_called();self.assertEqual(external.read_text(),'keep')
    def test_actual_sigterm_reaches_child_as_ctrl_c(self):
        code='import importlib.util,sys,os;from pathlib import Path;'
        code+='base=Path('+repr(str(BASE))+');'
        code+="s=importlib.util.spec_from_file_location('steam_template',base/'steam-template.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);"
        code+="s=importlib.util.spec_from_file_location('native_console',base/'native-console.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
        native="import signal,time,sys;signal.signal(signal.SIGINT,lambda *_:(print('actual child SIGINT',flush=True),sys.exit(0)));print('native ready',flush=True);time.sleep(30)"
        code+="sys.exit(m.run(Path.cwd(),[sys.executable,'-u','-c',"+repr(native)+"],dict(os.environ),'\\x03',terminal_input=True))"
        child=subprocess.Popen([sys.executable,'-B','-c',code],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        try:
            self.assertIn(b'native ready',child.stdout.readline());child.send_signal(signal.SIGTERM)
            output,_=child.communicate(timeout=5);self.assertEqual(child.returncode,0,output);self.assertIn(b'actual child SIGINT',output)
        finally:
            if child.poll() is None:child.kill();child.wait()

if __name__=='__main__':unittest.main()
