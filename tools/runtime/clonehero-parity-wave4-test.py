"""Read-only source/native-archive evidence and mocked-file configure fixtures."""
import hashlib
import importlib.util
from pathlib import Path
import re
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, BASE / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

load('steam_template', 'steam-template.py')
load('native_config', 'native-config.py')
load('native_console', 'native-console.py')
runtime = load('small_games_family_runtime', 'small-games-family-runtime.py')

class CloneNativeSettings(unittest.TestCase):
    def test_configure_preserves_general_native_ini_and_identity_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'clone').mkdir()
            (root / 'clone/Server').write_bytes(b'fixture executable, never run')
            files = {'settings.ini': b';operator\r\n[settings]\r\nredis_enable=false\r\nredis_hostname=operator-cache\r\nredis_password=fixture-private\r\nredis_db_id=3\r\nUnknownFuture=retain\r\n', 'banlist.txt': b'operator-owned identity rows\n'}
            for name, data in files.items(): (root / 'clone' / name).write_bytes(data)
            for name in ('First name', 'Later setup value'):
                cwd, argv, environment, stop, credentials, ready = runtime.configure(root, 'clone', {'SERVER_PORT':'29120', 'VOLTRA_ALLOCATED_PORTS':'29120', 'SERVER_DISPLAY_NAME':name, 'SERVER_PASSWORD':'fixture-join'})
                self.assertEqual(cwd, root / 'clone')
                self.assertEqual(argv[argv.index('-n') + 1], name)
                self.assertIn('fixture-join', credentials)
                self.assertEqual(stop, '\x03')
                self.assertEqual(ready, 'Server running...')
                self.assertEqual(environment['HOME'], str(root))
                for file, data in files.items(): self.assertEqual((root / 'clone' / file).read_bytes(), data)

    def test_invalid_setup_refuses_without_native_file_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'clone').mkdir()
            (root / 'clone/Server').write_bytes(b'fixture, not run')
            target = root / 'clone/settings.ini'; target.write_bytes(b'[settings]\nUnknown=retain\n')
            original = target.read_bytes()
            for invalid in ({'SERVER_DISPLAY_NAME':'bad\nname'}, {'SERVER_PORT':'29121'}, {'LOG_LEVEL':'9'}):
                with self.assertRaises(ValueError): runtime.configure(root, 'clone', {'SERVER_PORT':'29120','VOLTRA_ALLOCATED_PORTS':'29120',**invalid})
                self.assertEqual(target.read_bytes(), original)

    def test_pinned_public_binary_contains_native_ini_and_redis_setting_names(self):
        archive = ROOT / '.local/small-games-family/clone.archive'
        if not archive.exists(): self.skipTest('Retained pinned public archive not available')
        with archive.open('rb') as stream:
            self.assertEqual(hashlib.file_digest(stream, 'sha256').hexdigest(), 'b64804a4834b0b66f5f1a77a526273ff699db9fbd1a092ef519615e28cf7d5ae')
        with zipfile.ZipFile(archive) as source: payload = source.read('build/linux-x64/Server')
        strings = {value.decode('utf-16le') for value in re.findall(rb'(?:[ -~]\x00){4,100}', payload)}
        self.assertTrue({'settings.ini','redis_hostname','redis_password','redis_db_id','redis_enable'}.issubset(strings))
        # Names establish provenance, not native value semantics or gameplay.

if __name__ == '__main__': unittest.main()
