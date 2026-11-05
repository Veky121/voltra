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
PROFILE = json.loads((ROOT / 'artifacts/game-parity-20261029/wave39-necesse-repair/profiles.json').read_text(encoding='utf-8'))['necesse/egg-necesse.json']
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
                with patch.dict(sys.modules, steam_template=steam, native_config=config, java_games_runtime=runtime(EMITTED['java_games_runtime.py'])):
                    exec(compile(source, 'necesse-install-fixture', 'exec'), module.__dict__)
                # Windows has no POSIX ownership API. Only byte restoration is asserted.
                with patch.dict(sys.modules, java_games_runtime=runtime(EMITTED['java_games_runtime.py'])), patch.object(os, 'fchmod', lambda *a: None, create=True), patch.object(os, 'fchown', lambda *a: None, create=True):
                    if fails:
                        with self.assertRaisesRegex(RuntimeError, 'mock update failure'):
                            module.install(root, 'necesse', {'SERVER_PORT':'28017','VOLTRA_ALLOCATED_PORTS':'28017'})
                    else:
                        module.install(root, 'necesse', {'SERVER_PORT':'28017','VOLTRA_ALLOCATED_PORTS':'28017'})
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

    def test_exact_emitted_layout_imports_and_existing_install_signature(self):
        import importlib
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, source in EMITTED.items():
                (root / name).write_text(source, encoding='utf-8')
            config = types.ModuleType('native_config')
            config.private_write = lambda *a: self.fail('write boundary')
            console = types.ModuleType('native_console')
            console.run = lambda *a, **k: self.fail('process boundary')
            steam = types.ModuleType('steam_template')
            calls = []
            steam.update = lambda *a, **k: calls.append((a, k))
            with patch.dict(sys.modules, native_config=config, native_console=console, steam_template=steam), patch.object(sys, 'path', [str(root), *sys.path]):
                # Import installer first, just as the emitted installation caller does.
                with patch.dict(sys.modules):
                    sys.modules.pop('java_games_install', None)
                    sys.modules.pop('java_games_runtime', None)
                    installer = importlib.import_module('java_games_install')
                    env = {'SERVER_PORT':'28017','VOLTRA_ALLOCATED_PORTS':'28017'}
                    installer.install(root, 'necesse', env, False)
                    self.assertEqual(calls[0][1], {'validate':False,'required':('Server.jar','jre/bin/java')})
                    launcher = importlib.import_module('java_games_runtime')
                    self.assertEqual(Path(launcher.__file__).name, 'java_games_runtime.py')
                    with self.assertRaisesRegex(ValueError, 'Install this game'):
                        launcher.launch(root, 'necesse', env)
            self.assertEqual(sorted(p.name for p in root.iterdir() if p.name != '__pycache__'), sorted(EMITTED))

    def test_profile_preserves_canonical_metadata(self):
        canonical = json.loads((ROOT / 'internal/panel/game_library/overrides.json').read_text(encoding='utf-8'))['necesse/egg-necesse.json']
        import copy
        staged = copy.deepcopy(PROFILE)
        staged['egg']['scripts']['installation']['script'] = canonical['egg']['scripts']['installation']['script']
        self.assertEqual(staged, canonical)

    def test_emitted_initial_install_and_runtime_invalid_matrix(self):
        for key, value in [('SAVE_NAME','../invalid'), ('SERVER_SLOTS','251'), ('PAUSE_EMPTY','true'), ('SERVER_PASSWORD','bad\nvalue'), ('SERVER_MEMORY','511'), ('SERVER_PORT','65536'), ('VOLTRA_ALLOCATED_PORTS',''), ('VOLTRA_ALLOCATED_PORTS','bad')]:
            for automatic in ('AUTO_UPDATE', 'VOLTRA_STEAM_AUTO_UPDATE'):
                with self.subTest(key=key, automatic=automatic), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    operator = root / 'operator.bin'
                    operator.write_bytes(b'untouched\x00')
                    env = {'SERVER_PORT':'28017','VOLTRA_ALLOCATED_PORTS':'28017',automatic:'1',key:value}
                    events = []
                    steam = types.ModuleType('steam_template')
                    steam.update = lambda *a, **k: events.append('acquisition')
                    config = types.ModuleType('native_config')
                    config.private_write = lambda *a: self.fail('operator write')
                    console = types.ModuleType('native_console')
                    console.run = lambda *a, **k: self.fail('process')
                    installer = types.ModuleType('java_games_install')
                    launcher = runtime(EMITTED['java_games_runtime.py'])
                    with patch.dict(sys.modules, steam_template=steam, native_config=config, native_console=console, java_games_install=installer, java_games_runtime=launcher):
                        exec(compile(EMITTED['java_games_install.py'], 'java_games_install.py', 'exec'), installer.__dict__)
                        with self.assertRaises(ValueError):installer.install(root, 'necesse', env)
                        with patch.dict(os.environ, env, clear=True), patch.object(sys, 'argv', ['.voltra/java_games_runtime.py','necesse']):
                            with self.assertRaises(ValueError):exec(compile(EMITTED['java_games_runtime.py'], 'java_games_runtime.py', 'exec'), {'__name__':'__main__'})
                    self.assertEqual(events, [])
                    self.assertEqual(operator.read_bytes(), b'untouched\x00')
                    self.assertEqual(list(root.iterdir()), [operator])

    def test_auto_update_refuses_before_acquisition(self):
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
                self.assertEqual(events, [])
                self.assertEqual(list(Path(directory).iterdir()), [])
            finally:
                os.chdir(old)


if __name__ == '__main__':
    unittest.main(verbosity=2)
