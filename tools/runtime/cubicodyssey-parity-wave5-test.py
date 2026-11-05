"""Offline fixtures. No game, Wine, Steam, publisher or container process runs."""
import codecs
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


for name in ('steam-template', 'native-config', 'native-console', 'source-install', 'source-next-install', 'tactical-install', 'tactical-runtime', 'crafting-install', 'crafting-runtime'):
    shared = load(name.replace('-', '_'), BASE / (name + '.py'))
adapter = load('cubic_wave5', BASE / 'cubic-odyssey-native.py')
ENV = {'VOLTRA_CRAFTING': 'cubic', 'SRCDS_APPID': '3858450', 'WINDOWS_INSTALL': '1',
       'SERVER_PORT': '20000', 'GAME_PORT': '20000', 'VOLTRA_ALLOCATED_PORTS': '20000',
       'SERVER_NAME': 'Creation name', 'PRIVATE_SERVER': 'FALSE', 'GALAXY_SEED': '21945875634',
       'MAX_PLAYERS': '20', 'GAMEMODE': 'adventure', 'SERVER_PASSWORD': 'literal $ fixture',
       'AUTO_UPDATE': '1', 'DISPLAY': ':99'}
CONFIG = codecs.BOM_UTF8 + b'// operator\r\nGameParams\r\n{\r\n m_server ServerParams\r\n {\r\n serverName "Operator name" // keep inline\r\n privateServer TRUE\r\n galaxySeed 12345\r\n unknownNative 73\r\n }\r\n m_difficulty DifficultySettings\r\n {\r\n  damagePlayerScale 1\r\n }\r\n}\r\n'


