import hashlib
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

runtime, installer = {'__name__': 'fixture'}, {'__name__': 'fixture'}
exec(RUNTIME_SOURCE, runtime)
exec(INSTALL_SOURCE, installer)


class TeeworldsTests(unittest.TestCase):
    def test_new_secret_hardens_generated_placeholder_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'maps').mkdir()
            (root / 'maps/dm1.map').write_bytes(b'map')
            target = root / 'autoexec.cfg'
            target.write_bytes(b'# existing nonsecret operator content\n')
            target.chmod(0o644)
            identity = (target.stat().st_uid, target.stat().st_gid)
            runtime['arguments']({'SERVER_PORT':'23560'},root)
            if os.name != 'nt':
                self.assertEqual(target.stat().st_mode & 0o777,0o600)
                self.assertEqual((target.stat().st_uid,target.stat().st_gid),identity)
            complete = target.read_bytes()
            target.chmod(0o640)
            runtime['arguments']({'SERVER_PORT':'23560','RCON_PASSWORD':'ignored'},root)
            self.assertEqual(target.read_bytes(),complete)
            if os.name != 'nt':
                self.assertEqual(target.stat().st_mode & 0o777,0o640)

    def test_native_cr_only_line_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target, content, expected = runtime['plan_settings']({}, root)
            content = content.replace(b'\n', b'\r')
            target.write_bytes(content)
            _, preserved, actual = runtime['plan_settings']({}, root)
            self.assertEqual(actual, expected)
            self.assertEqual(preserved, content)
            target.write_bytes(b'sv_name Original\r')
            _, seeded, values = runtime['plan_settings']({}, root)
            self.assertEqual(values['sv_name'], 'Original')
            self.assertTrue(seeded.startswith(b'sv_name Original\r'))
            self.assertNotIn(b'\n', seeded)

    def test_quoted_backslash_and_quote_roundtrips(self):
        for value in ['ends\\', 'a\\"b', 'a"\\b', '\\', '\\\\', '\\"', 'text\\"; shutdown; \\"', 'native\u0085text', 'native\u2028text', 'native\u2029text']:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'maps').mkdir()
                (root / 'maps/dm1.map').write_bytes(b'map')
                runtime['arguments']({'SERVER_PORT':'23560','SERVER_NAME':value}, root)
                first = (root / 'autoexec.cfg').read_bytes()
                self.assertEqual(runtime['plan_settings']({},root)[2]['sv_name'],value)
                runtime['arguments']({'SERVER_PORT':'23560','SERVER_NAME':'ignored'},root)
                self.assertEqual((root / 'autoexec.cfg').read_bytes(),first)

    def test_literal_console_quotes_and_utf8_bounds(self):
        self.assertEqual(runtime['quote']('x"; shutdown; "\\$safe 世界', 100), '"x\\"; shutdown; \\"\\\\$safe 世界"')
        for text, limit in [('世' * 43, 127), ('bad\ncommand', 100), ('bad\x00value', 100)]:
            with self.assertRaises(ValueError):
                runtime['quote'](text, limit)

    def test_native_args_map_and_generated_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data/maps').mkdir(parents=True)
            (root / 'data/maps/dm1.map').write_bytes(b'map')
            env = {'SERVER_PORT': '23560', 'SERVER_NAME': 'literal "; shutdown; "', 'SERVER_MOTD': '$safe'}
            first = runtime['arguments'](env, root)
            credential = root / 'autoexec.cfg'
            original = credential.read_bytes()
            if os.name != 'nt':
                self.assertEqual(credential.stat().st_mode & 0o777, 0o600)
            self.assertEqual(first, runtime['arguments'](env, root))
            self.assertEqual(credential.read_bytes(), original)
            self.assertIn(b'sv_register 0', original)
            self.assertIn(b'sv_name "literal \\"; shutdown; \\""', original)
            self.assertEqual(first, [str(root / 'teeworlds_srv'), 'bindaddr 0.0.0.0', 'sv_port 23560'])
            self.assertNotIn('-f', first)

    def test_invalid_native_controls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'maps').mkdir()
            (root / 'maps/dm1.map').write_bytes(b'map')
            for values in ({'SERVER_PORT': '0'}, {'MAX_PLAYERS': '65'}, {'PUBLIC_SERVER': '2'},
                           {'GAME_TYPE': 'injected'}, {'SERVER_MAP': '../dm1'}, {'SERVER_MAP': 'absent'},
                           {'SERVER_PASSWORD': '世' * 11}):
                with self.assertRaises(ValueError):
                    runtime['arguments']({'SERVER_PORT': '23560', **values}, root)

    def test_operator_bytes_authority_and_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'maps').mkdir()
            (root / 'maps/dm1.map').write_bytes(b'map')
            runtime['arguments']({'SERVER_PORT': '23560'}, root)
            target = root / 'autoexec.cfg'
            content = target.read_bytes().replace(b'sv_name "Teeworlds server"', b'sv_name "Operator \\"quoted\\" name"')
            content = b'\xef\xbb\xbf# operator unknown\r\n' + content.replace(b'\n', b'\r\n') + b'tune gravity 0.25\r\nadd_vote "map" "change_map dm1"\r\n'
            target.write_bytes(content)
            target.chmod(0o640)
            runtime['arguments']({'SERVER_PORT': '23561', 'SERVER_NAME': 'ignored', 'SERVER_MAP': 'absent', 'MAX_PLAYERS': 'bad'}, root)
            self.assertEqual(target.read_bytes(), content)
            if os.name != 'nt':
                self.assertEqual(target.stat().st_mode & 0o777, 0o640)

    def test_configuration_refuses_before_writes(self):
        for body in [b'sv_name "one"\nSV_NAME "two"\n', b'sv_name "one"; sv_name "two"\n', b'exec nested.cfg\n', b'sv_name "unfinished\n', b'sv_rcon_password ""\n']:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                target = root / 'autoexec.cfg'
                target.write_bytes(body)
                before = set(root.rglob('*'))
                with self.assertRaises(ValueError):
                    runtime['plan_settings']({}, root)
                self.assertEqual(target.read_bytes(), body)
                self.assertEqual(set(root.rglob('*')), before)

    def test_missing_seed_preserves_existing_native_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'autoexec.cfg'
            original = b'# comment\r\nsv_name "Native operator"\r\nsv_max_clients 5\r\n'
            target.write_bytes(original)
            planned, content, native = runtime['plan_settings']({'SERVER_NAME':'ignored', 'MAX_PLAYERS':'20'}, root)
            self.assertEqual(target.read_bytes(), original)
            self.assertTrue(content.startswith(original))
            self.assertEqual(native['sv_name'], 'Native operator')
            self.assertEqual(native['sv_max_clients'], '5')
            runtime['configure_settings'](planned, content)
            self.assertNotIn(b'\n', content.replace(b'\r\n', b''))
            self.assertEqual(runtime['plan_settings']({}, root)[1], content)

    def test_unquoted_native_rest_strings_and_install_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'autoexec.cfg'
            target.write_bytes(b'sv_name Operator native name\n')
            self.assertEqual(runtime['plan_settings']({}, root)[2]['sv_name'], 'Operator native name')
            target.write_bytes(b'sv_name "one"\nsv_name "two"\n')
            before = {str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            with patch.object(installer['runpy'], 'run_path', return_value=runtime), patch.dict(installer['os'].environ, {}, clear=True), patch.dict(installer, {'download': lambda *args: self.fail('acquisition called before native preflight')}):
                with self.assertRaises(ValueError):
                    installer['install'](root)
            self.assertEqual(before, {str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()})

    @unittest.skipUnless(hasattr(Path, 'symlink_to'), 'symlinks unavailable')
    def test_config_symlink_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'operator.cfg'
            target.write_bytes(b'# unchanged')
            try:
                (root / 'autoexec.cfg').symlink_to(target)
            except OSError:
                self.skipTest('symlink privileges unavailable')
            with self.assertRaises(ValueError):
                runtime['plan_settings']({}, root)
            self.assertEqual(target.read_bytes(), b'# unchanged')

    def test_patch_requires_exact_anchors(self):
        text = '#include <base/math.h>\nint CServer::Run()\n{\n\tm_pConsole->StoreCommands(false);\n\t\twhile(m_RunServer)\n\t\t{\n}\n'
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'server.cpp'
            source.write_text(text)
            installer['patch_console'](source, ADAPTER_SOURCE)
            result = source.read_text()
            self.assertIn('VoltraInput.Poll(Console());', result)
            self.assertIn('Voltra native console ready', result)
            with self.assertRaises(ValueError):
                installer['patch_console'](source, ADAPTER_SOURCE)

    def test_archive_rejects_traversal_and_links(self):
        for name, kind in [('root/../escape', tarfile.REGTYPE), ('root/link', tarfile.SYMTYPE), ('/escape', tarfile.REGTYPE)]:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / 'archive.tar.gz'
                with tarfile.open(archive, 'w:gz') as output:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    output.addfile(member, io.BytesIO())
                with self.assertRaises(ValueError):
                    installer['extract'](archive, root / 'target', 'root')

    def test_download_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(installer['urllib'].request, 'urlopen', return_value=io.BytesIO(b'bad download')):
            with self.assertRaises(ValueError):
                installer['download']('https://fixture.invalid/archive', '0' * 64, Path(directory) / 'archive')


unittest.main()
