import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'internal/panel/game_library/scripts'
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
load('steam_template', SCRIPTS / 'steam-template.py')
load('source_install', SCRIPTS / 'source-install.py')
candidate = load('quakelive_install', ROOT / 'artifacts/game-parity-20261029/quakelive-install.pending.py')

class PreserveQuakeLive(unittest.TestCase):
    def prepare(self, root):
        rows = {'baseq3/access.txt': b'// no fabricated ids\r\n',
                'baseq3/mappool.txt': b'campgrounds|ffa\r\n',
                'baseq3/mappool_ffa.txt': b'campgrounds|ffa\n',
                'baseq3/workshop.txt': b'// no automatic items\n',
                'baseq3/scripts/operator.factories': b'{"id":"operator","cvars":{"g_inactivity":"90"}}\r\n'}
        for name, data in rows.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o640)
        return {name: (data, (root/name).stat().st_mode, (root/name).stat().st_uid, (root/name).stat().st_gid) for name,data in rows.items()}
    def assert_records(self, root, rows):
        for name, (data, mode, uid, gid) in rows.items():
            path = root/name
            self.assertEqual((path.read_bytes(), path.stat().st_mode, path.stat().st_uid, path.stat().st_gid), (data, mode, uid, gid))
    def test_preserves_bytes_modes_and_owners_after_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); rows=self.prepare(root)
            def validation(root, appid, **kwargs):
                self.assertEqual(appid,349090)
                for name in rows:
                    (root/name).write_bytes(b'publisher replacement')
                    (root/name).chmod(0o600)
                return {'buildid':'1168250'}
            self.assertEqual(candidate.install(root,validation)['buildid'],'1168250')
            self.assert_records(root, rows)
    def test_failure_restores_removed_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); rows=self.prepare(root)
            def failure(root, appid, **kwargs):
                for name in rows: (root/name).unlink()
                raise RuntimeError('actual failed validation stand-in')
            with self.assertRaisesRegex(RuntimeError,'failed validation'):
                candidate.install(root,failure)
            self.assert_records(root,rows)
    def test_invalid_kind_refuses_before_backup_or_acquisition(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'baseq3/access.txt').mkdir(parents=True);acquire=Mock()
            before=sorted(str(p.relative_to(root)) for p in root.rglob('*'))
            with self.assertRaises(ValueError):candidate.install(root,acquire)
            acquire.assert_not_called();self.assertEqual(before,sorted(str(p.relative_to(root)) for p in root.rglob('*')))
    @unittest.skipUnless(os.name=='posix','POSIX symlink contract')
    def test_symlink_refuses_without_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'outside').write_bytes(b'operator');(root/'baseq3').mkdir();(root/'baseq3/access.txt').symlink_to('../outside');acquire=Mock()
            with self.assertRaises(ValueError):candidate.install(root,acquire)
            acquire.assert_not_called();self.assertEqual((root/'outside').read_bytes(),b'operator');self.assertFalse((root/'.voltra').exists())
    def test_empty_fresh_install_delegates_shared_component(self):
        with tempfile.TemporaryDirectory() as tmp:
            acquire=Mock(return_value={'buildid':'fresh'})
            self.assertEqual(candidate.install(Path(tmp),acquire),{'buildid':'fresh'})
            acquire.assert_called_once_with(Path(tmp).resolve(),349090,env=None,required=('qzeroded.x64',))

if __name__=='__main__':unittest.main()
