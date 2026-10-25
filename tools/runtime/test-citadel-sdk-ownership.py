"""Offline Citadel SDK ownership, migration and rollback regressions.

Synthetic SDK bytes, temporary files and mocked Steam update only. No publisher
downloads/processes, game resources, API traffic or network are used. The first
unfixed four-failure evidence remains in .local/citadel-sdk-ownership-current.log.
"""
import hashlib
import importlib.util
import os
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, BASE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


steam = load('steam_template', 'steam-template.py')
load('native_config', 'native-config.py')
load('native_console', 'native-console.py')
load('fantasy_worlds_runtime', 'fantasy-worlds-runtime.py')
installer = load('fantasy_worlds_install', 'fantasy-worlds-install.py')
TARGET = 'Citadel/Plugins/UWorks/Source/ThirdParty/Linux/steamclient.so'


def snapshot(path):
    metadata = path.stat()
    return (hashlib.sha256(path.read_bytes()).hexdigest(), metadata.st_size,
            stat.S_IMODE(metadata.st_mode), metadata.st_uid, metadata.st_gid)


class CitadelSDKOwnership(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='citadel-sdk-offline-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.write('.steam/sdk64/steamclient.so', b'fresh public SDK fixture', 0o644)

    def write(self, relative, content, mode=0o640):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        path.chmod(mode)
        return path

    def operator_sdk(self):
        target = self.write(TARGET, b'operator-modified SDK fixture', 0o640)
        if os.geteuid() == 0:
            os.chown(target, 988, 989)
        return target, snapshot(target)

    def owned_sdk(self):
        self.source.write_bytes(b'previous trusted SDK fixture')
        target = self.write(TARGET, self.source.read_bytes(), 0o640)
        if os.geteuid() == 0:
            os.chown(target, 988, 989)
        installer.install_sdk(self.root)
        self.source.write_bytes(b'fresh public SDK fixture')
        return target, snapshot(target)

    def test_untracked_operator_sdk_collision_fails_without_overwriting(self):
        target, before = self.operator_sdk()
        try:
            installer.install_sdk(self.root)
        except ValueError:
            pass  # An explicit prerequisite is an acceptable safe outcome.
        self.assertEqual(snapshot(target), before, 'untracked operator SDK was overwritten')

    def test_successful_reinstall_updates_owned_sdk_preserving_metadata(self):
        target, before = self.owned_sdk()
        with patch.object(steam, 'update', return_value={'fixture': True}):
            try:
                installer.install(self.root, 'citadel', {})
            except ValueError:
                pass
        self.assertEqual(target.read_bytes(), self.source.read_bytes())
        self.assertEqual(snapshot(target)[2:], before[2:])
        ledger = json.loads((self.root / installer.CITADEL_SDK_LEDGER).read_text())
        self.assertEqual(ledger['sha256'], snapshot(target)[0])

    def test_publisher_failure_restores_existing_sdk(self):
        target, before = self.owned_sdk()
        def publisher(*args, **kwargs):
            target.write_bytes(b'publisher overwrote target before failing')
            target.chmod(0o644)
            raise OSError('synthetic publisher failure')
        with patch.object(steam, 'update', side_effect=publisher):
            with self.assertRaises(OSError):
                installer.install(self.root, 'citadel', {})
        self.assertEqual(snapshot(target), before, 'failed Steam update did not restore SDK')

    def test_failure_after_sdk_replace_restores_existing_bytes_mode_uid_gid(self):
        target, before = self.owned_sdk()
        publish = installer.publish
        def fail_after_replace(*args, **kwargs):
            publish(*args, **kwargs)
            raise OSError('synthetic failure after SDK publication')
        with patch.object(steam, 'update', return_value={}), patch.object(installer, 'publish', side_effect=fail_after_replace):
            with self.assertRaises(OSError):
                installer.install(self.root, 'citadel', {})
        self.assertEqual(snapshot(target), before, 'failed install left newly published SDK instead of old operator bytes')

    def test_equal_existing_sdk_is_not_republished(self):
        target = self.write(TARGET, self.source.read_bytes(), 0o640)
        if os.geteuid() == 0:
            os.chown(target, 988, 989)
        before, inode = snapshot(target), target.stat().st_ino
        installer.install_sdk(self.root)
        self.assertEqual(snapshot(target), before)
        self.assertEqual(target.stat().st_ino, inode)

    def test_exact_documented_legacy_link_migrates_without_changing_target(self):
        legacy = self.write('linux64/steamclient.so', b'legacy SDK fixture', 0o640)
        before = snapshot(legacy)
        target = self.root / TARGET
        target.parent.mkdir(parents=True)
        target.symlink_to('../../../../../../linux64/steamclient.so')
        installer.install_sdk(self.root)
        self.assertFalse(target.is_symlink())
        self.assertEqual(target.read_bytes(), self.source.read_bytes())
        self.assertEqual(snapshot(legacy), before)

    def test_unexpected_link_is_rejected_without_target_changes(self):
        unrelated = self.write('operator/alternate.so', b'private operator SDK', 0o600)
        before = snapshot(unrelated)
        target = self.root / TARGET
        target.parent.mkdir(parents=True)
        target.symlink_to(unrelated)
        with self.assertRaises(ValueError):
            installer.install_sdk(self.root)
        self.assertTrue(target.is_symlink())
        self.assertEqual(snapshot(unrelated), before)

    def test_custom_existing_collision_fails_before_steam(self):
        target, before = self.operator_sdk()
        with patch.object(steam, 'update') as update:
            with self.assertRaises(ValueError):
                installer.install(self.root, 'citadel', {})
            update.assert_not_called()
        self.assertEqual(snapshot(target), before)

    def test_modified_owned_target_fails_before_steam(self):
        target, _ = self.owned_sdk()
        target.write_bytes(b'operator edited receipt-owned SDK')
        before = snapshot(target)
        with patch.object(steam, 'update') as update:
            with self.assertRaises(ValueError):
                installer.install(self.root, 'citadel', {})
            update.assert_not_called()
        self.assertEqual(snapshot(target), before)

    def test_fresh_publisher_packaged_sdk_is_not_an_operator_collision(self):
        def publisher(*args, **kwargs):
            self.write(TARGET, b'publisher packaged historical SDK')
            return {'fixture': True}
        with patch.object(steam, 'update', side_effect=publisher):
            installer.install(self.root, 'citadel', {})
        self.assertEqual((self.root / TARGET).read_bytes(), self.source.read_bytes())
        self.assertTrue((self.root / installer.CITADEL_SDK_LEDGER).is_file())

    def test_fresh_failed_publisher_restores_new_absence(self):
        def publisher(*args, **kwargs):
            self.write(TARGET, b'publisher partial historical SDK')
            raise OSError('synthetic partial Steam update')
        with patch.object(steam, 'update', side_effect=publisher):
            with self.assertRaises(OSError):
                installer.install(self.root, 'citadel', {})
        self.assertFalse((self.root / TARGET).exists())
        self.assertFalse((self.root / installer.CITADEL_SDK_LEDGER).exists())

    def test_ledger_failure_after_real_replace_restores_both_files_metadata(self):
        target, before = self.owned_sdk()
        ledger = self.root / installer.CITADEL_SDK_LEDGER
        ledger.chmod(0o640)
        if os.geteuid() == 0:
            os.chown(ledger, 988, 989)
        before_ledger = snapshot(ledger)
        publish = installer.publish
        def fail_after_receipt(*args, **kwargs):
            publish(*args, **kwargs)
            if args[1] == installer.CITADEL_SDK_LEDGER:
                raise OSError('synthetic post-rename ledger failure')
        with patch.object(steam, 'update', return_value={}), patch.object(installer, 'publish', side_effect=fail_after_receipt):
            with self.assertRaises(OSError):
                installer.install(self.root, 'citadel', {})
        self.assertEqual(snapshot(target), before)
        self.assertEqual(snapshot(ledger), before_ledger)

    def test_legacy_link_identity_restored_after_ledger_failure(self):
        source = self.write('linux64/steamclient.so', b'legacy SDK source')
        source_before = snapshot(source)
        target = self.root / TARGET
        target.parent.mkdir(parents=True)
        original = '../../../../../../linux64/steamclient.so'
        target.symlink_to(original)
        if os.geteuid() == 0:
            os.lchown(target, 988, 989)
        owner = (target.lstat().st_uid, target.lstat().st_gid)
        publish = installer.publish
        def fail_receipt(*args, **kwargs):
            if args[1] == installer.CITADEL_SDK_LEDGER:
                raise OSError('synthetic receipt refusal')
            publish(*args, **kwargs)
        with patch.object(installer, 'publish', side_effect=fail_receipt):
            with self.assertRaises(OSError):
                installer.install_sdk(self.root)
        self.assertEqual(os.readlink(target), original)
        self.assertEqual((target.lstat().st_uid, target.lstat().st_gid), owner)
        self.assertEqual(snapshot(source), source_before)
        self.assertFalse((self.root / installer.CITADEL_SDK_LEDGER).exists())

    def test_malformed_receipts_do_not_adopt_even_equal_target(self):
        target = self.write(TARGET, self.source.read_bytes())
        for value in (b'{}', b'[]', b'{"schema_version":1,"schema_version":1}', b'x' * 65537):
            self.write(installer.CITADEL_SDK_LEDGER, value)
            before = snapshot(target)
            with patch.object(steam, 'update') as update:
                with self.assertRaises(ValueError):
                    installer.install(self.root, 'citadel', {})
                update.assert_not_called()
            self.assertEqual(snapshot(target), before)

    def test_symlinked_receipt_parent_fails_without_touching_target(self):
        target, before = self.operator_sdk()
        private = self.root / 'operator-state'
        private.mkdir()
        (self.root / '.voltra').symlink_to(private, target_is_directory=True)
        with patch.object(steam, 'update') as update:
            with self.assertRaises(ValueError):
                installer.install(self.root, 'citadel', {})
            update.assert_not_called()
        self.assertEqual(snapshot(target), before)
        self.assertEqual(list(private.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
