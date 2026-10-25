import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import struct
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'internal/panel/game_library/scripts'
spec=importlib.util.spec_from_file_location('adventure_servers',BASE/'adventure-servers.py');adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


def put(root,name,text):
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text,encoding='utf-8');return path


def env(**values):return{'SERVER_PORT':'28020','VOLTRA_ALLOCATED_PORTS':'28020,28021,28022','QUERY':'28021','STEAM':'28022','QUERY_PORT':'28021','PORT_MODE':'original',**values}


class AdventureTests(unittest.TestCase):
    def test_risk_native_command_escaping_all_controls_and_custom_commands(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);startup=put(root,'Risk of Rain 2_Data/Config/server_startup.cfg','exec server;\nremove_all_local_users;\nhost;\n')
            path=put(root,'Risk of Rain 2_Data/Config/server.cfg','// retain comment\nsv_password "old"; sv_hostname "old";\ncustom "semi; colon";\nexec other;\nhost;\nexec server;\n')
            before=startup.read_bytes();argv,secrets,log=adapter.configure(root,'risk',env(PASSWORD='literal";not_command',HOSTNAME='?? name',PLAYERS='12',ADVERTISE='0'))
            text=path.read_text()
            for value in('steam_server_heartbeat_enabled 0;','sv_port 28020;','steam_server_query_port 28021;','steam_server_steam_port 28022;','sv_maxplayers 12;','custom "semi; colon";','exec other;','// retain comment'):
                self.assertIn(value,text)
            self.assertIn('literal\\";not_command',text);self.assertNotIn('exec server;',text);self.assertNotIn('\nhost;',text)
            self.assertEqual(startup.read_bytes(),before);self.assertEqual(argv[:3],['xvfb-run','-a','wine']);self.assertEqual(secrets,['literal";not_command'])
            self.assertTrue((root/'Risk of Rain 2_Data/Config/server_pregame.cfg').is_file())

    def test_risk_initial_copy_does_not_overwrite_operator_pregame(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);put(root,'Risk of Rain 2_Data/Config/server_startup.cfg','custom_rule enabled;\nexec server;\nhost;\n');pregame=put(root,'Risk of Rain 2_Data/Config/server_pregame.cfg','operator rules')
            adapter.configure(root,'risk',env());self.assertEqual(pregame.read_text(),'operator rules')
            self.assertIn('custom_rule enabled;', (root/'Risk of Rain 2_Data/Config/server.cfg').read_text())

    def test_risk_allocated_mode_explicitly_does_not_apply_original_fixed_fields(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);put(root,'Risk of Rain 2_Data/Config/server_startup.cfg','host;')
            adapter.configure(root,'risk',env(PORT_MODE='allocated',QUERY='27016',STEAM='27017'))
            receipt=json.loads((root/'.voltra/adventure/risk-ports.json').read_text());self.assertFalse(receipt['original_query_fields_applied']);self.assertEqual(receipt['applied_ports'],{'primary':28020,'QUERY':28021,'STEAM':28022})
            with self.assertRaises(ValueError):adapter.configure(root,'risk',env(PORT_MODE='allocated',VOLTRA_ALLOCATED_PORTS='28020,28030,28031'))

    def test_risk_bad_ports_numeric_and_malformed_quotes_before_write(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);put(root,'Risk of Rain 2_Data/Config/server_startup.cfg','host;');path=put(root,'Risk of Rain 2_Data/Config/server.cfg','old config')
            for values in({'STEAM':'28021'},{'STEAM':'28020'},{'PLAYERS':'-1'},{'ADVERTISE':'true'},{'PASSWORD':'x\nmalicious'}):
                with self.assertRaises(ValueError):adapter.configure(root,'risk',env(**values))
                self.assertEqual(path.read_text(),'old config')
            with self.assertRaises(ValueError):adapter.patch_risk('custom "unterminated',{})

    def test_terra_typed_json_preserves_unknown_saves_and_password(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);path=put(root,'dedicated_server_config.json','{"Port":1,"Password":"old","SlotCount":1,"Custom":{"Keep":true}}');save=put(root,'TT2/Saved/SaveGames/own.sav','world')
            with mock.patch.object(adapter,'helper')as helper:
                helper.return_value.location.return_value=root/'proton';argv,secrets,log=adapter.configure(root,'terra',env(SERVER_PASSWORD='literal"??',MAX_PLAYERS='6'))
            data=json.loads(path.read_text());self.assertEqual(data,{'Port':28020,'Password':'literal"??','SlotCount':6,'Custom':{'Keep':True}})
            self.assertEqual(argv[1],'run');self.assertEqual(argv[-1],'-log');self.assertEqual(log,root/'TT2/Saved/Logs/TT2.log');self.assertEqual(save.read_text(),'world')
            with self.assertRaises(ValueError):adapter.configure(root,'terra',env(MAX_PLAYERS='7'))
            path.write_text('{"Password":"one","Password":"two"}')
            with self.assertRaises(ValueError):adapter.configure(root,'terra',env())

    def test_update_failure_preserves_operator_config_save_plugins_owner_mode(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);files=[put(root,'Risk of Rain 2_Data/Config/server.cfg','operator admin config'),put(root,'Risk of Rain 2_Data/profiles/server.sav','world bytes'),put(root,'BepInEx/plugins/own.dll','operator plugin')]
            files[0].chmod(0o640);before=[(p.read_bytes(),p.stat().st_mode&0o777,p.stat().st_uid,p.stat().st_gid)for p in files]
            def update(*args,**kwargs):
                for p in files:p.write_text('publisher partial overwrite');p.chmod(0o600)
                raise OSError('fixture acquisition failure')
            with mock.patch.object(adapter.steam,'update',side_effect=update),self.assertRaises(OSError):adapter.install(root,'risk',{})
            for p,expected in zip(files,before):self.assertEqual((p.read_bytes(),p.stat().st_mode&0o777,p.stat().st_uid,p.stat().st_gid),expected)

    def test_successful_reinstall_retains_operator_config(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);path=put(root,'Risk of Rain 2_Data/Config/server.cfg','operator settings')
            with mock.patch.object(adapter.steam,'update'),mock.patch.object(adapter,'sdk'):adapter.install(root,'risk',{})
            self.assertEqual(path.read_text(),'operator settings')

    def test_private_steam_and_wrong_platform_rejected_before_sdk_or_proton(self):
        with tempfile.TemporaryDirectory()as folder:
            for game in('risk','terra'):
                with mock.patch.object(adapter.steam,'update')as update,mock.patch.object(adapter,'sdk')as sdk,mock.patch.object(adapter,'helper')as helper,self.assertRaises(ValueError):adapter.install(Path(folder),game,{'STEAM_USER':'owner','STEAM_PASS':'private'})
                update.assert_not_called();sdk.assert_not_called();helper.assert_not_called()
                with self.assertRaises(ValueError):adapter.identity(game,{'WINDOWS_INSTALL':'0'})
            with self.assertRaises(ValueError):adapter.identity('risk',{'WINEARCH':'win32'})

    def test_runtime_routes_actual_signal_not_etx_or_raw_exit(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);put(root,'Risk of Rain 2_Data/Config/server_startup.cfg','host;')
            prerequisites=mock.Mock();prerequisites.prepare.return_value={};native=mock.Mock();native.run.return_value=0
            with mock.patch.object(adapter,'helper',side_effect=lambda name:prerequisites if name=='private-wine-prerequisites'else native):
                self.assertEqual(adapter.run(root,'risk',env(AUTO_UPDATE='0')),0)
            self.assertEqual(native.run.call_args.args[3],'');self.assertEqual(native.run.call_args.kwargs['stop_signal'],signal.SIGINT)
            self.assertNotIn('terminal_input',native.run.call_args.kwargs)

    def test_sdk_isolated_windows_architecture_and_no_partial_publish(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            def update(stage,app,env,**options):
                self.assertEqual(app,1007);self.assertEqual(options['platform'],'windows')
                self.assertTrue(stage.is_relative_to(root/'.voltra/adventure/sdk'))
                data=bytearray(256);data[:2]=b'MZ';struct.pack_into('<I',data,60,128);data[128:132]=b'PE\0\0';struct.pack_into('<H',data,132,0x8664)
                for name in('steamclient64.dll','tier0_s64.dll','vstdlib_s64.dll'):(stage/name).write_bytes(data)
                put(stage,'steamapps/appmanifest_1007.acf','temporary fixture')
            operator=put(root,'TT2/Binaries/Win64/steamclient64.dll','operator replacement')
            with mock.patch.object(adapter.steam,'update',side_effect=update):adapter.sdk(root,'terra')
            self.assertEqual(operator.read_text(),'operator replacement');self.assertFalse((root/'steamapps/appmanifest_1007.acf').exists())
            self.assertTrue((root/'TT2/Binaries/Win64/tier0_s64.dll').exists());self.assertEqual([p for p in(root/'.voltra/adventure/sdk').iterdir()if p.is_dir()],[])
            before=(root/'TT2/Binaries/Win64/tier0_s64.dll').read_bytes();receipt=(root/'.voltra/adventure/sdk/receipt.json').read_bytes()
            def newer(stage,*args,**kwargs):
                update(stage,*args,**kwargs)
                for name in('steamclient64.dll','tier0_s64.dll','vstdlib_s64.dll'):
                    path=stage/name;path.write_bytes(path.read_bytes()+b'new fixture revision')
            original=adapter.steam._publish;calls=0
            def fail_second(*args,**kwargs):
                nonlocal calls
                calls+=1
                if calls==2:raise OSError('fixture publication failure')
                return original(*args,**kwargs)
            with mock.patch.object(adapter.steam,'update',side_effect=newer),mock.patch.object(adapter.steam,'_publish',side_effect=fail_second),self.assertRaises(OSError):adapter.sdk(root,'terra')
            self.assertEqual((root/'TT2/Binaries/Win64/tier0_s64.dll').read_bytes(),before);self.assertEqual((root/'.voltra/adventure/sdk/receipt.json').read_bytes(),receipt);self.assertEqual(operator.read_text(),'operator replacement')

    def test_operator_files_structural_inventory_no_steam_or_ownership_claim(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);put(root,'Risk of Rain 2_Data/Config/server_startup.cfg','host;')
            data=bytearray(256);data[:2]=b'MZ';struct.pack_into('<I',data,60,128);data[128:132]=b'PE\0\0';struct.pack_into('<H',data,132,0x8664)
            for name in('Risk of Rain 2.exe','steamclient64.dll','tier0_s64.dll','vstdlib_s64.dll'):(root/name).write_bytes(data)
            with mock.patch.object(adapter.steam,'update')as update:adapter.install(root,'risk',{'INSTALL_MODE':'operator_files','STEAM_PASS':'unused-private'})
            update.assert_not_called();receipt=json.loads((root/'.voltra/adventure/operator-files.json').read_text());self.assertEqual(len(receipt['files']),4);self.assertFalse(receipt['runtime_verified']);self.assertFalse(receipt['publisher_authenticity_verified'])
            self.assertEqual((root/'Risk of Rain 2.exe').read_bytes(),data)

    def test_unicode_values_roundtrip_and_link_escape_rejected(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);literal=chr(0x65e5)+chr(0x672c)+chr(0x1f600)
            with mock.patch.object(adapter,'helper')as helper:
                helper.return_value.location.return_value=root/'proton';adapter.configure(root,'terra',env(SERVER_PASSWORD=literal))
            self.assertEqual(json.loads((root/'dedicated_server_config.json').read_text())['Password'],literal)
            (root/'dedicated_server_config.json').unlink();(root/'dedicated_server_config.json').symlink_to('/tmp/escape.json')
            with self.assertRaises(ValueError):adapter.configure(root,'terra',env())

    def test_actual_linux_fixture_process_receives_sigint_and_exits_cleanly(self):
        # This is a Python signal fixture, never publisher/game runtime proof.
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);marker=root/'signal.txt'
            child=put(root,'child.py','import signal,time,pathlib\ndef done(s,f):\n pathlib.Path('+repr(str(marker))+').write_text(str(s));raise SystemExit(0)\nsignal.signal(signal.SIGINT,done)\nprint("fixture-ready",flush=True)\nwhile True:time.sleep(.1)\n')
            runner=put(root,'runner.py','import importlib.util,pathlib,sys,signal\np=pathlib.Path('+repr(str(BASE/'adventure-servers.py'))+')\ns=importlib.util.spec_from_file_location("adapter",p);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)\nsys.exit(a.helper("native-console").run(pathlib.Path('+repr(str(root))+'),[sys.executable,'+repr(str(child))+'],dict(a.os.environ),"",stop_signal=signal.SIGINT))\n')
            process=subprocess.Popen([sys.executable,str(runner)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
            try:
                ready,_,_=select.select([process.stdout],[],[],5);self.assertTrue(ready);self.assertEqual(process.stdout.readline().strip(),b'fixture-ready')
                process.send_signal(signal.SIGTERM);out,error=process.communicate(timeout=10)
                self.assertEqual(process.returncode,0,error.decode());self.assertEqual(marker.read_text(),str(signal.SIGINT))
            finally:
                if process.poll()is None:os.killpg(process.pid,signal.SIGKILL);process.wait()


if __name__=='__main__':unittest.main()

