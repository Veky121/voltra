"""Offline installer phase/identity regressions; fake archive tool, no Steam."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

for name in ('source_install', 'source_next_install'):
    if name not in sys.modules:
        sys.modules[name] = types.ModuleType(name)
sys.modules['source_install'].update = lambda *a, **k: None
sys.modules['source_next_install'].download = lambda *a, **k: None
sys.modules['source_next_install'].apply_payload = lambda *a, **k: None
SOURCE = Path('internal/panel/game_library/scripts/source-openfortress-install.py').resolve()
spec = importlib.util.spec_from_file_location('openfortress_stage', SOURCE)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

GAMEINFO = 'game "|all_source_engine_paths|..\\Team Fortress 2\\tf"\n' * 8
TOOL = '''#!EXECUTABLE
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
with (root/'events').open('a') as stream:stream.write(sys.argv[1]+'\\n')
payload=json.loads(Path(sys.argv[-1] if sys.argv[1] in ('l','x') else sys.argv[-2]).read_text())
if sys.argv[1]=='l':
 print('Archive listing\\n----------')
 for name,content in payload.items():
  print('Path = '+name+'\\nSize = '+str(len(content.encode()))+'\\nEncrypted = -\\nAttributes = A -rw-r--r--\\n')
elif sys.argv[1]=='e':
 sys.stdout.write(payload[sys.argv[-1]])
elif sys.argv[1]=='x':
 destination=Path(next(a[2:] for a in sys.argv if a.startswith('-o')))
 for name,content in payload.items():
  path=destination/name;path.parent.mkdir(parents=True,exist_ok=True)
  if content=='__SYMLINK__':path.symlink_to('/outside-fixture')
  else:path.write_text(content)
'''.replace('EXECUTABLE', sys.executable)


@unittest.skipUnless(sys.platform == 'linux', 'Linux archive-tool descriptor contract')
class OpenFortressStageTests(unittest.TestCase):
    def fixture(self, root, payload=None):
        payload = payload if payload is not None else {
            'open_fortress/gameinfo.txt': GAMEINFO,
            'open_fortress/bin/server.so': 'publisher server fixture',
        }
        body = json.dumps(payload).encode()
        executable = root / '.voltra/7zip/7z'
        executable.parent.mkdir(parents=True)
        executable.write_text(TOOL)
        executable.chmod(0o700)
        return body

    def exercise(self, root, body, fail_app=None, corrupt_after_updates=False, bad_identity=False):
        archive_path = None

        def download(release, archive, **kwargs):
            nonlocal archive_path
            archive_path = archive
            archive.write_bytes(body)
            return {'sha256': release['sha256']}

        def update(destination, app, **kwargs):
            self.assertFalse(any((root / '.voltra/source-next').rglob('ready')),
                             'expanded alpha must not coexist with Steam update')
            with (root / 'events').open('a') as stream:
                stream.write(str(app) + '\n')
            if app == fail_app:
                raise RuntimeError('fixture Steam failure')
            if corrupt_after_updates and app == 232250:
                archive_path.write_bytes(body + b'tampered')

        def apply(destination, name, ready, old):
            self.assertEqual((ready / 'bin/server.so').read_text(), 'publisher server fixture')
            content = (ready / 'gameinfo.txt').read_text()
            self.assertEqual(content.count('|gameinfo_path|../tf2/'), 8)
            with (root / 'events').open('a') as stream:
                stream.write('apply\n')
            return {}, []

        with patch.dict(installer.RELEASE, sha256='0'*64 if bad_identity else hashlib.sha256(body).hexdigest()), \
                patch.object(installer, 'download', side_effect=download), \
                patch.object(installer, 'update', side_effect=update), \
                patch.object(installer, 'apply_payload', side_effect=apply):
            installer.install(root, {})

    def test_phase_order_revalidates_after_steam_and_extracts_only_then(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.exercise(root, self.fixture(root))
            self.assertEqual((root / 'events').read_text().splitlines(),
                             ['l', 'e', '244310', '232250', 'l', 'x', 'apply'])
            self.assertTrue((root / '.voltra/source-next/openfortress.json').is_file())
            self.assertFalse(list((root / '.voltra/source-next').glob('of-*')))

    def test_each_failed_steam_update_prevents_extract_and_publication(self):
        for app in (244310, 232250):
            with self.subTest(app=app), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with self.assertRaisesRegex(RuntimeError, 'Steam failure'):
                    self.exercise(root, self.fixture(root), fail_app=app)
                events = (root / 'events').read_text().splitlines()
                self.assertNotIn('x', events)
                self.assertNotIn('apply', events)
                self.assertFalse((root / '.voltra/source-next/openfortress.json').exists())

    def test_unsafe_listing_and_changed_gameinfo_fail_before_steam(self):
        for payload, message in [({'../escape': 'bad'}, 'archive path'),
                                 ({'open_fortress/gameinfo.txt': 'different layout'}, 'mount layout'),
                                 ({'open_fortress/bin/server.so': 'fixture'}, 'gameinfo missing')]:
            with self.subTest(message=message), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with self.assertRaisesRegex(ValueError, message):
                    self.exercise(root, self.fixture(root, payload))
                events = (root / 'events').read_text().splitlines()
                self.assertNotIn('244310', events)
                self.assertNotIn('x', events)

    def test_archive_changed_during_steam_fails_revalidation_before_extract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                self.exercise(root, self.fixture(root), corrupt_after_updates=True)
            self.assertEqual((root / 'events').read_text().splitlines(),
                             ['l', 'e', '244310', '232250'])

    def test_bad_download_identity_prevents_any_steam_or_archive_tool(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                self.exercise(root, self.fixture(root), bad_identity=True)
            self.assertFalse((root / 'events').exists())

    def test_post_extraction_scan_and_required_server_still_gate_publication(self):
        for payload, message in [
                ({'open_fortress/gameinfo.txt': GAMEINFO}, 'server payload missing'),
                ({'open_fortress/gameinfo.txt': GAMEINFO,
                  'open_fortress/bin/server.so': '__SYMLINK__'}, 'Unexpected extracted')]:
            with self.subTest(message=message), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with self.assertRaisesRegex(ValueError, message):
                    self.exercise(root, self.fixture(root, payload))
                events = (root / 'events').read_text().splitlines()
                self.assertIn('x', events)
                self.assertNotIn('apply', events)
                self.assertFalse((root / '.voltra/source-next/openfortress.json').exists())

    def test_bad_hash_symlink_archive_and_escaping_parent_never_inspected(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            self.fixture(root)
            stage = root / '.voltra/source-next'
            stage.mkdir()
            archive = stage / 'payload.7z'
            archive.write_bytes(b'bad identity')
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                installer.validate_archive(archive)
            target = Path(outside) / 'payload.7z'
            target.write_bytes(b'bad identity')
            archive.unlink()
            archive.symlink_to(target)
            with self.assertRaisesRegex(ValueError, 'Unsafe .* identity'):
                installer.validate_archive(archive)
            (stage / 'escaped').symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'Unsafe .* identity'):
                installer.validate_archive(stage / 'escaped/payload.7z')
            self.assertFalse((root / 'events').exists())

    def test_inspection_has_enforced_byte_and_time_bounds(self):
        with self.assertRaisesRegex(ValueError, 'exceeds limit'):
            installer.bounded_archive_output([sys.executable, '-c', 'print("x"*1024)'], 128, 2)
        with self.assertRaisesRegex(ValueError, 'timed out'):
            installer.bounded_archive_output([sys.executable, '-c', 'import time;time.sleep(5)'], 128, .1)


if __name__ == '__main__':
    unittest.main()
