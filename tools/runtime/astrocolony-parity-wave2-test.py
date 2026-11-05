import codecs
import importlib.util
from pathlib import Path
import unittest
import os
import sys
import tempfile
import io
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('astro_seed', Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/astrocolony-seed.py')
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)
sys.modules['astrocolony_seed'] = planner
BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
for name in ('steam-template', 'native-config', 'native-console', 'unreal-survival-next'):
    helper_spec = importlib.util.spec_from_file_location(name.replace('-', '_'), BASE / (name + '.py'))
    helper = importlib.util.module_from_spec(helper_spec)
    sys.modules[helper_spec.name] = helper
    helper_spec.loader.exec_module(helper)
runtime_spec = importlib.util.spec_from_file_location('astro_runtime', BASE / 'astrocolony-runtime.py')
runtime = importlib.util.module_from_spec(runtime_spec)
runtime_spec.loader.exec_module(runtime)


class AstroSeedTests(unittest.TestCase):
    def setUp(self):
        self.env = {variable: str(index) for index, variable in enumerate(planner.FIELDS.values())}

    def test_operator_values_and_unknown_text_survive_stale_environment(self):
        original = (';operator\r\n[' + planner.SECTION + ']\r\nServerPassword=private\r\n'
                    'Seed=99999999999999999999\r\nUnknown=(a,b)\r\n+AdminList=one\r\n+AdminList=two\r\n'
                    '[Other]\r\nServerPassword=unrelated\r\n').encode()
        planned = planner.seed_settings(original, self.env)
        for line in original.splitlines(keepends=True):
            self.assertIn(line, planned)
        self.assertNotIn(b'ServerPassword=0\r\n', planned)
        self.assertEqual(planned, planner.seed_settings(planned, {k: 'changed' for k in self.env}))

    def test_all_original_fields_seed_then_complete_file_is_byte_identical(self):
        planned = planner.seed_settings(b'', self.env)
        for key, variable in planner.FIELDS.items():
            self.assertIn((key + '=' + self.env[variable] + '\n').encode(), planned)
        self.assertEqual(planned, planner.seed_settings(planned, {}))

    def test_bom_crlf_case_alias_and_missing_final_newline(self):
        original = codecs.BOM_UTF8 + ('[' + planner.SECTION.lower() + ']\r\nserverpassword=keep').encode()
        planned = planner.seed_settings(original, self.env)
        self.assertTrue(planned.startswith(original + b'\r\n'))
        self.assertNotIn(b'\n', planned.replace(b'\r\n', b''))
        self.assertEqual(planned.count(b'serverpassword='), 1)

    def test_duplicate_scalar_aliases_and_duplicate_sections_refuse(self):
        for content in ('[' + planner.SECTION + ']\nSeed=1\nseed=2\n',
                        '[' + planner.SECTION + ']\n[' + planner.SECTION.lower() + ']\n',
                        '[' + planner.SECTION + ']\n+ServerPassword=ambiguous\n'):
            with self.assertRaises(ValueError):
                planner.seed_settings(content.encode(), self.env)

    def test_injection_invalid_encoding_and_nul_refuse(self):
        for content in (b'\xff', b'\x00'):
            with self.assertRaises(ValueError):
                planner.seed_settings(content, self.env)
        for value in ('bad\nSeed=2', 'bad\x7f', 'bad\r'):
            with self.assertRaises(ValueError):
                planner.seed_settings(b'', {**self.env, 'SERVER_PASSWORD': value})


class AstroRuntimeTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()
        self.env = {'SERVER_PORT': '28000', 'SERVER_QUERY_PORT': '28001', 'VOLTRA_ALLOCATED_PORTS': '28000,28001', 'AUTO_UPDATE': '0', 'SERVER_PASSWORD': 'stale'}
        binary = self.root / runtime.shared.metadata()['astro']['binary']
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b'fixture-only')
        self.target = self.root / planner.FILE.lstrip('/')
        self.target.parent.mkdir(parents=True)
        if os.name == 'nt':
            # The shared secure publisher uses Linux dirfd/O_NOFOLLOW APIs.
            # Exercise wrapper planning/call order here; root must run the same
            # suite on Linux to cover the real shared publication path.
            def fixture_publish(root, relative, writer, default_mode=0o644):
                output = io.BytesIO()
                writer(output)
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(output.getvalue())
            publisher = patch.object(runtime.shared, '_publish', side_effect=fixture_publish)
            publisher.start()
            self.addCleanup(publisher.stop)

    def invoke(self, action='run', environment=None):
        with patch.object(runtime.Path, 'cwd', return_value=self.root), patch.object(sys, 'argv', ['fixture', action]), patch.dict(os.environ, environment or self.env, clear=True):
            return runtime.main()

    def test_actual_wrapper_seeds_once_masks_operator_password_and_returns_exit(self):
        self.target.write_bytes(('[' + planner.SECTION + ']\r\nServerPassword="operator-secret"\r\nSeed=999\r\nUnknown=retained\r\n').encode())
        with patch.object(runtime.shared, 'run', return_value=23) as run, patch.object(runtime.shared, 'configure', side_effect=AssertionError('old overwrite path')):
            self.assertEqual(self.invoke(), 23)
            self.assertIn('operator-secret', run.call_args.kwargs['credentials'])
            self.assertIn('stale', run.call_args.kwargs['credentials'])
            self.assertIn('-Port=28000', run.call_args.args[1])
            self.assertIn('-QueryPort=28001', run.call_args.args[1])
            first = self.target.read_bytes()
            self.assertEqual(self.invoke(environment={**self.env, 'SERVER_MAPSEED': '111'}), 23)
            self.assertEqual(self.target.read_bytes(), first)

    def test_invalid_config_and_port_prevent_acquisition_or_console(self):
        for content, change in ((('[' + planner.SECTION + ']\nSeed=1\nseed=2\n').encode(), {}), (b';valid', {'SERVER_QUERY_PORT': '28000'})):
            self.target.write_bytes(content)
            with patch.object(runtime.shared, 'install') as install, patch.object(runtime.shared, 'run') as run, self.assertRaises(ValueError):
                self.invoke(environment={**self.env, 'AUTO_UPDATE': '1', **change})
            self.assertFalse(install.called)
            self.assertFalse(run.called)
            self.assertEqual(self.target.read_bytes(), content)

    def test_install_validates_existing_config_before_shared_acquisition(self):
        self.target.write_bytes(('[' + planner.SECTION + ']\nSeed=1\nseed=2\n').encode())
        with patch.object(runtime.shared, 'install') as install, self.assertRaises(ValueError):
            self.invoke('install', {'SRCDS_APPID': '2934900'})
        self.assertFalse(install.called)

    def test_update_replans_after_publisher_and_does_not_publish_stale_bytes(self):
        self.target.write_bytes(('[' + planner.SECTION + ']\nServerPassword=before\n').encode())
        def install(*args):
            self.target.write_bytes(('[' + planner.SECTION + ']\nServerPassword=after\nSeed=777\n').encode())
        with patch.object(runtime.shared, 'install', side_effect=install) as update, patch.object(runtime.shared, 'run', return_value=0) as run:
            self.assertEqual(self.invoke(environment={**self.env, 'AUTO_UPDATE': '1'}), 0)
        self.assertEqual(update.call_count, 1)
        self.assertIn('after', run.call_args.kwargs['credentials'])
        self.assertIn(b'Seed=777', self.target.read_bytes())

    def test_publish_rejects_concurrent_edit(self):
        planned = runtime.plan(self.root, self.env)
        self.target.write_bytes(b';external edit')
        with self.assertRaises(ValueError):
            runtime.publish(planned)
        self.assertEqual(self.target.read_bytes(), b';external edit')

    def test_update_can_restore_missing_binary_and_requires_it_after_acquisition(self):
        binary = self.root / runtime.shared.metadata()['astro']['binary']
        binary.unlink()
        with patch.object(runtime.shared, 'install', side_effect=lambda *args: binary.write_bytes(b'restored')) as update, patch.object(runtime.shared, 'run', return_value=0):
            self.assertEqual(self.invoke(environment={**self.env, 'AUTO_UPDATE': '1'}), 0)
        self.assertEqual(update.call_count, 1)
        binary.unlink()
        with patch.object(runtime.shared, 'install'), patch.object(runtime.shared, 'run') as run, self.assertRaises(ValueError):
            self.invoke(environment={**self.env, 'AUTO_UPDATE': '1'})
        self.assertFalse(run.called)


if __name__ == '__main__':
    unittest.main()