class CubicParity(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.target = self.root / adapter.FILE
        self.target.parent.mkdir()
        self.target.write_bytes(CONFIG)
        self.binary = self.root / 'server/CubicOdysseyServer.exe'
        self.binary.parent.mkdir()
        self.binary.write_bytes(b'publisher fixture')

    def invoke(self, environment=None):
        with patch.object(adapter.Path, 'cwd', return_value=self.root), patch.object(sys, 'argv', ['fixture', 'run']), patch.dict(os.environ, environment or ENV, clear=True), patch.object(shared.shutil, 'which', return_value='/usr/bin/wine'):
            return adapter.main(shared)

    def snapshot(self):
        return {file.relative_to(self.root).as_posix(): file.read_bytes() for file in self.root.rglob('*') if file.is_file()}

    def test_baseline_updates_before_invalid_players_refusal(self):
        with patch.object(shared, 'install') as acquisition, self.assertRaises(ValueError):
            shared.main(self.root, {**ENV, 'MAX_PLAYERS': '0'})
        acquisition.assert_called_once()

    def test_invalid_setup_refuses_before_acquisition_publication_or_start(self):
        for changes in ({'SERVER_PORT': '20001'}, {'GAME_PORT': '20001'}, {'GAMEMODE': 'invalid'}, {'MAX_PLAYERS': '0'}, {'AUTO_UPDATE': 'bad'}, {'DISPLAY': ''}, {'VOLTRA_CRAFTING': 'romestead'}):
            with self.subTest(changes=changes):
                before = self.snapshot()
                with patch.object(shared, 'install') as acquisition, patch.object(shared, 'publish_config') as publish, patch.object(shared, 'run') as run, self.assertRaises(ValueError):
                    self.invoke({**ENV, **changes})
                acquisition.assert_not_called(); publish.assert_not_called(); run.assert_not_called()
                self.assertEqual(self.snapshot(), before)

    def test_native_values_survive_repeated_starts_with_stale_setup_values(self):
        for _ in range(2):
            with patch.object(shared, 'install') as acquisition, patch.object(shared, 'publish_config') as publish, patch.object(shared, 'run', return_value=19) as run:
                self.assertEqual(self.invoke({**ENV, 'AUTO_UPDATE': '0'}), 19)
            acquisition.assert_not_called(); publish.assert_not_called()
            self.assertEqual(self.target.read_bytes(), CONFIG)
            self.assertIn('-Password=literal $ fixture', run.call_args.args[1])
            self.assertIn('literal $ fixture', run.call_args.kwargs['credentials'])
            self.assertEqual(run.call_args.kwargs['stop_signal'], shared.signal.SIGINT)

    def test_ambiguous_or_invalid_native_rows_refuse_before_update(self):
        cases = [CONFIG + b'serverName "duplicate"\n', CONFIG.replace(b'serverName', b'ServerName'), CONFIG.replace(b'TRUE', b'true'), CONFIG.replace(b'12345', b'notseed'), CONFIG + b'\x00', b'\xff']
        for content in cases:
            with self.subTest(content=content):
                self.target.write_bytes(content)
                with patch.object(shared, 'install') as acquisition, self.assertRaises(ValueError): self.invoke()
                acquisition.assert_not_called(); self.assertEqual(self.target.read_bytes(), content)

    def test_fresh_file_seeds_creation_fields_once_preserving_exact_other_bytes(self):
        self.target.unlink()
        def acquire(*args, **kwargs): self.target.write_bytes(CONFIG)
        def publish(root, name, previous, updated):
            self.assertEqual(previous, CONFIG); (root / name).write_bytes(updated)
        with patch.object(shared, 'install', side_effect=acquire) as acquisition, patch.object(shared, 'publish_config', side_effect=publish):
            adapter.install(self.root, ENV, shared=shared)
        expected = CONFIG.replace(b'"Operator name"', b'"Creation name"').replace(b'TRUE', b'FALSE').replace(b'12345', b'21945875634')
        self.assertEqual(self.target.read_bytes(), expected)
        acquisition.assert_called_once_with(self.root, ENV, validate=True)

    def test_existing_native_file_is_not_reseeded_by_reinstall(self):
        with patch.object(shared, 'install') as acquisition, patch.object(shared, 'publish_config') as publish:
            adapter.install(self.root, ENV, shared=shared)
        acquisition.assert_called_once(); publish.assert_not_called(); self.assertEqual(self.target.read_bytes(), CONFIG)

    def test_actual_publisher_sample_only_install_seeds_active_file(self):
        self.target.unlink()
        sample = self.target.with_name('server_config.txt.sample')
        published = (ROOT/'tools/runtime/cubicodyssey-parity-wave5-publisher.sample').read_bytes()
        def acquire(*args, **kwargs): sample.write_bytes(published)
        with patch.object(shared, 'install', side_effect=acquire):
            adapter.install(self.root, ENV, shared=shared)
        expected = published.replace(b'"Cubic Odyssey Dedicated Server"', b'"Creation name"').replace(b'galaxySeed 0', b'galaxySeed 21945875634')
        self.assertEqual(self.target.read_bytes(), expected)
        self.assertEqual(sample.read_bytes(), published)
        self.assertIn(b'damageGearOnDeath true', self.target.read_bytes())
        self.assertEqual(self.target.stat().st_mode&0o777, 0o600)

    def test_legacy_flat_root_and_duplicate_server_namespace_refuse_before_update(self):
        flat = b'serverName "Legacy"\nprivateServer FALSE\ngalaxySeed 1\n'
        duplicate = CONFIG.replace(b' m_difficulty', b' m_server ServerParams\r\n {\r\n }\r\n m_difficulty')
        for content in (flat, duplicate, CONFIG.replace(b'm_server ServerParams', b'm_Server ServerParams')):
            self.target.write_bytes(content)
            with patch.object(shared, 'install') as acquire, self.assertRaises(ValueError): self.invoke()
            acquire.assert_not_called(); self.assertEqual(self.target.read_bytes(), content)

    def test_existing_invalid_publisher_sample_refuses_before_acquisition(self):
        self.target.unlink()
        sample=self.target.with_name('server_config.txt.sample')
        sample.write_bytes(b'serverName "unsupported flat"\nprivateServer FALSE\ngalaxySeed 0\n')
        before=self.snapshot()
        with patch.object(shared,'install') as acquire, self.assertRaises(ValueError):
            adapter.install(self.root,ENV,shared=shared)
        acquire.assert_not_called();self.assertEqual(self.snapshot(),before)

    def test_comment_prefixed_known_rows_and_namespace_duplicates_are_safe(self):
        commented=CONFIG.replace(b' serverName',b' /* retained prefix */ serverName',1)
        _,rows=adapter.parse_config(commented)
        self.assertEqual(rows['serverName'][0],'Operator name')
        for content in (CONFIG.replace(b' unknownNative 73',b' /* prefix */ serverName "duplicate"'),CONFIG.replace(b' m_difficulty',b' /* prefix */ m_server ServerParams\r\n {\r\n }\r\n m_difficulty')):
            self.target.write_bytes(content)
            with patch.object(shared,'install') as acquire,self.assertRaises(ValueError): self.invoke()
            acquire.assert_not_called();self.assertEqual(self.target.read_bytes(),content)

    @unittest.skipIf(os.name == 'nt', 'symlink fixture requires POSIX')
    def test_symlinked_config_parent_refuses_before_acquisition(self):
        self.target.unlink();self.target.parent.rmdir()
        destination=self.root/'operator-config';destination.mkdir()
        (destination/'server_config.txt').write_bytes(CONFIG)
        self.target.parent.symlink_to(destination,target_is_directory=True)
        before=self.snapshot()
        with patch.object(shared,'install') as acquire,self.assertRaises(ValueError):
            adapter.install(self.root,ENV,shared=shared)
        acquire.assert_not_called();self.assertEqual(self.snapshot(),before)

    def test_update_repairs_missing_payload_and_then_seeds_fresh_config(self):
        self.target.unlink(); self.binary.unlink()
        def acquire(*args, **kwargs):
            self.target.write_bytes(CONFIG); self.binary.write_bytes(b'restored fixture')
        with patch.object(shared, 'install', side_effect=acquire), patch.object(shared, 'publish_config', side_effect=lambda root, name, previous, updated: (root/name).write_bytes(updated)), patch.object(shared, 'run', return_value=0):
            self.assertEqual(self.invoke(), 0)
        self.assertIn(b'serverName "Creation name"', self.target.read_bytes())

    def test_missing_payload_without_update_never_publishes(self):
        self.binary.unlink()
        before = self.snapshot()
        with patch.object(shared, 'install') as acquisition, patch.object(shared, 'publish_config') as publish, self.assertRaises(ValueError): self.invoke({**ENV, 'AUTO_UPDATE': '0'})
        acquisition.assert_not_called(); publish.assert_not_called(); self.assertEqual(self.snapshot(), before)

    def test_private_steam_licence_path_remains_gated_before_mutation(self):
        before = self.snapshot()
        with patch.object(shared, 'run') as run, self.assertRaises(ValueError): self.invoke({**ENV, 'STEAM_USER': 'operator', 'STEAM_PASS': 'fixture-no-transport'})
        run.assert_not_called(); self.assertEqual(self.snapshot(), before)

    def test_unknown_nested_data_and_fake_commented_keys_do_not_shadow_root(self):
        content = CONFIG.replace(b' unknownNative 73', b' /* serverName "fake" */\r\n addons {\r\n  serverName "nested"\r\n  more [1 2 { text "brace }" }]\r\n }\r\n unknownNative 73')
        self.target.write_bytes(content)
        with patch.object(shared, 'run', return_value=0), patch.object(shared, 'publish_config') as publish:
            self.assertEqual(self.invoke({**ENV, 'AUTO_UPDATE': '0'}), 0)
        publish.assert_not_called(); self.assertEqual(self.target.read_bytes(), content)

    def test_unbalanced_unknown_blocks_and_malformed_known_separators_refuse(self):
        for content in (CONFIG.replace(b' unknownNative 73', b' addons {'), CONFIG+b'trailing', CONFIG.replace(b' unknownNative 73', b' galaxySeed=12'), CONFIG.replace(b' unknownNative 73', b' /*unterminated')):
            self.target.write_bytes(content)
            with patch.object(shared, 'install') as acquisition, self.assertRaises(ValueError): self.invoke()
            acquisition.assert_not_called(); self.assertEqual(self.target.read_bytes(), content)

    @unittest.skipIf(os.name == 'nt', 'secure publisher uses Linux dirfd APIs')
    def test_linux_fresh_seed_preserves_file_identity_and_other_bytes(self):
        self.target.unlink()
        identities = {}
        def acquire(*args, **kwargs):
            self.target.write_bytes(CONFIG); self.target.chmod(0o640)
            metadata = self.target.stat(); identities.update(uid=metadata.st_uid, gid=metadata.st_gid)
        with patch.object(shared, 'install', side_effect=acquire): adapter.install(self.root, ENV, shared=shared)
        expected=CONFIG.replace(b'"Operator name"', b'"Creation name"').replace(b'TRUE', b'FALSE').replace(b'12345', b'21945875634')
        self.assertEqual(self.target.read_bytes(), expected)
        metadata=self.target.stat()
        self.assertEqual((metadata.st_uid,metadata.st_gid,metadata.st_mode&0o777),(identities['uid'],identities['gid'],0o640))
        backups=list((self.root/'.voltra/crafting/config-backups').iterdir())
        self.assertEqual(len(backups),1); self.assertEqual(backups[0].read_bytes(),CONFIG)


if __name__ == '__main__': unittest.main()
