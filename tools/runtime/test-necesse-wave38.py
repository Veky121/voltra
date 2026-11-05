"""Source-only Necesse regressions. No native process or acquisition is allowed."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'internal/panel/game_library/scripts'
PROFILE = json.loads((ROOT / 'internal/panel/game_library/overrides.json').read_text(encoding='utf-8'))['necesse/egg-necesse.json']
EMITTED = dict(re.findall(r"cat > \.voltra/([^ ]+) <<'VOLTRA_JAVA_SOURCE'\n(.*?)\nVOLTRA_JAVA_SOURCE\n", PROFILE['egg']['scripts']['installation']['script'], re.S))


def runtime(source):
    config = types.ModuleType('native_config')
    config.private_write = lambda *a: (_ for _ in ()).throw(AssertionError('unexpected config write'))
    console = types.ModuleType('native_console')
    console.run = lambda *a, **k: (_ for _ in ()).throw(AssertionError('native execution prohibited'))
    with patch.dict(sys.modules, native_config=config, native_console=console):
        module = types.ModuleType('necesse_fixture')
        exec(compile(source, 'necesse-runtime-fixture', 'exec'), module.__dict__)
    return module


class NecesseSourceTests(unittest.TestCase):
    def test_install_success_and_failure_restore_operator_bytes(self):
        source = (SCRIPTS / 'java-games-install.py').read_text(encoding='utf-8')
        for fails in (False, True):
            with self.subTest(failure=fails), tempfile.TemporaryDirectory(prefix='necesse-wave38-') as directory:
                root = Path(directory)
                target = root / 'cfg/server.cfg'
                target.parent.mkdir()
                original = b'// operator\r\nunknown=opaque\x00\xff\r\n'
                target.write_bytes(original)
                calls = []
                def update(volume, app, env, **kwargs):
                    calls.append((app, kwargs))
                    target.write_bytes(b'publisher fixture')
                    if fails:
                        raise RuntimeError('mock update failure')
                steam = types.ModuleType('steam_template')
                steam.update = update
                config = types.ModuleType('native_config')
                config.private_write = lambda *a: self.fail('unexpected receipt write')
                module = types.ModuleType('necesse_install_fixture')
                with patch.dict(sys.modules, steam_template=steam, native_config=config):
                    exec(compile(source, 'necesse-install-fixture', 'exec'), module.__dict__)
                # Windows has no POSIX ownership API. Only byte restoration is asserted.
                with patch.object(os, 'fchmod', lambda *a: None, create=True), patch.object(os, 'fchown', lambda *a: None, create=True):
                    if fails:
                        with self.assertRaisesRegex(RuntimeError, 'mock update failure'):
                            module.install(root, 'necesse', {})
                    else:
                        module.install(root, 'necesse', {})
                self.assertEqual(target.read_bytes(), original)
                self.assertEqual(calls, [(1169370, {'validate': True, 'required': ('Server.jar', 'jre/bin/java')})])

    def test_emitted_module_names_and_current_sources(self):
        for source, target in [('java-games-runtime.py', 'java_games_runtime.py'), ('java-games-install.py', 'java_games_install.py'), ('native-config.py', 'native_config.py'), ('native-console.py', 'native_console.py'), ('steam-template.py', 'steam_template.py'), ('bundle-debian-python.py', 'bundle_debian_python.py')]:
            self.assertIn(target, EMITTED)
            self.assertEqual(EMITTED[target].strip(), (SCRIPTS / source).read_text(encoding='utf-8').strip())

    def test_literal_launch_and_file_authority_source_and_emitted(self):
        for source in [(SCRIPTS / 'java-games-runtime.py').read_text(encoding='utf-8'), EMITTED['java_games_runtime.py']]:
            with tempfile.TemporaryDirectory(prefix='necesse-wave38-') as directory:
                root = Path(directory)
                for name, content in [('jre/bin/java', b'fixture'), ('Server.jar', b'fixture'), ('cfg/server.cfg', b'unknown=opaque\x00\r\n')]:
                    path = root / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
                env = {'SERVER_PORT': '28017', 'VOLTRA_ALLOCATED_PORTS': '28017', 'SAVE_NAME': 'World $literal', 'SERVER_PASSWORD': 'private fixture', 'SERVER_SLOTS': '6', 'PAUSE_EMPTY': '1'}
                argv, child, stop, ready, secrets = runtime(source).launch(root, 'necesse', env)
                self.assertEqual(argv[argv.index('-world') + 1], env['SAVE_NAME'])
                self.assertEqual(argv[argv.index('-password') + 1], env['SERVER_PASSWORD'])
                self.assertIn(env['SERVER_PASSWORD'], secrets)
                self.assertEqual(stop, 'stop')
                self.assertEqual(ready, b'Type help for list of commands.')
                self.assertEqual((root / 'cfg/server.cfg').read_bytes(), b'unknown=opaque\x00\r\n')
                for key, value in [('SAVE_NAME', '../escape'), ('SERVER_SLOTS', '251'), ('PAUSE_EMPTY', 'true'), ('SERVER_PASSWORD', 'bad\nvalue'), ('VOLTRA_ALLOCATED_PORTS', '')]:
                    with self.subTest(key=key), self.assertRaises(ValueError):
                        runtime(source).launch(root, 'necesse', {**env, key: value})

    def test_auto_update_order_reproduces_preflight_defect_without_acquisition(self):
        source = (SCRIPTS / 'java-games-runtime.py').read_text(encoding='utf-8')
        events = []
        installer = types.ModuleType('java_games_install')
        installer.install = lambda *a: events.append('acquisition boundary reached')
        console = types.ModuleType('native_console')
        console.run = lambda *a, **k: self.fail('native process boundary reached')
        config = types.ModuleType('native_config')
        config.private_write = lambda *a: self.fail('config mutation reached')
        with tempfile.TemporaryDirectory(prefix='necesse-wave38-') as directory:
            old = Path.cwd()
            try:
                os.chdir(directory)
                with patch.dict(sys.modules, java_games_install=installer, native_console=console, native_config=config), patch.dict(os.environ, {'AUTO_UPDATE': '1', 'SAVE_NAME': '../invalid', 'SERVER_PORT': '28017', 'VOLTRA_ALLOCATED_PORTS': '28017'}, clear=True), patch.object(sys, 'argv', ['fixture', 'necesse']):
                    with self.assertRaises(ValueError):
                        exec(compile(source, 'necesse-runtime-fixture', 'exec'), {'__name__': '__main__'})
                self.assertEqual(events, ['acquisition boundary reached'])
                self.assertEqual(list(Path(directory).iterdir()), [])
            finally:
                os.chdir(old)


if __name__ == '__main__':
    unittest.main(verbosity=2)
