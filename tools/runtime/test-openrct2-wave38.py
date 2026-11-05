"""Source fixtures only. No native processes, downloads or service access."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'internal/panel/game_library/scripts'

def load(filename):
    spec = importlib.util.spec_from_file_location(filename, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class OpenRCT2SourceTests(unittest.TestCase):
    def test_wrapper_console_contract_without_process(self):
        wrapper = load('openrct2-runtime.py')
        settings = Mock()
        settings.configure_openrct2.return_value = (['native', 'host', 'park'], Path('.'))
        console = Mock()
        console.run.return_value = 17
        with patch.object(wrapper, 'load', side_effect=[settings, console]), patch.dict(os.environ, {'PYTHONHOME':'private', 'PYTHONPATH':'private', 'OPENRCT2_NO_REPL':'1'}):
            self.assertEqual(wrapper.main(Path('.'), {'SERVER_PASSWORD':'fixture-secret'}), 17)
        args, kwargs = console.run.call_args
        self.assertEqual(args[1], ['native', 'host', 'park'])
        self.assertEqual(args[2]['TERM'], 'dumb')
        for key in ('PYTHONHOME', 'PYTHONPATH', 'OPENRCT2_NO_REPL'):
            self.assertNotIn(key, args[2])
        self.assertEqual(args[3], 'console.executeLegacy("save_park"); console.executeLegacy("quit");')
        self.assertEqual(kwargs['credentials'], ['fixture-secret'])
        self.assertTrue(kwargs['terminal_input'])
        self.assertEqual(kwargs['ready_marker'], b'Listening for clients on')

    def test_current_file_authority_defect_reproduced(self):
        runtime = load('small-native-runtime.py')
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ):
            root = Path(directory)
            save = root / 'ServerData/save/save.park'
            save.parent.mkdir(parents=True)
            save.write_bytes(b'fixture')
            config = root / 'ServerData/config.ini'
            original = b'; operator\n[network]\nserver_name = "operator"\nunknown = keep\n'
            config.write_bytes(original)
            with patch.object(runtime.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')):
                runtime.configure_openrct2(root, {})
            self.assertNotEqual(config.read_bytes(), original, 'Remove this defect characterization after root fixes file authority')
            self.assertIn(b'unknown = keep', config.read_bytes())
            self.assertIn(b'server_name = ""', config.read_bytes())

    def test_current_preflight_mutation_defect_reproduced(self):
        runtime = load('small-native-runtime.py')
        for env in ({'LOAD_AUTOSAVE':'invalid'}, {'SAVE_URI':'../escape.park'}, {'SAVE_URI':'absent.park'}):
            with self.subTest(env=env), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with patch.object(runtime.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')):
                    with self.assertRaises(ValueError):
                        runtime.configure_openrct2(root, env)
                self.assertTrue((root / 'ServerData/config.ini').exists(), 'Known defect: rejected startup already wrote config')

    def test_emitted_helper_names_and_wrapper_identity(self):
        profile = json.loads((SCRIPTS.parent / 'overrides.json').read_text(encoding='utf-8'))['openrct2/egg-openrct2.json']
        script = profile['egg']['scripts']['installation']['script']
        import re
        files = dict(re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_SOURCE'\n(.*?)\nVOLTRA_SOURCE", script, re.S))
        for name in ('small-native-runtime.py', 'native-config.py', 'native-console.py', 'openrct2-runtime.py', 'native-release.py', 'small-native-install.py'):
            self.assertIn(name, files)
        self.assertIn('steam_template.py', files)
        self.assertEqual(files['openrct2-runtime.py'].rstrip(), (SCRIPTS / 'openrct2-runtime.py').read_text().rstrip())
        self.assertIn('.voltra/openrct2-runtime.py', profile['egg']['startup'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
