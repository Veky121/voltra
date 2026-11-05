"""Offline Arma 3 fixtures. No network, Docker or server acquisition."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

source = Path('internal/panel/game_library/scripts/arma3-controls.py').resolve()
spec = importlib.util.spec_from_file_location('arma3_controls', source)
controls = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controls)


class ControlsTests(unittest.TestCase):
    def test_real_prerequisite_refusals_leave_root_unchanged(self):
        valid = dict(INSTALL_MODE='existing', UPDATE_SERVER='0', DISABLE_MOD_UPDATES='1',
                     VOLTRA_ALLOCATED_PORTS='2302,2303,2304,2305,2306')
        invalid = [{}, *[dict(valid, **change) for change in [
            {'INSTALL_MODE':'steam'}, {'UPDATE_SERVER':'yes'}, {'DISABLE_MOD_UPDATES':'0'},
            {'STEAMCMD_EXTRA_FLAGS':'-bad'}, {'STEAMCMD_APPID':'1'},
            {'SERVER_BINARY':'bad'}, {'STARTUP_PARAMS':'-port=9999'},
            {'VOLTRA_ALLOCATED_PORTS':'2302'}, {'CLEAR_CACHE':'yes'}, {'HC_NUM':'6'},
            {'MODS_LOWERCASE':'yes'}, {'MODIFICATIONS':'../bad'},
            {'SERVERMODS':'missing'}, {'OPTIONALMODS':'missing'}, {'MOD_FILE':'../bad'},
        ]]]
        for env in invalid:
            for existing in (False, True):
                with self.subTest(env=env, existing=existing), tempfile.TemporaryDirectory() as folder:
                    root = Path(folder)
                    if existing:
                        (root / 'server.cfg').write_bytes(b'hostname="operator";')
                        (root / 'operator.bin').write_bytes(b'preserve')
                    def snapshot():
                        return {str(p.relative_to(root)): (p.stat().st_mode, p.stat().st_mtime_ns,
                                p.read_bytes() if p.is_file() else None) for p in [root, *root.rglob('*')]}
                    before = snapshot()
                    with self.assertRaises(ValueError):
                        controls.configure(root, 'arma3', env)
                    self.assertEqual(snapshot(), before)

    def test_real_fresh_creation_and_native_edits(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            env = dict(INSTALL_MODE='existing', UPDATE_SERVER='0', DISABLE_MOD_UPDATES='1',
                       VOLTRA_ALLOCATED_PORTS='2302,2303,2304,2305,2306', SERVER_NAME='seed')
            args, clients = controls.configure(root, 'arma3', env)
            self.assertEqual(clients, [])
            self.assertIn('-config=server.cfg', args)
            cfg = root / 'server.cfg'
            self.assertIn('hostname = "seed";', cfg.read_text())
            cfg.write_text(cfg.read_text().replace('"seed"', '"operator"') + '\ncustom=42;\n')
            edited = cfg.read_bytes()
            controls.configure(root, 'arma3', dict(env, SERVER_NAME='stale'))
            self.assertEqual(cfg.read_bytes(), edited)

    def test_literal_config_and_unknown_preservation(self):
        original = '// operator comment\nclass Missions {class One {hostname="mission";};};\ncustom=42;\n'
        values = controls.managed_values(dict(SERVER_NAME='"true" $x', ADMIN_PASSWORD='fixture-secret',
            BATTLEYE='1', PERSISTENT='true', VERIFY_SIGNATURES='2', DISABLE_VON='0', VON_CODEC_QUALITY='30'))
        result = controls.arma.patch_cfg(original, values)
        self.assertTrue(result.startswith(original))
        self.assertIn('hostname = """true"" $x";', result)
        self.assertIn('BattlEye = 1;', result)
        self.assertEqual(controls.arma.patch_cfg(result, values), result)
        self.assertEqual(controls.managed_values({}), {})

    def test_invalid_controls_do_not_modify_files(self):
        for env in [dict(BATTLEYE='yes'), dict(VERIFY_SIGNATURES='3'), dict(VON_CODEC_QUALITY='0'),
                    dict(ADMIN_PASSWORD='bad\nvalue')]:
            with self.subTest(env=env), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                cfg = root / 'server.cfg'
                cfg.write_text('custom=42;')
                with patch.object(controls, 'original_configure') as shared, self.assertRaises(ValueError):
                    controls.configure(root, 'arma3', env)
                shared.assert_not_called()
                self.assertEqual(cfg.read_text(), 'custom=42;')

    def test_config_round_trip_preserves_save_and_basic(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'server.cfg').write_text('hostname="old"; class Missions {}; custom=42;')
            for name in ['basic.cfg', 'save.vars.Arma3Profile']:
                (root / name).write_bytes(b'operator-owned\x00')
            with patch.object(controls.arma, 'arma_arguments', return_value=(['native'], [], [])):
                env = dict(INSTALL_MODE='existing', UPDATE_SERVER='0', DISABLE_MOD_UPDATES='1',
                           VOLTRA_ALLOCATED_PORTS='2302,2303,2304,2305,2306', SERVER_NAME='new')
                self.assertEqual(controls.configure(root, 'arma3', env), (['native'], []))
                controls.configure(root, 'arma3', dict(env, SERVER_NAME='next'))
            self.assertIn('hostname="old";', (root / 'server.cfg').read_text())
            self.assertIn('custom=42;', (root / 'server.cfg').read_text())
            for name in ['basic.cfg', 'save.vars.Arma3Profile']:
                self.assertEqual((root / name).read_bytes(), b'operator-owned\x00')

    def test_real_configure_preserves_operator_and_seeds_missing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            cfg = root / 'server.cfg'
            cfg.write_text('hostname="operator";password="operator-secret";maxPlayers=77;class Missions {};')
            (root / 'basic.cfg').write_bytes(b'network-native')
            env = dict(INSTALL_MODE='existing', UPDATE_SERVER='0', DISABLE_MOD_UPDATES='1',
                       SERVER_NAME='seed', SERVER_PASSWORD='seed-secret', MAX_PLAYERS='32', BATTLEYE='1')
            # Only external launch argument/key discovery is stubbed. Execute the actual
            # shared configure and private writer, including its historical CFG rewrite.
            with patch.object(controls.arma, 'arma_arguments', return_value=(['native'], [], [])), patch.object(controls.arma, 'publish_keys'):
                controls.configure(root, 'arma3', env)
                first = cfg.read_bytes()
                self.assertIn(b'hostname="operator";password="operator-secret";maxPlayers=77;', first)
                self.assertIn(b'BattlEye = 1;', first)
                cfg.write_text(cfg.read_text().replace('BattlEye = 1;', 'BattlEye = 0;'))
                edited = cfg.read_bytes()
                controls.configure(root, 'arma3', env)
                self.assertEqual(cfg.read_bytes(), edited)
                self.assertEqual((root / 'basic.cfg').read_bytes(), b'network-native')
                cfg.unlink()
                controls.configure(root, 'arma3', env)
                self.assertIn('hostname = "seed";', cfg.read_text())
                self.assertIn('maxPlayers = 32;', cfg.read_text())

    def test_fragment_retains_original_controls_and_stop(self):
        key = 'arma/arma3/egg-arma3.json'
        old = json.loads(Path('internal/panel/game_library/overrides.json').read_text())[key]
        import os
        new = json.loads(Path(os.environ.get('ARMA3_TEST_FRAGMENT', 'artifacts/game-parity-20261029/arma3-review-profile.json')).read_text())[key]
        self.assertEqual([v['env_variable'] for v in new['egg']['variables']], [v['env_variable'] for v in old['egg']['variables']])
        self.assertEqual(new['egg']['config']['stop'], '^SIGTERM')
        self.assertEqual(new['port_rules'], old['port_rules'])
        self.assertIn('arma3-controls.py run arma3', new['egg']['startup'])
        self.assertIn(source.read_text(), new['egg']['scripts']['installation']['script'].replace('\r\n', '\n'))

    def test_admin_secret_not_in_child_environment(self):
        with patch.object(controls, 'original_child_environment', return_value={'ADMIN_PASSWORD':'fixture-secret','HOME':'volume'}):
            self.assertEqual(controls.child_environment(Path('.'), 'arma3', {}), {'HOME':'volume'})


if __name__ == '__main__':
    unittest.main()
