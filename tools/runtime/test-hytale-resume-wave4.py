import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'
for name in ('steam-template', 'native-config', 'native-console', 'source-install', 'source-next-install', 'tactical-install', 'tactical-runtime', 'publisher-install', 'publisher-runtime', 'hytale-runtime'):
    alias = name.replace('-', '_')
    spec = importlib.util.spec_from_file_location(alias, BASE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[alias] = module
    spec.loader.exec_module(module)
import hytale_runtime as runtime


class PreflightTests(unittest.TestCase):
    def env(self, **values):
        return dict(VOLTRA_PUBLISHER='hytale', SERVER_PORT='5520', VOLTRA_ALLOCATED_PORTS='5520,5521', **values)

    def test_invalid_values_never_enter_acquisition_or_write(self):
        for delta in ({'SERVER_MEMORY':'-1'}, {'QUERY_PORT':'5520'}, {'QUERY_PORT':'5522'}, {'VOLTRA_ALLOCATED_PORTS':'bad'}, {'SERVER_PORT':'65535','VOLTRA_ALLOCATED_PORTS':'65535'}):
            env=self.env();env.update(delta)
            with self.subTest(delta=delta), tempfile.TemporaryDirectory() as folder, patch.object(runtime.publisher, 'main') as launch:
                with self.assertRaises(ValueError):runtime.main(pathlib.Path(folder), env)
                launch.assert_not_called()
                self.assertEqual(list(pathlib.Path(folder).iterdir()), [])

    def test_original_defaults_and_disabled_query_delegate_with_real_exit(self):
        for delta in ({}, {'INSTALL_SOURCEQUERY_PLUGIN':'0','QUERY_PORT':'invalid'}, {'HYTALE_AUTH_MODE':'insecure','HYTALE_PATCHLINE':'pre-release'}):
            env=self.env(**delta)
            with patch.object(runtime.publisher,'main',return_value=8) as launch:
                self.assertEqual(runtime.main(pathlib.Path('.'),env),8)
                launch.assert_called_once_with(pathlib.Path('.'),env)


if __name__ == '__main__':unittest.main()
