"""Offline Citadel pre-acquisition regressions. No game, Steam or container runs."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


load('steam_template', BASE / 'steam-template.py')
load('native_config', BASE / 'native-config.py')
load('native_console', BASE / 'native-console.py')
shared = load('fantasy_worlds_runtime', BASE / 'fantasy-worlds-runtime.py')
defaults = json.loads((BASE / 'fantasy-worlds-defaults.json').read_text())
shared.defaults = lambda: copy.deepcopy(defaults)
installer = load('fantasy_worlds_install', BASE / 'fantasy-worlds-install.py')
adapter = load('citadel_wave4', BASE / 'citadel-preflight.py')
ENV = {'SERVER_PORT': '29100', 'QPORT': '29101', 'VOLTRA_ALLOCATED_PORTS': '29100,29101', 'ADMIN_PASSWD': 'fixture-admin', 'AUTO_UPDATE': '1'}


class CitadelPreflight(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()
        (self.root / 'Config').mkdir()
        self.file = self.root / 'Config/Game.ini'
        self.content = defaults['citadel_game_ini'] + '\n[Other]\nPassword=unrelated\nUnknown=keep\n'
        self.file.write_text(self.content)

    def invoke(self, env, acquisition):
        with patch.object(adapter.Path, 'cwd', return_value=self.root), patch.dict(os.environ, env, clear=True):
            return adapter.main(shared, acquisition)

    def snapshot(self):
        return {file.relative_to(self.root).as_posix(): file.read_bytes() for file in self.root.rglob('*') if file.is_file()}

    def test_baseline_acquires_before_port_refusal(self):
        with patch.object(shared.Path, 'cwd', return_value=self.root), patch.object(sys, 'argv', ['fixture', 'citadel']), patch.dict(os.environ, {**ENV, 'QPORT': '29100'}, clear=True), patch.object(installer, 'install') as acquisition:
            with self.assertRaises(ValueError): shared.main()
        acquisition.assert_called_once()

    def test_invalid_setup_refuses_without_acquisition_or_writes(self):
        for changed in ({'QPORT': '29100'}, {'SERVER_PORT': '1'}, {'ADMIN_PASSWD': ''}, {'ADMIN_PASSWD': 'bad\nvalue'}, {'SRCDS_APPID': '1'}, {'AUTO_UPDATE': 'bad'}, {'STEAM_USER': 'operator', 'STEAM_PASS': 'not-transmitted'}):
            with self.subTest(changed=changed):
                before = self.snapshot()
                acquisition = Mock()
                with patch.object(shared, 'configure') as configure, patch.object(shared, 'run') as run:
                    with self.assertRaises(ValueError): self.invoke({**ENV, **changed}, acquisition)
                acquisition.assert_not_called(); configure.assert_not_called(); run.assert_not_called()
                self.assertEqual(self.snapshot(), before)

    def test_later_mirror_ambiguity_refuses_before_acquisition_and_preserves_all_files(self):
        target = self.root / 'Engine/Saved/Config/LinuxServer/Game.ini'
        target.parent.mkdir(parents=True)
        target.write_text(self.content + '\n[uworks]\nConnectionPort=3\n')
        before = self.snapshot()
        acquisition = Mock()
        with self.assertRaises(ValueError): self.invoke(ENV, acquisition)
        acquisition.assert_not_called(); self.assertEqual(self.snapshot(), before)

    def test_pure_plan_preserves_world_tuple_comments_and_unknown_native_values(self):
        before = self.snapshot()
        planned = adapter.preflight(shared, self.root, ENV, require_binary=False)
        value = planned[self.file]
        self.assertEqual(shared.world_tuple(value), shared.world_tuple(self.content))
        self.assertIn('Unknown=keep', value); self.assertIn('Password=unrelated', value)
        self.assertRegex(value, r'ConnectionPort=\s*29100'); self.assertRegex(value, r'QueryPort=\s*29101')
        self.assertEqual(self.snapshot(), before)

    def test_valid_update_can_repair_missing_launcher_before_configuration(self):
        events = []
        def acquire(*args, **kwargs):
            events.append('install'); (self.root / 'CitadelServer.sh').write_bytes(b'fixture')
        def configured(*args):
            events.append('configure')
            return self.root, ['fixture'], {}, '\x03', ['fixture-admin'], b'fixture-ready'
        with patch.object(shared, 'configure', side_effect=configured), patch.object(shared, 'run', return_value=17) as run:
            self.assertEqual(self.invoke(ENV, acquire), 17)
        self.assertEqual(events, ['install', 'configure']); self.assertEqual(run.call_args.kwargs['credentials'], ['fixture-admin'])

    def test_missing_launcher_without_update_refuses_before_writes(self):
        before = self.snapshot(); acquisition = Mock()
        with self.assertRaises(ValueError): self.invoke({**ENV, 'AUTO_UPDATE': '0'}, acquisition)
        acquisition.assert_not_called(); self.assertEqual(self.snapshot(), before)

    def test_failed_repair_does_not_publish_or_start(self):
        acquisition = Mock()
        with patch.object(shared, 'configure') as configure, self.assertRaises(ValueError): self.invoke(ENV, acquisition)
        acquisition.assert_called_once(); configure.assert_not_called()

    def test_non_directory_backup_refuses_before_acquisition(self):
        (self.root / '.voltra').mkdir()
        (self.root / '.voltra/fantasy-worlds').write_bytes(b'operator')
        before = self.snapshot(); acquisition = Mock()
        with self.assertRaises(ValueError): self.invoke(ENV, acquisition)
        acquisition.assert_not_called(); self.assertEqual(self.snapshot(), before)

    def test_actual_shared_configure_matches_pure_plan_and_preserves_world_values(self):
        (self.root / 'CitadelServer.sh').write_bytes(b'fixture')
        expected = adapter.preflight(shared, self.root, ENV)
        published = {}
        def fixture_write(root, target, data, private=True):
            # Windows cannot exercise Linux dirfd/O_NOFOLLOW publication. This
            # fixture verifies the real configure call and planned bytes only.
            published[target] = data
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        acquisition = Mock()
        with patch.object(shared, 'update_file', side_effect=fixture_write), patch.object(shared, 'run', return_value=0) as run:
            self.assertEqual(self.invoke({**ENV, 'AUTO_UPDATE': '0'}, acquisition), 0)
        acquisition.assert_not_called()
        self.assertEqual(published, {target: value.encode() for target, value in expected.items()})
        self.assertEqual(shared.world_tuple(self.file.read_text()), shared.world_tuple(self.content))
        self.assertEqual(run.call_args.args[3], '\x03')
        self.assertIn('fixture-admin', run.call_args.kwargs['credentials'])
        self.assertEqual(run.call_args.kwargs['ready_marker'], b'Steam Server initialized and registered with UWorks')

    @unittest.skipIf(os.name == 'nt', 'secure publisher uses Linux dirfd APIs')
    def test_linux_shared_publisher_retains_world_and_unknown_config(self):
        (self.root / 'CitadelServer.sh').write_bytes(b'fixture')
        with patch.object(shared, 'run', return_value=0):
            self.assertEqual(self.invoke({**ENV, 'AUTO_UPDATE': '0'}, Mock()), 0)
        self.assertEqual(shared.world_tuple(self.file.read_text()), shared.world_tuple(self.content))
        self.assertIn('Unknown=keep', self.file.read_text())
        self.assertEqual(self.file.stat().st_mode & 0o777, 0o600)
        self.assertTrue((self.root / 'Engine/Saved/Config/LinuxServer/Game.ini').is_file())


if __name__ == '__main__': unittest.main()
