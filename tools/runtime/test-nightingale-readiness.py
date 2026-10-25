"""Synthetic offline Nightingale prerequisites; no publisher payload or auth proof."""
import importlib.util
import os
from pathlib import Path
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
load('steam_template', 'steam-template.py')
load('additional_survival_install', 'additional-survival-install.py')
game = load('nightingale_readiness_fixture', 'fantasy-survival-servers.py')
VALID = b'; synthetic fixture\r\n[Fixture.ActualSection]\r\nPassword=old\r\nUnknown=retained\r\n'
DEST = 'NWX/Config/ServerSettings.ini'
EXAMPLE = 'NWX/Config/ExampleServerSettings.ini'

def put(root, name, body):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return path

def inventory(root):
    return {str(p.relative_to(root)): (p.lstat().st_mode, p.lstat().st_uid, p.lstat().st_gid,
            os.readlink(p) if p.is_symlink() else p.read_bytes() if p.is_file() else None)
            for p in root.rglob('*')}

class NightingaleReadiness(unittest.TestCase):
    def assert_preflight_denial(self, root):
        before = inventory(root)
        with patch.object(game, 'update') as update, patch.object(game, 'arguments') as arguments, patch.object(game.console, 'run') as run:
            for operation in (game.configure, game.install, game.launch):
                with self.assertRaises(ValueError) as result:
                    operation(root, 'nightingale', {'AUTO_UPDATE': '1'})
                self.assertNotIn('do-not-disclose', str(result.exception))
            update.assert_not_called(); arguments.assert_not_called(); run.assert_not_called()
        self.assertEqual(inventory(root), before)

    def test_existing_invalid_sections_fail_before_any_mutation_or_update(self):
        for content in (b'', b'; Password=do-not-disclose\n', b'Password=do-not-disclose\n',
                        b'[One]\nUnknown=do-not-disclose\n',
                        b'[One]\nPassword=do-not-disclose\n[Two]\nAdminPassword=x\n', b'\xff'):
            with self.subTest(content_type=len(content)), tempfile.TemporaryDirectory() as d:
                root=Path(d); put(root, DEST, content); put(root, 'operator.txt', b'unchanged')
                self.assert_preflight_denial(root)

    def test_existing_link_to_in_volume_file_rejected_before_update(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); target=put(root, 'real.ini', VALID); link=root/DEST; link.parent.mkdir(parents=True); link.symlink_to(target)
            self.assert_preflight_denial(root)

    def test_linked_parent_even_inside_volume_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); target=root/'real'; target.mkdir(); put(root, 'real/ServerSettings.ini', VALID)
            (root/'NWX').mkdir(); (root/'NWX/Config').symlink_to(target, target_is_directory=True)
            self.assert_preflight_denial(root)

    def test_directory_and_fifo_destination_rejected_without_blocking(self):
        for kind in ('directory','fifo'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as d:
                root=Path(d); path=root/DEST; path.parent.mkdir(parents=True)
                if kind=='directory':path.mkdir()
                else:os.mkfifo(path)
                # inventory intentionally does not open a special file.
                self.assert_preflight_denial(root)

    def test_existing_valid_settings_need_no_example_and_install_preserves_metadata(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); path=put(root, DEST, VALID); path.chmod(0o640); before=path.stat()
            def publisher(*args, **kwargs):
                put(root, 'NWX/Binaries/Linux/NWXServer-Linux-Shipping', b'synthetic not executable fixture')
                path.write_bytes(b'[PublisherOverwrite]\nPassword=changed\n')
                return {'fixture': True}
            with patch.object(game, 'update', side_effect=publisher) as update:
                game.install(root, 'nightingale', {})
            update.assert_called_once(); self.assertEqual(path.read_bytes(), VALID)
            self.assertEqual((path.stat().st_mode,path.stat().st_uid,path.stat().st_gid),(before.st_mode,before.st_uid,before.st_gid))
            self.assertFalse((root/EXAMPLE).exists())

    def test_fresh_invalid_or_missing_example_never_publishes_destination(self):
        for content in (None,b'',b'[Unknown]\nNothing=x\n',b'[One]\nPassword=x\n[Two]\nAdminPassword=x\n',b'\xff'):
            with self.subTest(content_type=None if content is None else len(content)), tempfile.TemporaryDirectory() as d:
                root=Path(d); sentinel=put(root,'operator.txt',b'retain')
                def publisher(*args, **kwargs):
                    if content is not None:put(root, EXAMPLE, content)
                    return {'fixture': True}
                with patch.object(game,'update',side_effect=publisher) as update:
                    with self.assertRaises(ValueError):game.install(root,'nightingale',{})
                update.assert_called_once(); self.assertFalse((root/DEST).exists()); self.assertEqual(sentinel.read_bytes(),b'retain')

    def test_fresh_link_example_never_copied_and_outside_unchanged(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as outside:
            root=Path(d); target=put(Path(outside),'publisher.ini',VALID); before=target.stat()
            def publisher(*args,**kwargs):
                path=root/EXAMPLE;path.parent.mkdir(parents=True);path.symlink_to(target)
                return {'fixture':True}
            with patch.object(game,'update',side_effect=publisher):
                with self.assertRaises(ValueError):game.install(root,'nightingale',{})
            self.assertFalse((root/DEST).exists());self.assertEqual(target.read_bytes(),VALID);self.assertEqual(target.stat(),before)

    def test_configure_invalid_example_does_not_copy_before_validation(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);put(root,EXAMPLE,b'[Invalid]\nOther=do-not-disclose\n');before=inventory(root)
            with self.assertRaises(ValueError):game.configure(root,'nightingale',{})
            self.assertEqual(inventory(root),before)

    def test_valid_fresh_example_exact_copy_before_typed_controls(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            def publisher(*args,**kwargs):
                put(root,EXAMPLE,VALID);put(root,'NWX/Binaries/Linux/NWXServer-Linux-Shipping',b'fixture')
                return {'fixture':True}
            with patch.object(game,'update',side_effect=publisher):game.install(root,'nightingale',{})
            self.assertEqual((root/DEST).read_bytes(),VALID)
            game.configure(root,'nightingale',{'DIFFICULTY':'hard','PASSWORD':'literal$word','ADMIN_PASSWORD':'literal-admin','SERVER_PORT':'28010'})
            actual=(root/DEST).read_bytes()
            for value in (b'[Fixture.ActualSection]',b'StartingDifficulty = hard',b'Password= literal$word',b'AdminPassword = literal-admin',b'Unknown=retained\r\n'):self.assertIn(value,actual)

    def test_oversized_existing_settings_fail_before_update(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); put(root,DEST,VALID+b';'*(8*1024**2))
            self.assert_preflight_denial(root)

    def test_fresh_nonregular_example_never_published(self):
        for kind in ('directory','fifo'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as d:
                root=Path(d)
                def publisher(*args,**kwargs):
                    path=root/EXAMPLE;path.parent.mkdir(parents=True)
                    if kind=='directory':path.mkdir()
                    else:os.mkfifo(path)
                    return {'fixture':True}
                with patch.object(game,'update',side_effect=publisher):
                    with self.assertRaises(ValueError):game.install(root,'nightingale',{})
                self.assertFalse((root/DEST).exists())

    def duplicate_cases(self):
        yield b'[do-not-disclose]\nPassword=x\n[do-not-disclose]\nPassword=y\n'
        for key in ('Password', 'StartingDifficulty', 'AdminPassword'):
            yield ('[do-not-disclose]\nPassword=x\n' + key + '=do-not-disclose\n' + key + '=do-not-disclose\n').encode()

    def test_duplicate_existing_managed_sections_and_keys_fail_before_update(self):
        for content in self.duplicate_cases():
            with self.subTest(case_bytes=len(content)), tempfile.TemporaryDirectory() as d:
                root=Path(d);put(root,DEST,content);put(root,'operator.txt',b'retain')
                self.assert_preflight_denial(root)

    def test_duplicate_fresh_example_sections_and_keys_fail_before_copy(self):
        for content in self.duplicate_cases():
            with self.subTest(case_bytes=len(content)), tempfile.TemporaryDirectory() as d:
                root=Path(d);sentinel=put(root,'operator.txt',b'retain')
                def publisher(*args,**kwargs):
                    put(root,EXAMPLE,content)
                    return {'fixture':True}
                with patch.object(game,'update',side_effect=publisher) as update:
                    with self.assertRaises(ValueError) as result:game.install(root,'nightingale',{})
                update.assert_called_once();self.assertNotIn('do-not-disclose',str(result.exception))
                self.assertFalse((root/DEST).exists());self.assertEqual(sentinel.read_bytes(),b'retain')

    def test_other_game_branches_do_not_use_nightingale_preflight(self):
        with tempfile.TemporaryDirectory() as d, patch.object(game,'nightingale_preflight',side_effect=AssertionError('unexpected Nightingale path')):
            root=Path(d);game.configure(root,'smalland',{});game.configure(root,'moria',{})
            with patch.object(game,'update',return_value={'fixture':True}):game.install(root,'moria',{})

if __name__=='__main__':unittest.main()
