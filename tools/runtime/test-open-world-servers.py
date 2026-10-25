"""Offline control/preservation fixtures, never native engine proof."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import signal
import subprocess
import threading
import queue
import unittest
from unittest.mock import patch
import zipfile
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts'
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,BASE/file);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
load('steam_template','steam-template.py');load('additional_survival_install','additional-survival-install.py');game=load('open_world_servers','open-world-servers.py')

class OpenWorldTests(unittest.TestCase):
    def test_jc3_native_exec_isolates_private_python_openssl(self):
        previous=Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as d,patch.object(game.os,'execvpe') as execute:
                root=Path(d);poison=str(root/'.voltra/python/lib')+':/operator/poison'
                game.launch(root,'jc3',{'AUTO_UPDATE':'0','SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013','LD_LIBRARY_PATH':poison,'PYTHONHOME':str(root/'.voltra/python'),'PYTHONPATH':'/poison'})
                command,argv,child=execute.call_args.args
                self.assertEqual(command,str(root/'Server'));self.assertEqual(argv,[str(root/'Server')])
                self.assertEqual(child['LD_LIBRARY_PATH'],':'.join(str(root/path)for path in('lib','linux64','.steam/sdk64','.')))
                self.assertNotIn('.voltra/python',child['LD_LIBRARY_PATH']);self.assertNotIn('/operator/poison',child['LD_LIBRARY_PATH'])
                self.assertNotIn('PYTHONHOME',child);self.assertNotIn('PYTHONPATH',child)
        finally:os.chdir(previous)
    def test_onset_offsets_literal_json_and_unknown_controls(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'server_config.json';p.write_text(json.dumps({'packages':['custom'],'pools':{'player':{'distance':123}},'plugins':['operator']}));p.chmod(0o640)
            game.configure(root,'onset',{'SERVER_PORT':'28012','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012','SERVER_NAME':'🌴 "quoted" $ name','SERVER_PASSWORD':'literal"$password','PUBLIC_SERVER':'false'})
            value=json.loads(p.read_text());self.assertEqual(value['port'],28012);self.assertEqual(value['password'],'literal"$password');self.assertEqual(value['packages'],['custom']);self.assertEqual(value['pools']['player']['distance'],123);self.assertFalse(value['masterlist']);self.assertEqual(p.stat().st_mode&0o777,0o640)
    def test_onset_missing_or_shifted_ports_reject(self):
        with tempfile.TemporaryDirectory() as d:
            for ports in ('28012','28012,28013,28014','28010,28012'):
                with self.assertRaises(ValueError):game.configure(Path(d),'onset',{'SERVER_PORT':'28012','VOLTRA_ALLOCATED_PORTS':ports})
            self.assertFalse((Path(d)/'server_config.json').exists())
    def test_jc3_all_original_config_controls_and_distinct_roles(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'config.json';p.write_text('{"requiredDLC":[400551],"custom":{"kept":true}}')
            env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013','SERVER_NAME':'Native $ name','SERVER_DESCRIPTION':'quotes " kept','SERVER_PASSWORD':'x"$ y','MAX_PLAYER':'42','TICK_RATE':'55'}
            game.configure(root,'jc3',env);value=json.loads(p.read_text());self.assertEqual([value[k] for k in ['port','queryPort','steamPort','httpPort']],[28010,28011,28012,28013]);self.assertEqual(value['maxPlayers'],42);self.assertEqual(value['maxTickRate'],55);self.assertEqual(value['password'],'x"$ y');self.assertEqual(value['requiredDLC'],[400551])
            for extra in ({'QUERY_PORT':'28010'},{'QUERY_PORT':'28011','HTTP_PORT':'28011'},{'STEAM_PORT':'4202'}):
                with self.assertRaises(ValueError):game.configure(root,'jc3',dict(env,**extra))
    def test_json_ambiguous_or_nonfinite_objects_reject(self):
        for body in ('{"a":1,"a":2}','{"nested":{"a":1,"a":2}}','{"a":NaN}','[]'):
            with self.assertRaises(ValueError):game.json_object(body)
    def test_private_steam_gate_before_update_and_no_payload_fallback(self):
        with tempfile.TemporaryDirectory() as d,patch.object(game,'update') as update:
            for env in ({'STEAM_USER':'private','STEAM_PASS':'secret'},{'SRCDS_BETAID':'secret','SRCDS_BETAPASS':'secret'},{'INSTALL_FLAGS':'+other_command'}):
                with self.assertRaises(ValueError):game.install(Path(d),'jc3',env)
            update.assert_not_called()
    def test_public_branch_and_windows_acquisition_identity_are_retained(self):
        with tempfile.TemporaryDirectory() as d,patch.object(game,'update',return_value={'fixture':True}) as update:
            game.install(Path(d),'onset',{'WINDOWS_INSTALL':'1','SRCDS_BETAID':'testing'})
            self.assertEqual(update.call_args.args[1],1204170);self.assertEqual(update.call_args.kwargs['platform'],'windows');self.assertEqual(update.call_args.kwargs['required'],('OnsetServer.exe',))
    def test_first_jc3_install_retains_generated_configuration_api(self):
        with tempfile.TemporaryDirectory() as d,patch.object(game,'update',return_value={'fixture':True}):
            root=Path(d);game.install(root,'jc3',{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012,28013','SERVER_NAME':'Initial $ name'})
            self.assertEqual(json.loads((root/'config.json').read_text())['name'],'Initial $ name')
    def preservation(self,failure):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'config.json';p.write_bytes(b'{"operator":true}\r\n');p.chmod(0o640);package=root/'packages/custom/code.js';package.parent.mkdir(parents=True);package.write_bytes(b'operator-content');package.chmod(0o600)
            if os.getuid()==0:os.chown(p,988,988);os.chown(package,988,988)
            before={x:(x.read_bytes(),x.stat().st_mode&0o777,x.stat().st_uid,x.stat().st_gid) for x in (p,package)}
            def publisher(*_,**__):
                p.write_bytes(b'publisher');p.chmod(0o644);package.write_bytes(b'publisher-package');package.chmod(0o644)
                if failure:raise RuntimeError('fixture download failure')
                return {'fixture_only':True}
            with patch.object(game,'update',side_effect=publisher):
                if failure:
                    with self.assertRaises(RuntimeError):game.install(root,'jc3',{})
                else:game.install(root,'jc3',{})
            for path,expected in before.items():self.assertEqual((path.read_bytes(),path.stat().st_mode&0o777,path.stat().st_uid,path.stat().st_gid),expected)
    def test_successful_update_preserves_operator_packages_and_metadata(self):self.preservation(False)
    def test_failed_update_preserves_operator_packages_and_metadata(self):self.preservation(True)
    def test_symlink_configuration_rejects_before_publisher(self):
        with tempfile.TemporaryDirectory() as d,patch.object(game,'update') as update:
            root=Path(d);outside=root/'outside';outside.write_text('untouched');(root/'config.json').symlink_to(outside)
            with self.assertRaises(ValueError):game.install(root,'jc3',{})
            update.assert_not_called();self.assertEqual(outside.read_text(),'untouched')
    def test_lac_native_text_and_editor_data_are_confined(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'.config/unity3d/MA/LAC/ServerConfig.txt';p.parent.mkdir(parents=True);p.write_bytes(b'# retained\r\n(Basic)\r\nstarting port=7777\r\ncustom=value\r\n');p.chmod(0o640)
            game.configure(root,'lac',{'SERVER_PORT':'28010','MAX_PLAYERS':'7','MAP_NAME':'editor:myMap,City','ADMIN_CODE':'12345'})
            data=p.read_bytes();self.assertIn(b'starting port=28010\r\n',data);self.assertIn(b'custom=value\r\n',data);self.assertIn(b'map name=editor:myMap,City',data);self.assertIn(b'admin code=12345',data);self.assertEqual(p.stat().st_mode&0o777,0o640)
            with self.assertRaises(ValueError):game.configure(root,'lac',{'MAP_NAME':'City\nstarting port=9'})
    def test_lac_version_pin_and_no_legacy_substitution(self):
        self.assertEqual(game.lac_identity({})['sha256'],'85a2592a3fafc3d92bb1021f860f29c7b4debb0869fd313cf16ce3db7f96eb8e')
        for version in ('1.6.2','../1.9.7','1.9.7;other'):
            with self.assertRaises(ValueError):game.lac_identity({'VER':version})
        self.assertIn('1.6.2.zip',game.lac_identity({'VER':'1.6.2','LAC_ARCHIVE_SHA256':'a'*64})['url'])
    def test_native_exec_preserves_noinput_sigint_and_password_out_of_argv(self):
        previous=Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as d,patch.object(game.os,'execvpe') as execute,patch.object(game,'onset_compat',return_value=Path('/private-verified-client')):
                root=Path(d);game.launch(root,'onset',{'AUTO_UPDATE':'0','SERVER_PORT':'28012','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012','SERVER_PASSWORD':'fixture-secret','STEAM_PASS':'fixture-private'})
                self.assertEqual(execute.call_args.args[1],[str(root/'OnsetServer'),'--noinput']);self.assertNotIn('STEAM_PASS',execute.call_args.args[2]);self.assertNotIn('fixture-secret',' '.join(execute.call_args.args[1]))
                os.chdir(previous)
        finally:os.chdir(previous)

    def test_derived_automatic_update_flag_takes_precedence(self):
        previous=Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as d,patch.object(game,'install') as install,patch.object(game.os,'execvpe'),patch.object(game,'onset_compat',return_value=Path('/private-verified-client')):
                root=Path(d);base={'SERVER_PORT':'28012','VOLTRA_ALLOCATED_PORTS':'28010,28011,28012'}
                game.launch(root,'onset',dict(base,AUTO_UPDATE='0',VOLTRA_STEAM_AUTO_UPDATE='1'));install.assert_called_once();install.reset_mock()
                game.launch(root,'onset',dict(base,AUTO_UPDATE='1',VOLTRA_STEAM_AUTO_UPDATE='0'));install.assert_not_called()
                os.chdir(previous)
        finally:os.chdir(previous)

    def lac_signal_fixture(self,status):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            executable=root/'LAC_Linux_v1.9.7.x86_64'
            executable.write_text('#!'+sys.executable+'\nimport signal,sys\nfrom pathlib import Path\ndef stop(*_):\n Path("actual-signal").write_text(str(int(signal.SIGTERM)))\n print("fixture native stopped",flush=True)\n sys.exit('+str(status)+')\nsignal.signal(signal.SIGINT,lambda *_:None)\nsignal.signal(signal.SIGTERM,stop)\nprint("fixture native ready",flush=True)\nfor line in sys.stdin:\n print("echo:"+line.strip(),flush=True)\n')
            executable.chmod(0o755)
            code="import importlib.util,sys,os;from pathlib import Path;root=Path(sys.argv[1]);base=Path(sys.argv[2]);"
            code+="s=importlib.util.spec_from_file_location('steam_template',base/'steam-template.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);"
            code+="s=importlib.util.spec_from_file_location('additional_survival_install',base/'additional-survival-install.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);"
            code+="s=importlib.util.spec_from_file_location('open_world_servers',base/'open-world-servers.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);sys.exit(m.launch(root,'lac',dict(os.environ,SERVER_PORT='28000',VOLTRA_ALLOCATED_PORTS='28000')))"
            child=subprocess.Popen([sys.executable,'-B','-u','-c',code,str(root),str(BASE)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            lines=queue.Queue()
            def reader():
                for line in child.stdout:lines.put(line)
            thread=threading.Thread(target=reader,daemon=True);thread.start()
            try:
                self.assertEqual(lines.get(timeout=5),b'fixture native ready\n')
                child.stdin.write(b'original console input\n');child.stdin.flush()
                self.assertEqual(lines.get(timeout=5),b'echo:original console input\n')
                child.send_signal(signal.SIGINT)
                self.assertEqual(child.wait(timeout=5),status)
                self.assertEqual((root/'actual-signal').read_text(),str(int(signal.SIGTERM)))
            finally:
                if child.poll()is None:child.kill();child.wait(timeout=5)
                child.stdin.close();thread.join(timeout=2);child.stdout.close()

    def test_lac_panel_sigint_translates_to_native_sigterm(self):self.lac_signal_fixture(0)
    def test_lac_actual_nonzero_exit_is_retained(self):self.lac_signal_fixture(7)

if __name__=='__main__':unittest.main()
