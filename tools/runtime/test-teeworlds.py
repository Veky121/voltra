import hashlib
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

runtime, installer = {'__name__': 'fixture'}, {'__name__': 'fixture'}
exec(RUNTIME_SOURCE, runtime)
exec(INSTALL_SOURCE, installer)


class TeeworldsTests(unittest.TestCase):
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
            credential = root / '.voltra/teeworlds-rcon-password'
            original = credential.read_bytes()
            self.assertEqual(credential.stat().st_mode & 0o777, 0o600)
            self.assertEqual(first, runtime['arguments'](env, root))
            self.assertEqual(credential.read_bytes(), original)
            self.assertIn('sv_register 0', first)
            self.assertIn('sv_name "literal \\"; shutdown; \\""', first)
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
