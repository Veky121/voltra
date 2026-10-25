"""Synthetic repository filesystem fixtures only. No Cuberite process/network."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / file); module = importlib.util.module_from_spec(spec); sys.modules[name] = module; spec.loader.exec_module(module); return module
load('limbo_install', 'limbo-install.py'); load('native_release', 'native-release.py'); load('native_zip_release', 'native-zip-release.py')
special = load('minecraft_special_install', 'minecraft-special-install.py')
c = load('cuberite_install', 'cuberite-install.py')
ELF = b'\x7fELF\x02\x01' + b'\0' * 12 + (62).to_bytes(2, 'little') + b'offline-fixture-not-native-server'


def archive(binary=ELF):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w:gz') as out:
        for name, data in [('Cuberite', binary), ('Plugins/Core/main.lua', b'publisher plugin'), ('Protocol/recipe.txt', b'publisher protocol')]:
            member = tarfile.TarInfo(name); member.size = len(data); member.mode = 0o755 if name == 'Cuberite' else 0o644; out.addfile(member, io.BytesIO(data))
    return result.getvalue()


class CuberiteOwnership(unittest.TestCase):
    def setUp(self):
        self.archive = archive(); self.license = b'offline-license-fixture'
        self.pins = {'cuberite': {'version': 'fixture445', 'url': 'https://publisher.invalid/fixture', 'sha256': hashlib.sha256(self.archive).hexdigest(), 'bytes': len(self.archive)}, 'cuberite_license': {'sha256': hashlib.sha256(self.license).hexdigest()}}
        self.patch = patch.dict(c.PINS, self.pins); self.patch.start(); self.addCleanup(self.patch.stop)

    def fetch(self, root, release): return self.license if release is c.PINS['cuberite_license'] else self.archive

    def test_exact_archive_and_license_checksums_precede_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(ValueError): c.install(root, lambda *_: b'corrupt')
            self.assertFalse((root / 'Cuberite').exists()); self.assertFalse((root / 'Plugins').exists())
            with self.assertRaises(ValueError): c.install(root, lambda r, release: b'corrupt' if release is c.PINS['cuberite_license'] else self.archive)
            self.assertFalse((root / 'Cuberite').exists())

    def test_operator_plugins_configs_worlds_and_modified_program(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); c.install(root, self.fetch)
            (root / 'settings.ini').write_text('operator settings'); (root / 'webadmin.ini').write_text('private-fixture-never-printed'); (root / 'Plugins/Core/main.lua').write_text('operator plugin')
            (root / 'world').mkdir(); (root / 'world/level.dat').write_bytes(b'operator world'); (root / 'Ranks.sqlite').write_bytes(b'operator identities')
            c.install(root, self.fetch)
            self.assertEqual('operator settings',(root / 'settings.ini').read_text()); self.assertEqual('private-fixture-never-printed',(root / 'webadmin.ini').read_text()); self.assertEqual('operator plugin',(root / 'Plugins/Core/main.lua').read_text())
            self.assertEqual(b'operator world',(root / 'world/level.dat').read_bytes()); self.assertEqual(b'operator identities',(root / 'Ranks.sqlite').read_bytes())
            (root / 'Cuberite').write_bytes(b'operator-modified program'); (root / 'Protocol/recipe.txt').unlink()
            with self.assertRaisesRegex(ValueError,'Operator-modified'): c.install(root,self.fetch)
            self.assertEqual(b'operator-modified program',(root / 'Cuberite').read_bytes()); self.assertFalse((root / 'Protocol/recipe.txt').exists())

    def test_prior_installer_adopts_only_verified_pinned_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'Cuberite').write_bytes(ELF); c.install(root,self.fetch)
            receipt=json.loads((root/'.voltra/cuberite/release.json').read_text()); self.assertTrue(receipt['adopted_reviewed_binary']);self.assertFalse(receipt['native_runtime_verified'])
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'Cuberite').write_bytes(b'unknown')
            with self.assertRaisesRegex(ValueError,'Operator-modified'):c.install(root,self.fetch)

    def test_first_install_failure_removes_only_own_created_paths(self):
        with tempfile.TemporaryDirectory()as temporary:
            root=Path(temporary);(root/'operator').mkdir();(root/'operator/keep').write_text('keep')
            def fail(phase):
                if phase=='after:Plugins/Core/main.lua':raise RuntimeError('injected after seed publication')
            with self.assertRaises(RuntimeError):c.install(root,self.fetch,fail)
            self.assertFalse((root/'Cuberite').exists());self.assertFalse((root/'Plugins').exists());self.assertFalse((root/'Protocol').exists());self.assertFalse((root/'.voltra/cuberite/release.json').exists());self.assertEqual('keep',(root/'operator/keep').read_text())

    def test_archive_links_traversal_casecollisions_and_wrong_architecture(self):
        for entries in [('..'+'/escape',),('A','a')]:
            data=io.BytesIO()
            with tarfile.open(fileobj=data,mode='w')as out:
                for name in entries:
                    member=tarfile.TarInfo(name);member.size=1;out.addfile(member,io.BytesIO(b'x'))
            with tempfile.TemporaryDirectory()as temporary:
                with self.assertRaises(ValueError):c.unpack(data.getvalue(),Path(temporary))
        data=io.BytesIO()
        with tarfile.open(fileobj=data,mode='w')as out:
            member=tarfile.TarInfo('link');member.type=tarfile.SYMTYPE;member.linkname='outside';out.addfile(member)
        with tempfile.TemporaryDirectory()as temporary:
            with self.assertRaises(ValueError):c.unpack(data.getvalue(),Path(temporary))
        invalid=archive(b'not-elf');self.pins['cuberite']['sha256']=hashlib.sha256(invalid).hexdigest();self.pins['cuberite']['bytes']=len(invalid)
        with tempfile.TemporaryDirectory()as temporary:
            with self.assertRaisesRegex(ValueError,'Linux x64'):c.install(Path(temporary),lambda r,p:self.license if p is c.PINS['cuberite_license']else invalid)

    @unittest.skipUnless(os.name=='posix','Linux metadata/fork fixtures')
    def test_modes_ownership_symlinks_and_durable_interruption_recovery(self):
        for checkpoint in ('after:Cuberite','after:receipt'):
            with self.subTest(checkpoint=checkpoint),tempfile.TemporaryDirectory()as temporary:
                root=Path(temporary);c.install(root,self.fetch);(root/'Cuberite').chmod(0o754);(root/'settings.ini').chmod(0o640);(root/'webadmin.ini').chmod(0o640)
                if os.geteuid()==0:
                    os.chown(root/'Cuberite',1234,2345);os.chown(root/'Protocol',1234,2345)
                directory_before=(root/'Protocol').stat()
                before=(root/'Cuberite').stat();prior=(root/'.voltra/cuberite/release.json').read_bytes()
                c.install(root,self.fetch)
                after=(root/'Cuberite').stat();self.assertEqual((before.st_uid,before.st_gid,0o754),(after.st_uid,after.st_gid,stat.S_IMODE(after.st_mode)))
                self.assertEqual(0o640,stat.S_IMODE((root/'settings.ini').stat().st_mode));self.assertEqual(0o640,stat.S_IMODE((root/'webadmin.ini').stat().st_mode))
                directory_after=(root/'Protocol').stat();self.assertEqual((directory_before.st_uid,directory_before.st_gid,directory_before.st_mode),(directory_after.st_uid,directory_after.st_gid,directory_after.st_mode))
                prior=(root/'.voltra/cuberite/release.json').read_bytes();child=os.fork()
                if child==0:
                    def interrupt(phase):
                        if phase==checkpoint:os._exit(71)
                    c.install(root,self.fetch,interrupt);os._exit(72)
                _,status=os.waitpid(child,0);self.assertEqual(71,os.waitstatus_to_exitcode(status));state=root/'.voltra/cuberite';self.assertTrue((state/'transaction.json').exists());c.recover(root,state)
                self.assertEqual(prior,(state/'release.json').read_bytes());after=(root/'Cuberite').stat();self.assertEqual((before.st_uid,before.st_gid,0o754),(after.st_uid,after.st_gid,stat.S_IMODE(after.st_mode)))
                # Restore only this synthetic fixture's directory owner so the
                # cap-CHOWN-only test container can remove its temporary tree.
                if os.geteuid()==0:os.chown(root/'Protocol',0,0)
        with tempfile.TemporaryDirectory()as temporary,tempfile.TemporaryDirectory()as outside:
            root=Path(temporary);(root/'Plugins').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):c.install(root,self.fetch)
            self.assertFalse((root/'Cuberite').exists());self.assertEqual([],list(Path(outside).iterdir()))


if __name__=='__main__':unittest.main()
