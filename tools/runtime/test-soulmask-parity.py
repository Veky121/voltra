import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('soulmask', Path('internal/panel/game_library/scripts/soulmask-parity.py'))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)


class Soulmask(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {'SERVER_PORT':'28000','QUERY_PORT':'28001','ECHO_PORT':'28002','CLUSTER_MAIN_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002,28003'}

    def config(self, content):
        path = self.root / s.CONFIG
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        path.chmod(0o640)
        return path

    def test_file_authority_roundtrip_and_seed(self):
        env = {**self.env, 'SOULMASK_SETTINGS_AUTHORITY':'file'}
        s.frontier.configure(self.root, 'soulmask', env)
        path = self.config('{ "0": {"KaiQiKuaFu": 1, "Operator": 42}, "1": {}, "2": {}, "Custom": [1,2] }\n')
        before = path.read_bytes()
        for _ in range(2):
            s.frontier.configure(self.root, 'soulmask', env)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_startup_authority_original_transfer_and_unknown(self):
        self.config('{"0":{"Custom":42},"custom":{"hello":true}}')
        s.frontier.configure(self.root,'soulmask',{**self.env,'ENABLE_CROSS_SERVER':'1'})
        value = s.json.loads((self.root/s.CONFIG).read_text())
        self.assertEqual(value['0'], {'Custom':42,'KaiQiKuaFu':1})
        self.assertEqual(value['custom'], {'hello':True})

    def test_invalid_json_before_acquisition_and_write(self):
        for content in ('{"x":NaN}', '{"x":Infinity}', '{"x":1e999}', '{"x":1,"x":2}'):
            path = self.config(content)
            with mock.patch.object(s.frontier.steam,'update') as update:
                with self.assertRaises(ValueError):
                    s.frontier.install(self.root,'soulmask',self.env)
                update.assert_not_called()
            self.assertEqual(path.read_text(),content)

    def test_symlink_config_rejected(self):
        outside = self.root/'outside.json'
        outside.write_text('{}')
        path = self.root/s.CONFIG
        path.parent.mkdir(parents=True)
        path.symlink_to(outside)
        with self.assertRaises(ValueError):
            s.plan(self.root,'soulmask',self.env)

    def test_auto_update_original_default_and_runtime_precedence(self):
        self.assertEqual(s.environment({})['VOLTRA_STEAM_AUTO_UPDATE'],'1')
        self.assertEqual(s.environment({'AUTO_UPDATE':'0'})['VOLTRA_STEAM_AUTO_UPDATE'],'0')
        self.assertEqual(s.environment({'AUTO_UPDATE':'1','VOLTRA_STEAM_AUTO_UPDATE':'0'})['VOLTRA_STEAM_AUTO_UPDATE'],'0')
        with self.assertRaises(ValueError): s.environment({'AUTO_UPDATE':'yes'})

    def test_empty_existing_config_refuses_install_without_mutation(self):
        path = self.config('')
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        for authority in ('startup', 'file'):
            with self.subTest(authority=authority), mock.patch.object(s.frontier.steam, 'update') as update:
                with self.assertRaisesRegex(ValueError, 'settings are empty'):
                    s.frontier.install(self.root, 'soulmask', {**self.env, 'SOULMASK_SETTINGS_AUTHORITY': authority})
                update.assert_not_called()
            self.assertEqual({p.relative_to(self.root): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}, before)

    def test_empty_existing_config_refuses_start_without_launch(self):
        path = self.config('')
        for auto_update in ('0', '1'):
            with self.subTest(auto_update=auto_update), mock.patch.object(s.frontier, 'helper') as helper, mock.patch.object(s.frontier.steam, 'update') as update:
                with self.assertRaisesRegex(ValueError, 'settings are empty'):
                    s.frontier.run(self.root, 'soulmask', {**self.env, 'VOLTRA_STEAM_AUTO_UPDATE': auto_update})
                helper.assert_not_called()
                update.assert_not_called()
            self.assertEqual(path.read_bytes(), b'')


if __name__ == '__main__': unittest.main()
