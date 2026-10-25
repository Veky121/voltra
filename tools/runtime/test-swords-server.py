import importlib.util
import json
import os
from pathlib import Path
import signal
import struct
import tempfile
import threading
import time
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'internal/panel/game_library/scripts'
spec=importlib.util.spec_from_file_location('swords_server',BASE/'swords-server.py');adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)
SECTION='/Game/Blueprints/GameModes/BP_GameInstance.BP_GameInstance_C'
# Functional field facts from actual publisher config; not guessed schema.
CONFIG='['+SECTION+']\r\nDedSrv_OwnerSteamID=00000000000000000\r\nDedSrv_MaxPlayers=16\r\nDedSrv_DaysUntilReset=1\r\nDedSrv_ResetTimeOfDay=00:00\r\nDedSrv_ResetWarningsInMinutes=60\r\n+DedSrv_ResetWarningsInMinutes=30\r\n+DedSrv_ResetWarningsInMinutes=5\r\n+DedSrv_ResetWarningsInMinutes=1\r\n'


def put(root,name,data):
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(data.encode()if isinstance(data,str)else data);return path


def pe():
    data=bytearray(256);data[:2]=b'MZ';struct.pack_into('<I',data,60,128);data[128:132]=b'PE\0\0';struct.pack_into('<H',data,132,0x8664);return data


def env(**values):return{'SERVER_PORT':'28020','VOLTRA_ALLOCATED_PORTS':'28020,28021','QUERY_PORT':'27015','SNM_OWNER_STEAM_ID':'76561198000000001',**values}


