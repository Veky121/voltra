from pathlib import Path
import os
ROOT=Path(__file__).resolve().parents[2]
scripts=ROOT/'internal/panel/game_library/scripts'
NATIVE_SOURCE=(scripts/'native-release.py').read_text()
ZIP_SOURCE=(scripts/'native-zip-release.py').read_text()
RUNTIME_SOURCE=(ROOT/'artifacts/game-parity-20261029/openarena-runtime.pending.py').read_text()
existing=(ROOT/'tools/runtime/test-openarena.py').read_text().replace('unittest.main()','')
exec(compile(existing,str(ROOT/'tools/runtime/test-openarena.py'),'exec'),globals())

class OpenArenaParityCandidate(unittest.TestCase):
    def prepare(self, root):
        maps=root/'openarena/baseoa/maps';maps.mkdir(parents=True);(maps/'aggressor.bsp').write_bytes(b'fixture-map')

    def snapshot(self, root):
        return [(str(p.relative_to(root)),str(p.readlink()) if p.is_symlink() else p.read_bytes() if p.is_file() else None,p.lstat().st_mode) for p in sorted(root.rglob('*'))]

    def test_seed_only_native_tuning_preserves_operator_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.prepare(root);env={'SERVER_PORT':'29102','VOLTRA_ALLOCATED_PORTS':'29102'}
            argv=runtime['configure'](env,root);target=root/'openarena/userdata/baseoa/server.cfg'
            self.assertEqual(target.read_text(),runtime['NATIVE_DEFAULTS']);self.assertEqual(target.stat().st_mode&0o777,0o600)
            original=b'// operator\r\nset timelimit "12.5" // keep\r\nexec custom.cfg\r\nset unknown "value"\r\n'
            target.write_bytes(original);before=target.stat().st_mtime_ns
            self.assertEqual(runtime['configure'](env,root),argv);self.assertEqual(target.read_bytes(),original);self.assertEqual(target.stat().st_mtime_ns,before)
            self.assertLess(argv.index('server.cfg'),argv.index('voltra-managed.cfg'))

    def test_predictable_invalid_configuration_refuses_before_writes(self):
        for extra in [{'RCON_PASSWORD':'bad"quote'},{'VOLTRA_ALLOCATED_PORTS':'29103'},{'SERVER_NAME':'bad;name'},{'MIN_PLAYERS':'65'}]:
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.prepare(root);before=self.snapshot(root)
                with self.assertRaises(ValueError):runtime['configure']({'SERVER_PORT':'29102',**extra},root)
                self.assertEqual(self.snapshot(root),before)

    def test_invalid_path_kinds_refuse_before_credential_publication(self):
        for name in ['openarena/userdata/baseoa/server.cfg','openarena/userdata/baseoa/voltra-managed.cfg','.voltra/openarena/rcon-password']:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as directory:
                root=Path(directory);self.prepare(root);(root/name).mkdir(parents=True);before=self.snapshot(root)
                with self.assertRaises(ValueError):runtime['configure']({'SERVER_PORT':'29102'},root)
                self.assertEqual(self.snapshot(root),before)

    @unittest.skipUnless(os.name=='posix','POSIX symlink safety')
    def test_symlinked_configuration_parent_refuses_without_mutating_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'owned';root.mkdir();self.prepare(root);outside=Path(directory)/'outside';outside.mkdir();(root/'openarena/userdata').symlink_to(outside,target_is_directory=True);before=self.snapshot(root)
            with self.assertRaises(ValueError):runtime['configure']({'SERVER_PORT':'29102'},root)
            self.assertEqual(self.snapshot(root),before);self.assertEqual(list(outside.iterdir()),[])

unittest.main()
