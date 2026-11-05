"""Offline emitted-bundle regression. No installer, acquisition, Wine or game runs."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
PROFILE = json.loads((REPO / 'internal/panel/game_library/overrides.json').read_text())['aloft/egg-aloft.json']


class EmittedAloft(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        script = PROFILE['egg']['scripts']['installation']['script']
        blocks = re.findall(r"cat > ([^ ]+) <<'([^']+)'\n(.*?)\n\2(?:\n|$)", script, re.S)
        self.assertEqual(len(blocks), 7)
        for name, _, body in blocks:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body, encoding='utf-8')
        entry = self.root / '.voltra/aloft_parity_wave2.py'
        self.assertIn('.voltra/' + entry.name + ' run aloft', PROFILE['egg']['startup'])
        spec = importlib.util.spec_from_file_location('aloft_wave26_emitted', entry)
        self.wrapper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.wrapper)
        self.runtime = self.wrapper.load_runtime()
        self.assertEqual(Path(self.runtime.__file__), self.root / '.voltra/unreal_survival_next.py')
        self.env = {'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000,28001'}
        (self.root / 'Aloft.exe').write_bytes(b'offline-placeholder-not-executable')
        (self.root / 'operator.txt').write_bytes(b'preserve\r\n')

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_documented_load_controls_and_creation_only_precedence(self):
        env = {**self.env, 'WORLD_GENERATION_SYNTAX': 'current', 'ISLAND_PRESET': 'huge',
               'CORRUPTION_PRESET': 'shrooms', 'CREATIVE_MODE': '1', 'IS_VISIBLE': 'false',
               'PRIVATE_ISLANDS': 'true', 'MAX_PLAYERS': '3', 'SERVER_NAME': 'Owned',
               'ADMIN_IDS': '76561197960287930 76561197960287931'}
        before = self.snapshot()
        argv, _, _, create, _ = self.runtime.configure(self.root, 'aloft', env)
        for token in ('servername#Owned#', 'playercount#3#', 'isvisible#false#',
                      'privateislands#true#', 'serverport#28000#', 'admin#76561197960287930#',
                      'admin#76561197960287931#'):
            self.assertIn(token, argv)
        for token in ('create#Aloft#', 'islandcount#huge#', 'corruptioncount#shrooms#', 'creative#1#'):
            self.assertIn(token, create)
        self.assertEqual(self.snapshot(), before)
        world = self.root / self.runtime.metadata()['aloft']['defaults']['SAVE_PATH'] / 'w_Aloft'
        world.mkdir(parents=True)
        (world / 'unknown-save').write_bytes(b'opaque publisher save')
        before = self.snapshot()
        self.assertIsNone(self.runtime.configure(self.root, 'aloft', {**env, 'WORLD_GENERATION_SYNTAX': 'unused'})[3])
        self.assertEqual(self.snapshot(), before)

    def test_refusal_before_mocked_lifecycle_and_byte_preservation(self):
        for changes in ({'MAX_PLAYERS': '1.5'}, {'IS_VISIBLE': 'yes'}, {'SERVER_NAME': 'x#admin#'},
                        {'SAVE_PATH': '../outside'}, {'SERVER_PORT': '28002'}, {'ADMIN_IDS': 'bad'}):
            with self.subTest(changes=changes):
                before = self.snapshot()
                with patch.object(self.wrapper.Path, 'cwd', return_value=self.root), patch.dict(os.environ, {**self.env, **changes}, clear=True), patch.object(sys, 'argv', ['fixture', 'run', 'aloft']), patch.object(self.runtime, 'main') as lifecycle:
                    with self.assertRaises(ValueError):
                        self.wrapper.main(self.runtime)
                    lifecycle.assert_not_called()
                self.assertEqual(self.snapshot(), before)

    def test_missing_payload_delegates_only_to_mocked_lifecycle(self):
        (self.root / 'Aloft.exe').unlink()
        before = self.snapshot()
        with patch.object(self.wrapper.Path, 'cwd', return_value=self.root), patch.dict(os.environ, self.env, clear=True), patch.object(sys, 'argv', ['fixture', 'run', 'aloft']), patch.object(self.runtime, 'main', return_value=7) as lifecycle:
            self.assertEqual(self.wrapper.main(self.runtime), 7)
            lifecycle.assert_called_once_with()
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
