import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('mgh',Path('internal/panel/game_library/scripts/mgh-runtime.py'))
mgh=importlib.util.module_from_spec(spec);spec.loader.exec_module(mgh)
PORTS={'SERVER_PORT':28000,'QUERY_PORT':28001,'BEACON_PORT':28002}
ENV={**{k:str(v) for k,v in PORTS.items()},'VOLTRA_ALLOCATED_PORTS':'28000,28001,28002'}

class MGHTests(unittest.TestCase):
    def test_bytes_and_comments(self):
        before=b'\xef\xbb\xbf; operator\r\n[URL]\r\n Port = 7777 ; game\r\nUnknown=(a="x=y")\r\n[OnlineSubsystemSteam]\r\nGameServerQueryPort=27015\r\n[/Script/OnlineSubsystemUtils.OnlineBeaconHost]\r\nListenPort=7787\r\n+Mods=one\r\n+Mods=two'
        expected=before.replace(b'7777',b'28000').replace(b'27015',b'28001').replace(b'7787',b'28002')
        self.assertEqual(mgh.reconcile_ini(before,PORTS),expected)
        self.assertEqual(mgh.reconcile_ini(expected,PORTS),expected)
    def test_unknown_and_gameplay_untouched(self):
        data=b'[Game]\r\nPassword=private\r\nRoundTime=300\r\nRoundTime=600\r\n'
        self.assertEqual(mgh.reconcile_ini(data,PORTS),data)
    def test_ambiguity_refused(self):
        for data in [b'[URL]\nPort=7\nPORT=8\n',b'[URL]\nPort=7\n[url]\n',b'[URL]\nPort="7"\n']:
            with self.subTest(data=data),self.assertRaises(ValueError):mgh.reconcile_ini(data,PORTS)
    def test_refusal_before_update_and_files(self):
        for overrides in [{'QUERY_PORT':'28000'},{'SRCDS_APPID':'915810'},{'WINDOWS_INSTALL':'0'},
                          {'STEAM_PASS':'private'},{'ADDITIONAL_ARGS':'-ini:Engine:[URL]:Port=1'},
                          {'ADDITIONAL_ARGS':'-EngineIni=elsewhere'},{'ADDITIONAL_ARGS':'-ExecCmds=quit'}]:
            with tempfile.TemporaryDirectory() as directory,patch.object(mgh.family,'install') as install:
                root=Path(directory)
                with self.subTest(overrides=overrides),self.assertRaises(ValueError):mgh.execute(root,{**ENV,**overrides},'install')
                install.assert_not_called();self.assertEqual(list(root.iterdir()),[])
    def test_stopped_install_does_not_patch_operator_config(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(mgh.family,'install') as install:
            root=Path(directory);path=root/'MidnightGhostHunt/Saved/Config/WindowsServer/Engine.ini'
            path.parent.mkdir(parents=True);path.write_bytes(b'[URL]\r\nPort=7777\r\n')
            self.assertEqual(mgh.execute(root,ENV,'install'),0)
            install.assert_called_once();self.assertEqual(path.read_bytes(),b'[URL]\r\nPort=7777\r\n')
    def test_binary_save_and_mod_retained_on_update_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            paths=[root/'MidnightGhostHunt/Saved/SaveGames/profile.sav',root/'Mods/operator.pak']
            for path in paths:path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'\x00operator\xff')
            def broken(*args):
                for path in paths:path.write_bytes(b'bad')
                raise RuntimeError('SDK failed')
            with patch.object(mgh.family,'install',side_effect=broken),self.assertRaises(RuntimeError):mgh.execute(root,ENV,'install')
            for path in paths:self.assertEqual(path.read_bytes(),b'\x00operator\xff')
    def test_run_reconciles_only_listeners(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(mgh.family,'run',return_value=17),patch.object(mgh.family,'environment',return_value={}):
            root=Path(directory);path=root/'MidnightGhostHunt/Saved/Config/WindowsServer/Engine.ini'
            path.parent.mkdir(parents=True);path.write_bytes(b'; keep\r\n[URL]\r\nPort=7777\r\nUnknown=unchanged\r\n')
            result=mgh.execute(root,{**ENV,'VOLTRA_STEAM_AUTO_UPDATE':'0'},'run')
            self.assertEqual(result,17)
            self.assertEqual(path.read_bytes(),b'; keep\r\n[URL]\r\nPort=28000\r\nUnknown=unchanged\r\n')

if __name__=='__main__':unittest.main()
