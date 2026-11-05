"""Offline candidate tests; no game acquisition or native success inferred."""
import hashlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

base = Path('internal/panel/game_library/scripts').resolve()
sys.path.insert(0, str(base))


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


module('steam_template', base / 'steam-template.py')
module('native_console', base / 'native-console.py')
module('native_config', base / 'native-config.py')
module('quake_family_runtime', base / 'quake-family-runtime.py')
candidate = module('etlegacy_authority', Path(__file__).with_name('banana-parity-wave10-etlegacy-authority.py'))


class ETLegacyAuthorityTests(unittest.TestCase):
    def game(self, root):
        game = root / 'etlegacy'
        (game / 'etmain').mkdir(parents=True)
        (game / 'etlded.i386').write_bytes(b'offline binary fixture')
        (game / 'etlded.x86_64').write_bytes(b'offline binary fixture64')
        with zipfile.ZipFile(game / 'etmain/pak0.pk3', 'w') as package:
            package.writestr('maps/oasis.bsp', b'offline map fixture')
        (game / 'etmain/etl_server.cfg').write_bytes(b'// operator\r\nset unknown "retained"\r\n')
        return game

    def snapshot(self, root):
        return [(str(p.relative_to(root)), p.lstat().st_mode,
                 hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() and not p.is_symlink() else '')
                for p in sorted(root.rglob('*'))]

    def test_seed_defaults_and_final_managed_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); game = self.game(root)
            _, argv, port, credentials = candidate.configure(root, {'SERVER_PORT': '29112'})
            native = game / 'userdata/legacy/voltra-native.cfg'
            self.assertEqual(native.stat().st_mode & 0o777, 0o600)
            self.assertIn('set sv_maxclients "20"', native.read_text())
            self.assertIn('set g_friendlyFire "1"', native.read_text())
            self.assertEqual(port, 29112)
            self.assertEqual(argv[-6:], ['+exec', 'voltra-native.cfg', '+exec', 'voltra-managed.cfg', '+map', 'oasis'])
            managed = (game / 'userdata/legacy/voltra-managed.cfg').read_text()
            self.assertIn('set dedicated 1\nset sv_advert 0\n', managed)
            self.assertIn('set net_port 29112\n', managed)
            self.assertTrue(all(value == '' for value in credentials))

    def test_native_identity_passwords_and_unknown_bytes_remain_authoritative(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); game = self.game(root)
            target = game / 'userdata/legacy/voltra-native.cfg'; target.parent.mkdir(parents=True)
            before = b'// keep CRLF\r\nSeTa sv_hostname "Operator"\r\nset sv_maxclients "12"\r\nset g_password "private-value"\r\nset rconpassword "rcon-value"\r\nset unknown "retain"\r\n'
            target.write_bytes(before); stamp = target.stat().st_mtime_ns
            stock = (game / 'etmain/etl_server.cfg').read_bytes()
            for _ in range(2):
                _, _, _, credentials = candidate.configure(root, {'SERVER_PORT': '29112', 'SERVER_NAME': 'Old startup', 'MAX_PLAYERS': '20'})
                self.assertEqual(target.read_bytes(), before)
                self.assertEqual(target.stat().st_mtime_ns, stamp)
                managed = (target.parent / 'voltra-managed.cfg').read_text()
                self.assertIn('set sv_hostname "Operator"', managed)
                self.assertIn('set sv_maxclients 12', managed)
                self.assertIn('set g_password "private-value"', managed)
                self.assertIn('private-value', credentials)
                self.assertIn('rcon-value', credentials)
            self.assertEqual((game / 'etmain/etl_server.cfg').read_bytes(), stock)

    def test_invalid_existing_alias_refuses_before_shared_writes(self):
        for text in ['set sv_hostname "one"\nseta SV_HOSTNAME "two"\n',
                     'set g_password "secret"; quit\n', 'set sv_maxclients "999"\n']:
            with self.subTest(text=text), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); game = self.game(root)
                target = game / 'userdata/legacy/voltra-native.cfg'; target.parent.mkdir(parents=True)
                target.write_text(text); before = self.snapshot(root)
                with self.assertRaises(ValueError): candidate.configure(root, {'SERVER_PORT': '29112'})
                self.assertEqual(self.snapshot(root), before)

    def test_invalid_environment_or_binary_refuses_before_any_configuration(self):
        for env in [{'MAP': 'missing'}, {'MAP': '../escape'}, {'ET_VERSION': 'arm'},
                    {'SERVER_NAME': 'bad"value'}, {'PUBLIC_SERVER': '2'}, {'SERVER_PORT': '65536'}]:
            with self.subTest(env=env), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); self.game(root); before = self.snapshot(root)
                with self.assertRaises(ValueError): candidate.configure(root, env)
                self.assertEqual(self.snapshot(root), before)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); game = self.game(root); (game / 'etlded.i386').unlink()
            before = self.snapshot(root)
            with self.assertRaises(ValueError): candidate.configure(root, {})
            self.assertEqual(self.snapshot(root), before)

    def test_symlink_and_nonregular_native_path_refuse_before_writes(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as other:
            root = Path(directory); game = self.game(root)
            folder = game / 'userdata/legacy'; folder.mkdir(parents=True)
            target = folder / 'voltra-native.cfg'; target.symlink_to(Path(other) / 'outside')
            before = self.snapshot(root)
            with self.assertRaises(ValueError): candidate.configure(root, {})
            self.assertEqual(self.snapshot(root), before)
            target.unlink(); target.mkdir(); before = self.snapshot(root)
            with self.assertRaises(ValueError): candidate.configure(root, {})
            self.assertEqual(self.snapshot(root), before)

    def test_explicit_public_and_architecture_keep_original_runtime_controls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); game = self.game(root)
            _, argv, _, _ = candidate.configure(root, {'ET_VERSION': '64', 'PUBLIC_SERVER': '1', 'OMNIBOT': '1'})
            self.assertTrue(argv[0].endswith('etlded.x86_64'))
            managed = (game / 'userdata/legacy/voltra-managed.cfg').read_text()
            self.assertIn('set omnibot_enable 1', managed)
            self.assertIn('set dedicated 2\nset sv_advert 3', managed)

    def test_extra_native_credentials_are_available_to_shared_redaction(self):
        values = candidate.identity_values('set sv_privatepassword "slot"\nset refereePassword "ref"\nset shoutcastPassword "cast"\n')
        self.assertEqual(values, {'sv_privatepassword': 'slot', 'refereepassword': 'ref', 'shoutcastpassword': 'cast'})


unittest.main()
