"""Emitted fragment only. All external lifecycle operations are mocked."""
import importlib.util
import json
from pathlib import Path
import os
import sys
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('wave26', HERE / 'test-aloft-wave26-emitted.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.PROFILE = json.loads((base.REPO / 'artifacts/game-parity-20261029/wave27-aloft-save-path/profile-fragment.json').read_text())['aloft/egg-aloft.json']

class SavePaths(base.EmittedAloft):
    def invoke(self):
        return self.wrapper.main(self.runtime)

    def context(self):
        from contextlib import ExitStack
        stack = ExitStack()
        stack.enter_context(patch.object(self.wrapper.Path, 'cwd', return_value=self.root))
        stack.enter_context(patch.dict(os.environ, self.env, clear=True))
        stack.enter_context(patch.object(sys, 'argv', ['fixture', 'run', 'aloft']))
        return stack

    def test_other_data_world_refuses_before_any_lifecycle_and_preserves_all(self):
        default = self.root / self.runtime.metadata()['aloft']['defaults']['SAVE_PATH']
        for data in ('data06', 'Data02'):
            world = default.parent.parent / data / 'Saves/w_Aloft'
            world.mkdir(parents=True)
            (world / 'unknown.save').write_bytes(b'opaque\x00world')
        (self.root / 'operator.cfg').write_bytes(b'unknown=keep\r\n')
        before = self.snapshot()
        with self.context(), patch.object(self.runtime, 'main') as downstream:
            with self.assertRaisesRegex(ValueError, 'outside SAVE_PATH'):
                self.invoke()
            downstream.assert_not_called()
        self.assertEqual(self.snapshot(), before)

    def test_conflicting_worlds_refuse_even_when_selected_exists(self):
        self.test_other_data_world_refuses_before_any_lifecycle_and_preserves_all()
        selected = self.root / self.runtime.metadata()['aloft']['defaults']['SAVE_PATH'] / 'w_Aloft'
        selected.mkdir(parents=True)
        before = self.snapshot()
        with self.context(), patch.object(self.runtime, 'main') as downstream:
            with self.assertRaises(ValueError):
                self.invoke()
            downstream.assert_not_called()
        self.assertEqual(self.snapshot(), before)

    def test_publisher_studio_case_variant_is_detected(self):
        other = self.root / '.wine/drive_c/users/container/AppData/LocalLow/Astrolabe interactive/Aloft/data06/Saves/w_Aloft'
        other.mkdir(parents=True)
        with self.context(), patch.object(self.runtime, 'main') as downstream:
            with self.assertRaisesRegex(ValueError, 'outside SAVE_PATH'):
                self.invoke()
            downstream.assert_not_called()

    def test_existing_legacy_world_success_and_native_failure_preserve_bytes(self):
        world = self.root / self.runtime.metadata()['aloft']['defaults']['SAVE_PATH'] / 'w_Aloft'
        world.mkdir(parents=True)
        (world / 'save').write_bytes(b'legacy operator world')
        before = self.snapshot()
        for status in (0, 7):
            with self.context(), patch.object(self.runtime, 'install'), patch.object(self.runtime, 'prerequisites'), patch.object(self.runtime, 'run', return_value=status) as run:
                self.assertEqual(self.invoke(), status)
                run.assert_called_once()
                self.assertIn('load#Aloft#', run.call_args.args[1])
            self.assertEqual(self.snapshot(), before)

    def test_explicit_current_path_detection_retains_operator_world(self):
        self.env['SAVE_PATH'] = '.wine/drive_c/users/container/AppData/LocalLow/Astrolabe Interactive/Aloft/data06/Saves'
        world = self.root / self.env['SAVE_PATH'] / 'w_Aloft'
        world.mkdir(parents=True)
        (world / 'save').write_bytes(b'current opaque world')
        before = self.snapshot()
        with self.context(), patch.object(self.runtime, 'install'), patch.object(self.runtime, 'prerequisites'), patch.object(self.runtime, 'run', return_value=0) as run:
            self.assertEqual(self.invoke(), 0)
            run.assert_called_once()
        self.assertEqual(self.snapshot(), before)

if __name__ == '__main__':
    unittest.main()
