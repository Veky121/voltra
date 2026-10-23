#!/usr/bin/env python3
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
import json
import hashlib
import shutil
import zipfile
from unittest.mock import patch

scripts = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
for name, filename in [('steam_template', 'steam-template.py'), ('native_console', 'native-console.py'),
                       ('goldsrc_runtime', 'goldsrc-runtime.py'), ('goldsrc_install', 'goldsrc-install.py'),
                       ('native_release', 'native-release.py'), ('rehlds_install', 'rehlds-install.py')]:
    spec = importlib.util.spec_from_file_location(name, scripts / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
runtime, installer, steam = (sys.modules[name] for name in ('goldsrc_runtime', 'goldsrc_install', 'steam_template'))
rehlds = sys.modules['rehlds_install']


class GoldSrcTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('hlds_run', 'hlds_linux', 'cstrike/liblist.gam', 'cstrike/maps/de_dust2.bsp', 'valve/liblist.gam', 'valve/maps/crossfire.bsp'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('publisher fixture')
        self.env = {'VOLTRA_GOLDSRC_RECIPE': 'cs16', 'SRCDS_APPID': '90', 'SERVER_PORT': '28100',
                    'VOLTRA_ALLOCATED_PORTS': '28100,28101', 'SRV_SECURE': 'insecure',
                    'HOSTNAME': 'LAN +literal $safe', 'SERVER_PASSWORD': 'private-password', 'RCON_PASSWORD': 'private-rcon'}

    def test_typed_argv_and_private_config(self):
        argv, environment = runtime.configure(self.root, self.env)
        self.assertEqual(argv[argv.index('-game') + 1], 'cstrike')
        self.assertEqual(argv[argv.index('-sport') + 1], '28101')
        self.assertIn('-insecure', argv)
        self.assertNotIn('private-password', argv)
        self.assertNotIn('private-rcon', argv)
        managed = self.root / 'cstrike/voltra_managed.cfg'
        self.assertIn('hostname "LAN +literal $safe"', managed.read_text())
        self.assertIn('sv_lan 1', managed.read_text())
        self.assertEqual(managed.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('PYTHONHOME', environment)

    def test_generic_half_life_mod_and_map(self):
        env = {**self.env, 'VOLTRA_GOLDSRC_RECIPE': 'generic', 'HLDS_GAME': 'valve', 'SRCDS_MAP': 'crossfire'}
        argv, _ = runtime.configure(self.root, env)
        self.assertEqual(argv[argv.index('-game') + 1], 'valve')
        self.assertIn('map "crossfire"', (self.root / 'valve/voltra_bootstrap.cfg').read_text())
        arguments = steam.arguments(self.root, 90, env)
        at = arguments.index('+app_set_config')
        self.assertEqual(arguments[at:at+4], ['+app_set_config', '90', 'mod', 'valve'])

    def test_native_info_parser_checks_mod_and_map(self):
        modern = b'\xff\xff\xff\xffI\x30name\0de_dust2\0cstrike\0Counter-Strike\0'
        legacy = b'\xff\xff\xff\xffm127.0.0.1:27015\0name\0crossfire\0valve\0Half-Life\0'
        self.assertEqual(runtime.info_identity(modern), ('de_dust2', 'cstrike'))
        self.assertEqual(runtime.info_identity(legacy), ('crossfire', 'valve'))
        for packet in (b'bad', modern[:-2], b'\xff\xff\xff\xffA1234'):
            with self.assertRaises(ValueError): runtime.info_identity(packet)

    def test_hyphenated_custom_map_uses_native_bootstrap_not_commandline(self):
        (self.root / 'cstrike/maps/custom-map.bsp').write_bytes(b'map fixture')
        argv, _ = runtime.configure(self.root, {**self.env, 'SRV_STARTMAP':'custom-map'})
        self.assertNotIn('custom-map', argv)
        self.assertIn('map "custom-map"', (self.root / 'cstrike/voltra_bootstrap.cfg').read_text())

    def test_unallocated_or_duplicate_steam_port_rejected(self):
        for port in ('28100', '26900', '65536'):
            with self.subTest(port=port), self.assertRaisesRegex(ValueError, 'allocation'):
                runtime.configure(self.root, {**self.env, 'VAC_PORT': port})

    def test_missing_installed_map_rejected(self):
        with self.assertRaisesRegex(ValueError, 'not installed'):
            runtime.configure(self.root, {**self.env, 'SRV_STARTMAP': 'missing'})

    def test_map_mod_and_setting_injection_rejected(self):
        for key, value in [('SRV_STARTMAP', '../outside'), ('SRV_STARTMAP', 'de_dust2;quit'),
                           ('HLDS_GAME', 'valve'), ('HLDS_GAME', '../../outside'), ('HOSTNAME', 'evil;quit'),
                           ('SERVER_PASSWORD', 'quote"'), ('RCON_PASSWORD', 'evil\nquit'), ('SRV_SECURE', 'secure;quit')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                runtime.configure(self.root, {**self.env, key: value})

    def test_unknown_operator_config_preserved_and_managed_backed_up(self):
        original = self.root / 'cstrike/server.cfg'
        original.write_bytes(b'// operator\r\nmp_friendlyfire 1\r\n')
        runtime.configure(self.root, self.env)
        first = (self.root / 'cstrike/voltra_managed.cfg').read_bytes()
        runtime.configure(self.root, {**self.env, 'HOSTNAME': 'renamed'})
        backups = list((self.root / '.voltra/goldsrc/config-backups').glob('*.cfg'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), first)
        self.assertEqual(original.read_bytes(), b'// operator\r\nmp_friendlyfire 1\r\n')

    def test_update_preserves_configs_bans_plugins_even_on_failure(self):
        values = {'cstrike/server.cfg': b'//custom\r\nhostname preserved\r\n',
                  'cstrike/banned.cfg': b'banid 0 STEAM_0:1:12345\n',
                  'cstrike/liblist.gam': b'gamedll_linux "addons/metamod/dlls/metamod.so"\n',
                  'cstrike/addons/metamod/plugins.ini': b'linux addons/custom.so\n'}
        for name, content in values.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            target.chmod(0o600)
            os.chown(target, 1234, 1234)
        def fail_update(root, app, **options):
            self.assertEqual(app, 90)
            self.assertEqual(options['env']['HLDS_GAME'], 'cstrike')
            for name in values: (root / name).write_bytes(b'publisher overwrite')
            raise RuntimeError('expected publisher failure')
        with patch.object(installer, 'update', side_effect=fail_update):
            with self.assertRaisesRegex(RuntimeError, 'publisher failure'):
                installer.install(self.root, self.env)
        for name, content in values.items():
            self.assertEqual((self.root / name).read_bytes(), content)
            self.assertEqual((self.root / name).stat().st_uid, 1234)
            self.assertEqual((self.root / name).stat().st_gid, 1234)
            self.assertEqual((self.root / name).stat().st_mode & 0o777, 0o600)

    def test_install_creates_missing_ban_files_without_overwrite(self):
        with patch.object(installer, 'update'):
            installer.install(self.root, self.env)
        self.assertTrue((self.root / 'cstrike/listip.cfg').is_file())
        self.assertTrue((self.root / 'cstrike/banned.cfg').is_file())

    def test_game_symlink_escape_rejected_before_write(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (self.root / 'cstrike').rename(self.root / 'old-cstrike')
        (self.root / 'cstrike').symlink_to('/tmp')
        with self.assertRaisesRegex(ValueError, 'escapes'):
            runtime.configure(self.root, self.env)

    def rehlds_fixture(self):
        archive = self.root / 'fixture-engine.zip'
        with zipfile.ZipFile(archive, 'w') as output:
            output.writestr('bin/linux32/engine_i486.so', b'reviewed engine')
            output.writestr('bin/linux32/hlds_linux', b'reviewed launcher')
            output.writestr('bin/win32/swds.dll', b'not for Linux')
        state = self.root / '.voltra'
        state.mkdir(exist_ok=True)
        record = {'version':'3.15.0.896','url':'https://publisher.example/engine.zip',
                  'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size}
        (state / 'rehlds-release.json').write_text(json.dumps(record))
        (state / 'rehlds-license.txt').write_text((scripts / 'rehlds-license.txt').read_text())
        return archive, record

    def test_rehlds_overlay_preserves_operator_plugins_and_records_engine(self):
        archive, record = self.rehlds_fixture()
        plugin = self.root / 'valve/addons/operator.so'
        plugin.parent.mkdir(parents=True)
        plugin.write_bytes(b'operator plugin')
        os.chown(self.root, 1234, 1234)
        with patch.object(rehlds, 'download', side_effect=lambda release,target:shutil.copyfile(archive,target)):
            rehlds.overlay(self.root, {'SRCDS_BETAID':'steam_legacy','VERSION':'latest'})
        self.assertEqual((self.root / 'engine_i486.so').read_bytes(), b'reviewed engine')
        self.assertEqual(plugin.read_bytes(), b'operator plugin')
        self.assertFalse((self.root / 'swds.dll').exists())
        self.assertEqual(json.loads((self.root / '.voltra/rehlds/release.json').read_text())['sha256'],record['sha256'])
        self.assertEqual((self.root / 'hlds_linux').stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.root / 'engine_i486.so').stat().st_uid, 1234)
        self.assertEqual((self.root / '.voltra/rehlds/release.json').stat().st_uid, 1234)
        self.assertIn('ReHLDS Contributors', (self.root / '.voltra/rehlds/LICENSE').read_text())

    def test_rehlds_requires_compatible_publisher_branch_before_install(self):
        with patch.object(installer, 'update') as update:
            with self.assertRaisesRegex(ValueError, 'steam_legacy'):
                installer.install(self.root, {**self.env,'VOLTRA_GOLDSRC_RECIPE':'rehlds'})
        update.assert_not_called()

    def test_rehlds_unsafe_zip_rejected(self):
        archive, _ = self.rehlds_fixture()
        with zipfile.ZipFile(archive, 'a') as output:
            output.writestr('../outside', b'invalid')
        ready = self.root / 'ready'
        ready.mkdir()
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            rehlds.extract_engine(archive, ready)

    def test_rehlds_explicit_version_rejects_path_injection(self):
        _, record = self.rehlds_fixture()
        with self.assertRaises(ValueError):
            rehlds.release_for('../../outside', record)


if __name__ == '__main__':
    unittest.main(verbosity=2)
