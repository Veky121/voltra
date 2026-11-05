import json
import re
import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('aska_authority', Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/aska-file-authority.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
PROPERTIES = {'display name': 'DISPLAY_NAME', 'server name': 'SERVER_NAME', 'password': 'SERVER_PASSWORD', 'region': 'SERVER_REGION', 'keep server world alive': 'KEEP_SERVER_WORLD_ALIVE', 'authentication token': 'STEAM_GSLT'}


def shared_adapter():
    base = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
    for name in ('steam-template', 'native-config', 'native-console', 'unreal-survival-next'):
        identity = name.replace('-', '_')
        spec = importlib.util.spec_from_file_location(identity, base / (name + '.py'))
        module = importlib.util.module_from_spec(spec)
        sys.modules[identity] = module
        spec.loader.exec_module(module)
    return module


class Authority(unittest.TestCase):
    def test_preflight_refuses_before_shared_main_or_writes(self):
        from types import SimpleNamespace
        info = {'properties': PROPERTIES, 'defaults': dict.fromkeys(PROPERTIES.values(), '')}
        info['defaults']['KEEP_SERVER_WORLD_ALIVE'] = 'false'
        for document, environment in [
            (b'authentication token = \n', {'STEAM_GSLT': 'stale'}),
            (b'keep server world alive = 1\n', {'STEAM_GSLT': 'fixture'}),
            (b';retain\n', {'STEAM_GSLT': '   '}),
            (b';retain\n', {'STEAM_GSLT': 'fixture', 'SERVER_NAME': 'bad\nkey=value'}),
        ]:
            self.target.write_bytes(document)
            fake = SimpleNamespace(metadata=lambda: {'aska': info}, main=unittest.mock.Mock())
            with patch.dict(sys.modules, {'unreal_survival_next': fake}), patch.dict(adapter.os.environ, environment, clear=True), patch.object(adapter.Path, 'cwd', return_value=self.root):
                with self.assertRaises(ValueError):
                    adapter.main()
            fake.main.assert_not_called()
            self.assertEqual(self.target.read_bytes(), document)

    def test_emitted_installer_imports_and_preflight(self):
        # Extract only text payloads. Never execute installer/acquisition.
        fragment = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('artifacts/game-parity-20261029/aska-resume-profile.json')
        profile = json.loads(fragment.read_text())['Aska/egg-aska.json']
        script = profile['egg']['scripts']['installation']['script']
        payloads = re.findall(r"cat > \.voltra/([^ ]+\.(?:py|json)) <<'([^']+)'\r?\n(.*?)\r?\n\2(?:\r?\n|$)", script, re.S)
        self.assertIn('.voltra/aska_file_authority.py run aska', profile['egg']['startup'])
        emitted = self.root / '.voltra'
        emitted.mkdir()
        for name, _, content in payloads:
            (emitted / name).write_text(content, encoding='utf-8')
        self.assertTrue((emitted / 'unreal_survival_next.py').is_file())
        self.assertEqual((emitted / 'aska_file_authority.py').read_text(), Path('internal/panel/game_library/scripts/aska-file-authority.py').read_text())
        names = ('steam_template', 'native_config', 'native_console', 'unreal_survival_next', 'aska_file_authority')
        # Force real imports from emitted filenames, without acquisition or games.
        with patch.dict(sys.modules), patch.object(sys, 'path', [str(emitted)] + sys.path):
            for name in names:
                sys.modules.pop(name, None)
            import importlib
            wrapper = importlib.import_module('aska_file_authority')
            shared = importlib.import_module('unreal_survival_next')
            self.target.write_text('authentication token = fixture-token\nkeep server world alive = true\nserver name = native\n')
            with patch.object(wrapper.Path, 'cwd', return_value=self.root), patch.dict(wrapper.os.environ, {'SERVER_NAME': 'stale'}, clear=True), patch.object(shared, 'main', return_value=0) as acquisition:
                self.assertEqual(wrapper.main(), 0)
                acquisition.assert_called_once()
                self.assertEqual(wrapper.os.environ['SERVER_NAME'], 'stale')
            # Mocked main is an acquisition boundary, not native install proof.
            self.target.write_text('authentication token =   \n')
            with patch.object(wrapper.Path, 'cwd', return_value=self.root), patch.object(shared, 'main') as acquisition:
                with self.assertRaises(ValueError):
                    wrapper.main()
                acquisition.assert_not_called()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.target = self.root / 'server properties.txt'

    def test_existing_values_win_including_empty_password(self):
        contents = b'; operator\r\ndisplay name = Custom\r\nserver name = World\r\npassword = \r\nregion = eu\r\nkeep server world alive = true\r\nauthentication token = native-fixture-token\r\nsave id = retain\r\n'
        self.target.write_bytes(contents)
        result = adapter.native_environment(self.root, {'SERVER_PASSWORD': 'old', 'STEAM_GSLT': 'old', 'OTHER': 'retain'}, PROPERTIES)
        self.assertEqual(result['DISPLAY_NAME'], 'Custom')
        self.assertEqual(result['SERVER_PASSWORD'], '')
        self.assertEqual(result['STEAM_GSLT'], 'native-fixture-token')
        self.assertEqual(result['KEEP_SERVER_WORLD_ALIVE'], 'true')
        self.assertEqual(result['OTHER'], 'retain')
        self.assertEqual(self.target.read_bytes(), contents)

    def test_missing_file_and_fields_use_environment(self):
        environment = {'STEAM_GSLT': 'fixture', 'SERVER_REGION': 'default'}
        self.assertEqual(adapter.native_environment(self.root, environment, PROPERTIES), environment)
        self.assertFalse(self.target.exists())
        self.target.write_text('server name = operator\nunknown = keep\n')
        result = adapter.native_environment(self.root, environment, PROPERTIES)
        self.assertEqual(result['SERVER_NAME'], 'operator')
        self.assertEqual(result['STEAM_GSLT'], 'fixture')

    def test_duplicate_and_case_alias_refuse_without_writes(self):
        for contents in (b'password = one\npassword = two\n', b'Password = ambiguous\n'):
            self.target.write_bytes(contents)
            with self.assertRaises(ValueError):
                adapter.native_environment(self.root, {}, PROPERTIES)
            self.assertEqual(self.target.read_bytes(), contents)

    def test_invalid_native_control_refuses(self):
        self.target.write_bytes(b'password = bad\x00value\n')
        with self.assertRaises(ValueError):
            adapter.native_environment(self.root, {}, PROPERTIES)

    def test_directory_rejected(self):
        self.target.mkdir()
        with self.assertRaises(ValueError):
            adapter.native_environment(self.root, {}, PROPERTIES)

    def test_unknown_duplicate_keys_preserved(self):
        contents = b'save id = first\nsave id = second\npassword = literal = value\n'
        self.target.write_bytes(contents)
        result = adapter.native_environment(self.root, {}, PROPERTIES)
        self.assertEqual(result['SERVER_PASSWORD'], 'literal = value')
        self.assertEqual(self.target.read_bytes(), contents)

    def test_actual_shared_configure_repeated_boots_preserve_native_values(self):
        shared = shared_adapter()
        (self.root / 'AskaServer.exe').write_bytes(b'fixture')
        self.target.write_text(';keep\nserver name = Native World\npassword = native password\nauthentication token = native-fixture-token\nkeep server world alive = true\nsave id = native-save\n')
        environment = {'SERVER_PORT': '28000', 'VOLTRA_ALLOCATED_PORTS': '28000', 'SERVER_NAME': 'stale', 'STEAM_GSLT': 'stale', 'SERVER_PASSWORD': 'stale'}
        for _ in range(2):
            effective = adapter.native_environment(self.root, environment, shared.metadata()['aska']['properties'])
            # Windows cannot execute the Linux dirfd/O_NOFOLLOW publisher.
            # Exercise actual configuration and redaction with only that I/O
            # boundary replaced; this is not publication security acceptance.
            with patch.object(shared, 'publish', lambda root, name, content: (root / name).write_text(content)):
                argv, child, secrets, _, _ = shared.configure(self.root, 'aska', effective)
            self.assertNotIn('native-fixture-token', ' '.join(argv))
            self.assertIn('native-fixture-token', secrets)
            self.assertIn('native password', secrets)
            content = self.target.read_text()
            self.assertIn('server name = Native World', content)
            self.assertIn('password = native password', content)
            self.assertIn('keep server world alive = true', content)
            self.assertIn('save id = native-save', content)
            self.assertIn(';keep', content)


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]])

