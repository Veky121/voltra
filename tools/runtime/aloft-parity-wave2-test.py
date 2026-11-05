import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('aloft_preflight', Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/aloft-preflight.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)
runtime = wrapper.load_runtime()


class AloftPreflight(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000,28001', 'AUTO_UPDATE': '1'}

    def invoke(self, extra):
        with patch.object(wrapper.Path, 'cwd', return_value=self.root), patch.object(sys, 'argv', ['fixture', 'run', 'aloft']), patch.dict(os.environ, {**self.env, **extra}, clear=True):
            return wrapper.main(runtime)

    def test_invalid_controls_refuse_before_shared_main_and_preserve_bytes(self):
        target = self.root / 'operator.txt'
        target.write_bytes(b'keep\r\n')
        cases = [
            {'SERVER_NAME': 'bad#admin#'}, {'MAX_PLAYERS': '9'}, {'MAX_PLAYERS': '1.5'},
            {'ADMIN_IDS': 'bad'}, {'IS_VISIBLE': 'yes'}, {'CREATIVE_MODE': '2'},
            {'SERVER_PORT': '28002'}, {'SAVE_PATH': '../../outside'},
            {'WORLD_GENERATION_SYNTAX': 'unknown'}, {'NUM_ISLANDS': '-1'},
            {'WORLD_GENERATION_SYNTAX': 'current', 'ISLAND_PRESET': 'bad'},
            {'WINETRICKS_RUN': 'mono;bad'}, {'SRCDS_APPID': '730'}, {'WINDOWS_INSTALL': '0'},
        ]
        with patch.object(runtime, 'main') as downstream:
            for values in cases:
                with self.subTest(values=values), self.assertRaises(ValueError):
                    self.invoke(values)
                self.assertEqual(target.read_bytes(), b'keep\r\n')
                self.assertEqual(sorted(p.name for p in self.root.iterdir()), ['operator.txt'])
            downstream.assert_not_called()

    def test_missing_binary_can_reach_existing_updater(self):
        with patch.object(runtime, 'main', return_value=7) as downstream:
            self.assertEqual(self.invoke({}), 7)
            downstream.assert_called_once_with()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_existing_world_preserves_creation_only_control_semantics(self):
        world = self.root / runtime.metadata()['aloft']['defaults']['SAVE_PATH'] / 'w_Aloft'
        world.mkdir(parents=True)
        with patch.object(runtime, 'main', return_value=0):
            self.assertEqual(self.invoke({'WORLD_GENERATION_SYNTAX': 'unused'}), 0)

    def test_regular_file_world_rejected(self):
        world = self.root / runtime.metadata()['aloft']['defaults']['SAVE_PATH'] / 'w_Aloft'
        world.parent.mkdir(parents=True)
        world.write_bytes(b'operator')
        with patch.object(runtime, 'main') as downstream, self.assertRaises(ValueError):
            self.invoke({})
        downstream.assert_not_called()
        self.assertEqual(world.read_bytes(), b'operator')

    def test_baseline_update_and_prerequisites_precede_refusal(self):
        (self.root / 'Aloft.exe').write_bytes(b'fixture')
        with patch.object(runtime.Path, 'cwd', return_value=self.root), patch.object(sys, 'argv', ['fixture', 'run', 'aloft']), patch.dict(os.environ, {**self.env, 'SERVER_NAME': 'bad#name'}, clear=True), patch.object(runtime, 'install') as install, patch.object(runtime, 'prerequisites') as prerequisites, self.assertRaises(ValueError):
            runtime.main()
        install.assert_called_once()
        prerequisites.assert_called_once()


if __name__ == '__main__':
    unittest.main()
