import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('moe', Path('internal/panel/game_library/scripts/myth-of-empires.py'))
moe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(moe)


def env(**changes):
    return dict(SERVER_PORT='28000', VOLTRA_ALLOCATED_PORTS='28000,28001,28002',
                SERVER_IP='192.0.2.10', RCON_PASSWORD='fixture-key', MOE_EULA_ACCEPTED='1', **changes)


class Tests(unittest.TestCase):
    def test_refusal_before_acquisition_or_write(self):
        for changes in ({'MOE_EULA_ACCEPTED':'0'}, {'STEAM_USER':'private'},
                        {'MAP_NAME':'invalid'}, {'EXTRA_FLAGS':'-ServerId=999'},
                        {'RCON_PORT':'28000'}, {'WINDOWS_INSTALL':'0'}):
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                data=env();data.update(changes)
                with patch.object(moe, 'original_install') as acquire:
                    with self.assertRaises(ValueError):
                        moe.install(root, 'empires', data)
                    acquire.assert_not_called()
                self.assertEqual(list(root.iterdir()), [])

    def test_preserve_complete_state_on_success_and_failure(self):
        for failure in (False, True):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root=Path(directory)
                values={'MOE/Saved/SaveGames/100/world.db':b'world\x00',
                        'MOE/Saved/Config/WindowsServer/Engine.INI':b'; comment\r\n+Mods=A\r\n+Mods=B\r\nSecret=untouched\r\n',
                        'PrivateServerTool/ServerParamConfig_100.ini':b'operator\xff'}
                for name,value in values.items():
                    path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(value)
                def update(*args):
                    for name in values:
                        (root/name).write_bytes(b'replaced')
                    if failure:
                        raise RuntimeError('fixture acquisition failure')
                with patch.object(moe,'original_install',side_effect=update):
                    if failure:
                        with self.assertRaises(RuntimeError):
                            moe.install(root,'empires',env())
                    else:
                        moe.install(root,'empires',env())
                for name,value in values.items():
                    self.assertEqual((root/name).read_bytes(),value)
                self.assertFalse(list(root.glob('.voltra-moe-retention-*')))

    def test_insufficient_space_refuses_acquisition(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(moe.shutil,'disk_usage',return_value=type('Usage',(),{'free':0})()), patch.object(moe,'original_install') as acquire:
            with self.assertRaises(ValueError):
                moe.install(Path(directory),'empires',env())
            acquire.assert_not_called()

    def test_automatic_ports_match_publisher_range_before_acquisition(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(moe, 'original_install') as acquire:
            data=env();data['VOLTRA_ALLOCATED_PORTS']='80,81,28000'
            with self.assertRaises(ValueError):
                moe.install(Path(directory),'empires',data)
            acquire.assert_not_called()
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_identity_explicit_allocations_and_disabled_management(self):
        with tempfile.TemporaryDirectory() as directory:
            data=env();data.update(SERVER_ID='1234',CLUSTER_ID='42',QUERY_PORT='28002',RCON_PORT='28001')
            plan=moe.preflight(Path(directory),data)
            for arg in ('-ServerId=1234','-ClusterId=42','-QueryPort=28002','-ShutDownServicePort=28001'):
                self.assertIn(arg,plan['args'])
            self.assertIn('fixture-key',plan['credentials'])
            data.update(SHUTDOWN_SERVICE='0',VOLTRA_ALLOCATED_PORTS='28000,28002')
            plan=moe.preflight(Path(directory),data)
            self.assertNotIn('RCON_PORT',plan['ports'])
            self.assertIn('-bStartShutDownServiceInPrivateServer=0',plan['args'])
            self.assertIn('-ShutDownServiceIP=127.0.0.1',plan['args'])

    def test_preserve_original_readiness_and_allocation_roles(self):
        with tempfile.TemporaryDirectory() as directory:
            plan=moe.preflight(Path(directory),env())
            self.assertTrue(plan['ready'].search(b'ServerId:100, ServerState:EGameServerState::SERVER_STATE_OPENED'))
            self.assertFalse(plan['ready'].search(b'ServerId:101, ServerState:EGameServerState::SERVER_STATE_OPENED'))
            self.assertEqual(plan['configs'],{})
            self.assertIn('-ShutDownServiceIP=127.0.0.1',plan['args'])


if __name__=='__main__':
    unittest.main()
