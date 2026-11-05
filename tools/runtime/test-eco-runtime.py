import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
spec = importlib.util.spec_from_file_location('eco', SCRIPTS / 'eco-runtime.py')
eco = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eco)
ENV = dict(SERVER_PORT='28020', VOLTRA_ALLOCATED_PORTS='28020,28021,28022', SLG_USER='fixture-user', SLG_PW='fixture-password', SRV_NAME='stale environment')

class EcoTests(unittest.TestCase):
    def files(self, root):
        (root / 'Configs').mkdir()
        network = root / 'Configs/Network.eco'
        network.write_text(json.dumps(dict(Name='native name', Password='native-secret', PublicServer=True, ServerCategory='future-mode', Unknown={'keep': [1, 2]})))
        (root / 'Configs/Localization.eco').write_text('{"Language":"FutureLanguage","Unknown":true}')
        return network

    def test_native_authority_unknown_modes_secrets_and_localization(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); network=self.files(root)
            locale=(root/'Configs/Localization.eco').read_bytes()
            argv,secrets=eco.configure(root,ENV)
            value=json.loads(network.read_text())
            self.assertEqual(value['Name'],'native name')
            self.assertEqual(value['ServerCategory'],'future-mode')
            self.assertEqual(value['Unknown'],{'keep':[1,2]})
            self.assertTrue(value['PublicServer'])
            self.assertEqual(value['GameServerPort'],28020)
            self.assertIn('native-secret',secrets)
            self.assertIn('--password=fixture-password',argv)
            self.assertEqual(locale,(root/'Configs/Localization.eco').read_bytes())
            before=network.read_bytes();eco.configure(root,ENV);self.assertEqual(before,network.read_bytes())

    def test_reject_before_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);network=self.files(root);before=network.read_bytes()
            for env in [dict(ENV,SLG_PW=''),dict(ENV,WEB_PORT='9999')]:
                with self.assertRaises(ValueError):eco.configure(root,env)
                self.assertEqual(before,network.read_bytes())
            (root/'Configs/Localization.eco').write_text('{"Language":1,"Language":2}')
            with self.assertRaises(ValueError):eco.configure(root,ENV)
            self.assertEqual(before,network.read_bytes())

    def test_fresh_setup_once(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);network=self.files(root);(root/'.voltra').mkdir()
            (root/'.voltra/eco-setup-pending').write_text('1')
            eco.configure(root,ENV)
            self.assertEqual(json.loads(network.read_text())['Name'],'stale environment')
            self.assertFalse((root/'.voltra/eco-setup-pending').exists())
            eco.configure(root,dict(ENV,SRV_NAME='another stale name'))
            self.assertEqual(json.loads(network.read_text())['Name'],'stale environment')

    def test_missing_entitlement_prevents_update(self):
        with patch.object(eco,'install') as install:
            with self.assertRaises(ValueError):eco.run(Path('.'),dict(ENV,SLG_PW=''))
            install.assert_not_called()

    def test_install_missing_entitlement_before_updater(self):
        base = eco.adapter()
        with tempfile.TemporaryDirectory() as temp, patch.object(eco, 'adapter', return_value=base), patch.object(base, 'install') as updater:
            with self.assertRaises(ValueError):
                eco.install(Path(temp), dict(ENV, SLG_PW=''))
            updater.assert_not_called()

    def test_reinstall_preserves_default_and_custom_world_even_on_failure(self):
        for failed in (False, True):
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                self.files(root)
                (root/'Configs/Storage.eco').write_text('{"StorageDirectory":"custom/world"}')
                for folder in ('Storage', 'custom/world'):
                    (root/folder).mkdir(parents=True)
                    (root/folder/'Game.eco').write_bytes(b'operator-world')
                base = eco.adapter()
                def update(*args):
                    for folder in ('Storage', 'custom/world'):
                        (root/folder/'Game.eco').write_bytes(b'publisher-default')
                    if failed:
                        raise OSError('fixture update failure')
                with patch.object(eco, 'adapter', return_value=base), patch.object(base, 'install', side_effect=update):
                    if failed:
                        with self.assertRaises(OSError): eco.install(root, ENV)
                    else: eco.install(root, ENV)
                for folder in ('Storage', 'custom/world'):
                    self.assertEqual((root/folder/'Game.eco').read_bytes(), b'operator-world')

    def test_storage_escape_rejected_before_update(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.files(root)
            (root/'Configs/Storage.eco').write_text('{"StorageDirectory":"../outside"}')
            base=eco.adapter()
            with patch.object(eco,'adapter',return_value=base), patch.object(base,'install') as updater:
                with self.assertRaises(ValueError): eco.install(root,ENV)
                updater.assert_not_called()

    def test_install_unallocated_port_rejected_before_update(self):
        base=eco.adapter()
        with tempfile.TemporaryDirectory() as temp, patch.object(eco,'adapter',return_value=base), patch.object(base,'install') as updater:
            with self.assertRaises(ValueError):
                eco.install(Path(temp),dict(ENV,WEB_PORT='9999'))
            updater.assert_not_called()

    @unittest.skipUnless(hasattr(__import__('os'), 'chown'), 'Unix ownership API required')
    def test_storage_restores_ownership_after_reinstall(self):
        import os
        if os.geteuid()!=0:
            self.skipTest('Changing Unix ownership requires isolated root fixture')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.files(root)
            (root/'Storage').mkdir();world=root/'Storage/Game.eco'
            world.write_bytes(b'world');os.chown(world,12345,12346)
            world.chmod(0o640)
            base=eco.adapter()
            def update(*args):
                world.unlink();world.write_bytes(b'publisher replacement')
            with patch.object(eco,'adapter',return_value=base),patch.object(base,'install',side_effect=update):
                eco.install(root,ENV)
            self.assertEqual((world.stat().st_uid,world.stat().st_gid),(12345,12346))
            self.assertEqual(world.stat().st_mode & 0o777,0o640)
            self.assertEqual(world.read_bytes(),b'world')

    def test_supervisor_stop_secrets_environment_and_crash_exit(self):
        base=eco.adapter()
        console=type('Console', (), {})()
        from unittest.mock import Mock
        console.run=Mock(return_value=-15)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.files(root)
            with patch.object(eco,'adapter',return_value=base), patch.object(base,'helper',return_value=console):
                self.assertEqual(eco.run(root,dict(ENV,AUTO_UPDATE='0')),143)
            args,kwargs=console.run.call_args
            self.assertEqual(args[3],'exit')
            self.assertNotIn('SLG_PW',args[2])
            self.assertIn('native-secret',args[4])
            self.assertTrue(kwargs['terminal_input'])

if __name__=='__main__':unittest.main()
