"""Offline fixture tests. No game payload, Steam session or server process."""
import codecs
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


wrapper = load('assetto_wave3', BASE / 'internal/panel/game_library/scripts/assetto-native-authority.py')
shared = load('assetto_shared_fixture', BASE / 'internal/panel/game_library/scripts/assetto-ams-native.py')


class AssettoParityTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()
        self.env = {'SERVER_PORT': '28000', 'HTTP_PORT': '28001', 'VOLTRA_ALLOCATED_PORTS': '28000,28001', 'ADMIN_PASSWORD': 'staleadmin', 'PASSWORD': 'stalejoin', 'SERVER_PASSWORD': 'stalejoin', 'HOSTNAME': 'Stale setup', 'SERVER_NAME': 'Stale setup', 'AUTO_UPDATE': '0'}
        (self.root / 'cfg').mkdir()
        self.target = self.root / 'cfg/server_cfg.ini'
        self.original = (codecs.BOM_UTF8 + b';operator\r\n[SERVER]\r\nNAME=Operator name\r\nPASSWORD=operatorjoin\r\nADMIN_PASSWORD=operatoradmin\r\nMAX_CLIENTS=24\r\nREGISTER_TO_LOBBY=1\r\nTRACK=licensed_track\r\nUDP_PLUGIN_ADDRESS=127.0.0.1:12000\r\n[PRACTICE]\r\nNAME=Freeroam\r\n')
        self.target.write_bytes(self.original)
        (self.root / 'cfg/entry_list.ini').write_bytes(b'[CAR_0]\r\nMODEL=owned_car\r\nAI=fixed\r\n')
        for binary in ('acServer', 'AssettoServer'):
            (self.root / binary).write_bytes(b'fixture-not-executable')
        self.console = types.SimpleNamespace(run=lambda *args, **kwargs: 0)
        original_helper = shared.helper
        helper = patch.object(shared, 'helper', side_effect=lambda name: self.console if name == 'native-console' else original_helper(name))
        helper.start()
        self.addCleanup(helper.stop)
        if os.name == 'nt':
            # Explicit publication shim. Linux root acceptance should run this
            # suite unchanged to exercise shared dirfd/O_NOFOLLOW publication.
            def publish(root, relative, writer, default_mode=0o644):
                output = io.BytesIO()
                writer(output)
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(output.getvalue())
            publisher = patch.object(shared.steam, '_publish', side_effect=publish)
            publisher.start()
            self.addCleanup(publisher.stop)

    def invoke(self, game='assetto', action='run', env=None):
        with patch.object(wrapper.Path, 'cwd', return_value=self.root), patch.dict(os.environ, env or self.env, clear=True), patch.object(sys, 'argv', ['fixture', action, game]):
            return wrapper.main(shared)

    def test_both_wrapper_paths_preserve_native_values_reconcile_ports_and_mask_secrets(self):
        for game, binary in (('assetto', 'acServer'), ('assettoserver', 'AssettoServer')):
            self.target.write_bytes(self.original)
            with patch.object(self.console, 'run', return_value=17) as run, patch.object(shared, 'configure', side_effect=AssertionError('old overwrite path')):
                self.assertEqual(self.invoke(game), 17)
            current = self.target.read_bytes()
            self.assertTrue(current.startswith(codecs.BOM_UTF8))
            for line in self.original[len(codecs.BOM_UTF8):].splitlines(keepends=True):
                self.assertIn(line, current)
            self.assertIn(b'UDP_PORT = 28000\r\n', current)
            self.assertIn(b'TCP_PORT = 28000\r\n', current)
            self.assertIn(b'HTTP_PORT = 28001\r\n', current)
            self.assertEqual(run.call_args.args[1], [str(self.root / binary)])
            self.assertIn('operatorjoin', run.call_args.kwargs['credentials'])
            self.assertIn('operatoradmin', run.call_args.kwargs['credentials'])
            with patch.object(self.console, 'run', return_value=0):
                self.invoke(game, env={**self.env, 'MAX_CLIENTS': '2', 'PUBLIC_SERVER': '0'})
            self.assertEqual(self.target.read_bytes(), current)

    def test_missing_native_values_seed_once_from_original_controls(self):
        self.target.write_bytes(b'[SERVER]\nTRACK=operator\n')
        with patch.object(self.console, 'run', return_value=0):
            self.invoke('assettoserver', env={**self.env, 'MAX_CLIENTS': '19', 'PUBLIC_SERVER': '1'})
        current = self.target.read_bytes()
        for line in (b'NAME = Stale setup', b'PASSWORD = stalejoin', b'ADMIN_PASSWORD = staleadmin', b'MAX_CLIENTS = 19', b'REGISTER_TO_LOBBY = 1'):
            self.assertIn(line, current)

    def test_ai_entry_yaml_plugins_and_content_are_untouched(self):
        files = {'cfg/extra_cfg.yml': b'#operator\nEnableAi: true\nPlugins: [OperatorPlugin]\n', 'plugins/OperatorPlugin/config.json': b'{"operator":true}', 'content/tracks/owned/ai/fast_lane.ai': b'operator spline', 'cfg/entry_list.ini': (self.root / 'cfg/entry_list.ini').read_bytes()}
        for name, data in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.invoke('assettoserver')
        for name, data in files.items():
            self.assertEqual((self.root / name).read_bytes(), data)

    def test_aliases_refuse_before_update_or_any_write(self):
        for text in ('[SERVER]\nPASSWORD=one\npassword=two\n', '[SERVER]\n[server]\n'):
            self.target.write_text(text)
            before = self.target.read_bytes()
            with patch.object(shared, 'install') as install, self.assertRaises(ValueError):
                self.invoke(env={**self.env, 'AUTO_UPDATE': '1'})
            self.assertFalse(install.called)
            self.assertEqual(self.target.read_bytes(), before)

    def test_invalid_ports_and_invalid_missing_secret_refuse_before_acquisition(self):
        for env in ({**self.env, 'HTTP_PORT': '28000'}, {**self.env, 'VOLTRA_ALLOCATED_PORTS': '28000,99999'}, {**self.env, 'HTTP_PORT': '28009'}):
            with patch.object(shared, 'install') as install, self.assertRaises(ValueError):
                self.invoke(env={**env, 'AUTO_UPDATE': '1'})
            self.assertFalse(install.called)
        self.target.write_bytes(b'[SERVER]\n')
        with patch.object(shared, 'install') as install, self.assertRaises(ValueError):
            self.invoke(env={**self.env, 'ADMIN_PASSWORD': 'bad\nINJECT=x', 'AUTO_UPDATE': '1'})
        self.assertFalse(install.called)

    def test_update_restores_missing_binary_and_replans_publisher_bytes(self):
        (self.root / 'acServer').unlink()
        def update(*args):
            (self.root / 'acServer').write_bytes(b'restored fixture')
            self.target.write_bytes(b'[SERVER]\nADMIN_PASSWORD=afterupdate\nPASSWORD=newjoin\n')
        with patch.object(shared, 'install', side_effect=update) as install, patch.object(self.console, 'run', return_value=0) as run:
            self.assertEqual(self.invoke(env={**self.env, 'AUTO_UPDATE': '1'}), 0)
        self.assertEqual(install.call_count, 1)
        self.assertIn('newjoin', run.call_args.kwargs['credentials'])
        self.assertIn('afterupdate', run.call_args.kwargs['credentials'])

    def test_missing_preset_without_update_refuses_instead_of_inventing_content(self):
        (self.root / 'cfg/entry_list.ini').unlink()
        with patch.object(self.console, 'run') as run, self.assertRaises(ValueError):
            self.invoke('assettoserver')
        self.assertFalse(run.called)
        self.assertFalse((self.root / 'cfg/entry_list.ini').exists())

    def test_concurrent_native_edit_fails_publication(self):
        plan = wrapper.preflight(shared, self.root, 'assetto', self.env)
        self.target.write_bytes(b';external edit')
        with self.assertRaises(ValueError):
            wrapper.publish(shared, plan)
        self.assertEqual(self.target.read_bytes(), b';external edit')

    def test_install_retains_shared_implementation_without_publishing_planned_seeds(self):
        self.target.write_bytes(b'[SERVER]\nTRACK=keep\n')
        before = self.target.read_bytes()
        with patch.object(shared, 'install') as install:
            self.assertEqual(self.invoke('assettoserver', 'install'), 0)
        self.assertEqual(install.call_args.args[1], 'assettoserver')
        self.assertEqual(self.target.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
