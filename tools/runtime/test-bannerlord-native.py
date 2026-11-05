import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('bannerlord', Path('internal/panel/game_library/scripts/bannerlord-native.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class Bannerlord(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = {'AUTH_TOKEN': 'unit-fixture-only', 'SERVER_PORT': '7210'}
        for name in ('Native', 'Multiplayer'):
            p = self.root / 'Modules' / name / 'SubModule.xml'
            p.parent.mkdir(parents=True)
            p.write_text('<Module><Id value="'+name+'"/></Module>')
        self.config = self.root / 'Modules/Native/tdm_config.txt'
        self.config.write_bytes(b'// operator comment\r\nServerName untouched\r\nMap custom_scene\r\nunknown_custom_command value\r\n')
        (self.root / 'Modules/Multiplayer/SceneObj/custom_scene').mkdir(parents=True)
        binary = self.root / b.melee.GAMES['bannerlord'][2]
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b'fixture never executed')
    def tearDown(self):
        self.tmp.cleanup()
    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
    def test_read_only_unknown_config_and_scene(self):
        before = self.snapshot()
        b.preflight(self.root, self.env)
        self.assertEqual(before, self.snapshot())
    def test_invalid_prerequisites_prevent_update_and_writes(self):
        for patch in ({'AUTH_TOKEN': ''}, {'SERVER_MODULES': 'Native,Missing'}, {'SERVER_CONFIG': '../bad.txt'}, {'SRCDS_APPID': '261550'}, {'WINETRICKS_RUN': 'arbitrary'}):
            before = self.snapshot()
            with mock.patch.object(b.melee, 'install') as install:
                with self.assertRaises(ValueError):
                    b.run(self.root, {**self.env, 'VOLTRA_STEAM_AUTO_UPDATE': '1', **patch})
                install.assert_not_called()
            self.assertEqual(before, self.snapshot())
    def test_missing_scene_prevents_install(self):
        self.config.write_bytes(b'Map missing\n')
        before = self.snapshot()
        with mock.patch.object(b.melee, 'install') as install:
            with self.assertRaises(ValueError): b.install(self.root, self.env)
            install.assert_not_called()
        self.assertEqual(before, self.snapshot())
    def test_dependency_order_and_unsafe_xml(self):
        path = self.root / 'Modules/Native/SubModule.xml'
        for content in ('<Module><Id value="other"/></Module>', '<Module><Id value="Native"/><DependedModules><DependedModule Id="Multiplayer"/></DependedModules></Module>', '<!DOCTYPE Module><Module/>', '<broken>'):
            path.write_text(content)
            with self.assertRaises(ValueError): b.preflight(self.root, self.env)
    def test_binary_required_only_at_run(self):
        (self.root / b.melee.GAMES['bannerlord'][2]).unlink()
        b.preflight(self.root, self.env, require_binary=False)
        with self.assertRaises(ValueError): b.preflight(self.root, self.env)
    def test_update_runs_once_then_shared_runtime(self):
        with mock.patch.object(b.melee, 'install', return_value=None) as install, mock.patch.object(b.melee, 'run', return_value=17) as run:
            self.assertEqual(b.run(self.root, {**self.env, 'VOLTRA_STEAM_AUTO_UPDATE': '1'}), 17)
            install.assert_called_once()
            self.assertEqual(run.call_args.args[2]['VOLTRA_STEAM_AUTO_UPDATE'], '0')

    def test_token_only_in_native_argument_and_redaction_set(self):
        before = self.snapshot()
        _, argv, secrets = b.preflight(self.root, self.env)
        token = self.env['AUTH_TOKEN']
        self.assertEqual(argv[argv.index('/dedicatedcustomserverauthtoken') + 1], token)
        self.assertIn(token, secrets)
        self.assertEqual(argv.count(token), 1)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(any(token.encode() in data for data in self.snapshot().values()))

    def test_invalid_token_never_appears_in_failure(self):
        import os
        import subprocess
        import sys
        token = 'unit-secret-do-not-log\ninvalid'
        result = subprocess.run([sys.executable, str(Path(b.__file__).resolve()), 'run'],
                                cwd=self.root, env={**os.environ, **self.env, 'AUTH_TOKEN': token},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('unit-secret-do-not-log', result.stdout + result.stderr)
        self.assertIn('operator files retained', result.stderr)

unittest.main()