class SwordsSourceTests(unittest.TestCase):
    def test_actual_publisher_docs_define_all_six_native_environment_names(self):
        pins=json.loads((BASE/'swords-server-pins.json').read_text())
        self.assertEqual(pins['build_id'],'22822160');self.assertEqual(pins['depot'],'2058451');self.assertEqual(pins['manifest'],'1842565876521966140')
        self.assertEqual(set(pins['native_schema']['environment_to_native']),set(adapter.NATIVE_ENV));self.assertEqual(pins['native_schema']['section'],SECTION)
        self.assertEqual(sum(item['bytes']for item in pins['publisher_files']),9263)
        self.assertEqual(pins['native_schema']['environment_to_native']['SNM_PASSWORD'],'DedSrv_Password')
        self.assertEqual(pins['native_schema']['environment_to_native']['SNM_NAME'],'DedSrv_Name')

    def test_native_environment_original_values_defaults_and_blank_name(self):
        supplied=env(SNM_NAME='Scarecrow Chicken',SNM_PASSWORD='literal; password',SNM_MAX_PLAYERS='16',SNM_DAYS_UNTIL_RESET='7',SNM_RESET_TIME_OF_DAY='04:30')
        values=adapter.typed_environment(supplied)
        for name in adapter.NATIVE_ENV:self.assertEqual(values[name],supplied[name])
        values=adapter.typed_environment(env());self.assertEqual(values['SNM_NAME'],'');self.assertEqual(values['SNM_MAX_PLAYERS'],'16');self.assertEqual(values['SNM_DAYS_UNTIL_RESET'],'1');self.assertEqual(values['SNM_RESET_TIME_OF_DAY'],'00:00')

    def test_invalid_values_rejected_before_any_update_or_runtime(self):
        with tempfile.TemporaryDirectory()as folder:
            for values in({'SNM_NAME':'Same same'},{'SNM_NAME':'One'},{'SNM_RESET_TIME_OF_DAY':'24:30'},{'SNM_OWNER_STEAM_ID':'not-id'},{'SNM_MAX_PLAYERS':'-1'},{'SNM_PASSWORD':'x\nInjected'}):
                with mock.patch.object(adapter,'install')as install,mock.patch.object(adapter,'helper')as helper,self.assertRaises(ValueError):adapter.run(Path(folder),env(**values))
                install.assert_not_called();helper.assert_not_called()

    def test_original_and_allocated_ports_actual_documented_cli_before_writes(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);put(root,adapter.BINARY,pe())
            argv,values,receipt,logs=adapter.launch(root,env())
            self.assertIn('-port=28020',argv);self.assertIn('-QueryPort=28021',argv);self.assertFalse(receipt['original_query_field_applied'])
            argv,values,receipt,logs=adapter.launch(root,env(PORT_MODE='original',VOLTRA_ALLOCATED_PORTS='28020,27015'))
            self.assertIn('-QueryPort=27015',argv);self.assertTrue(receipt['original_query_field_applied'])
            with self.assertRaises(ValueError):adapter.launch(root,env(PORT_MODE='original'))
            with self.assertRaises(ValueError):adapter.launch(root,env(QUERY_PORT='28020',PORT_MODE='original'))
            self.assertFalse((root/'.voltra').exists())

    def test_first_install_copies_actual_template_bytes_never_moves(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);template=put(root,adapter.TEMPLATE,CONFIG);before=template.read_bytes()
            with mock.patch.object(adapter.steam,'update')as update:adapter.install(root,{})
            self.assertEqual(update.call_args.args[1],2058450);self.assertEqual(update.call_args.kwargs['platform'],'windows');self.assertEqual((root/adapter.CONFIG).read_bytes(),before);self.assertEqual(template.read_bytes(),before)

    def test_reinstall_success_and_failure_retain_native_admin_reset_saves_and_plugins(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);put(root,adapter.TEMPLATE,CONFIG)
            paths=[put(root,adapter.CONFIG,CONFIG+'; operator\r\nDedSrv_Name=Operator Name\r\nDedSrv_Password=ownpassword\r\n'),put(root,'SNM2020/Saved/SaveGames/world.sav','world bytes'),put(root,'SNM2020/Saved/adminconfig.json','{"moderators":[123]}'),put(root,'Plugins/own.dll','operator plugin')]
            paths[0].chmod(0o640);before=[(p.read_bytes(),p.stat().st_mode&0o777,p.stat().st_uid,p.stat().st_gid)for p in paths]
            for fail in(False,True):
                def update(*args,**kwargs):
                    for p in paths:p.write_text('publisher changed');p.chmod(0o600)
                    if fail:raise OSError('fixture partial update failure')
                with mock.patch.object(adapter.steam,'update',side_effect=update):
                    if fail:
                        with self.assertRaises(OSError):adapter.install(root,{})
                    else:adapter.install(root,{})
                for p,expected in zip(paths,before):self.assertEqual((p.read_bytes(),p.stat().st_mode&0o777,p.stat().st_uid,p.stat().st_gid),expected)

    def test_private_acquisition_platform_and_x86_fail_closed(self):
        with tempfile.TemporaryDirectory()as folder:
            with mock.patch.object(adapter.steam,'update')as update,self.assertRaises(ValueError):adapter.install(Path(folder),{'STEAM_USER':'owner','STEAM_PASS':'private'})
            update.assert_not_called()
            for values in({'SRCDS_APPID':'810040'},{'WINDOWS_INSTALL':'0'},{'WINEARCH':'win32'}):
                with self.assertRaises(ValueError):adapter.identity(values)

    def test_operator_files_inventory_no_steam_and_not_release_ownership(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);put(root,'SNM2020/Content/Paks/fixture.pak','not a real game asset');put(root,adapter.TEMPLATE,CONFIG)
            for name in(adapter.BINARY,'SNM2020/Binaries/Win64/steam_api64.dll','SNM2020/Binaries/Win64/steamclient64.dll'):put(root,name,pe())
            with mock.patch.object(adapter.steam,'update')as update:adapter.install(root,{'INSTALL_MODE':'operator_files','STEAM_PASS':'unused'})
            update.assert_not_called();inventory=json.loads((root/'.voltra/swords/operator-files.json').read_text());self.assertFalse(inventory['publisher_authenticity_verified']);self.assertFalse(inventory['runtime_verified']);self.assertEqual(len(inventory['files']),4)
            self.assertEqual((root/adapter.TEMPLATE).read_bytes(),CONFIG.encode())

    def test_runtime_transmits_all_native_env_keeps_game_ini_and_actual_signal(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);put(root,adapter.BINARY,pe());config=put(root,adapter.CONFIG,CONFIG+'; operator\r\n');before=config.read_bytes()
            prerequisites=mock.Mock();prerequisites.prepare.return_value={'STEAM_PASS':'must not reach child','SNM_RESET_WARNINGS_IN_MINUTES':'120,60,10'};console=mock.Mock();console.run.return_value=0;follower=mock.Mock()
            def helper(name):return prerequisites if name=='private-wine-prerequisites'else console if name=='native-console'else follower
            values=env(AUTO_UPDATE='0',SNM_NAME='Scarecrow Chicken',SNM_PASSWORD='secretpass',SNM_MAX_PLAYERS='20',SNM_DAYS_UNTIL_RESET='3',SNM_RESET_TIME_OF_DAY='05:45')
            with mock.patch.object(adapter,'helper',side_effect=helper):self.assertEqual(adapter.run(root,values),0)
            environment=console.run.call_args.args[2]
            for key in adapter.NATIVE_ENV:self.assertEqual(environment[key],values[key])
            self.assertNotIn('STEAM_PASS',environment);self.assertEqual(environment['SNM_RESET_WARNINGS_IN_MINUTES'],'120,60,10');self.assertEqual(console.run.call_args.args[3],'');self.assertEqual(console.run.call_args.kwargs['stop_signal'],signal.SIGINT)
            self.assertEqual(config.read_bytes(),before);receipt=json.loads((root/'.voltra/swords/runtime-source.json').read_text());self.assertFalse(receipt['game_ini_modified_at_launch']);self.assertFalse(receipt['original_query_field_applied']);self.assertEqual(receipt['applied_ports']['QUERY_PORT'],28021)
            self.assertEqual(prerequisites.prepare.call_args.args[2],'vcrun2019')

    def test_publisher_timestamped_logs_only_new_files_are_followed(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);logs=root/'SNM2020/Saved/Logs';old=put(root,'SNM2020/Saved/Logs/SnMDedSrv-old.log','old');finished=threading.Event();follow=mock.Mock()
            worker=threading.Thread(target=adapter.publisher_logs,args=(root,logs,finished,['secret'],{old.name},follow));worker.start()
            new=put(root,'SNM2020/Saved/Logs/SnMDedSrv-new.log','new')
            try:
                for _ in range(20):
                    if follow.called:break
                    time.sleep(.02)
            finally:finished.set();worker.join(timeout=2)
            self.assertFalse(worker.is_alive());self.assertEqual(follow.call_count,1);self.assertEqual(follow.call_args.args[0],new)


if __name__=='__main__':unittest.main()
