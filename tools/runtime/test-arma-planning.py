"""Read-only planning and whole-operation refusal regressions; no game execution."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('controls', Path('internal/panel/game_library/scripts/arma3-controls.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class PlanningTests(unittest.TestCase):
    def env(self, **changes):
        return dict(dict(INSTALL_MODE='existing', UPDATE_SERVER='0', DISABLE_MOD_UPDATES='1',
                    VOLTRA_ALLOCATED_PORTS='2302,2303,2304,2305,2306', MODS_LOWERCASE='1'), **changes)

    def snapshot(self, root):
        return {str(p.relative_to(root)): (p.lstat().st_mode, p.lstat().st_mtime_ns,
                p.read_bytes() if p.is_file() and not p.is_symlink() else None)
                for p in [root, *root.rglob('*')]}

    def refused(self, root, env):
        before = self.snapshot(root)
        with self.assertRaises((ValueError, OSError)):
            c.configure(root, 'arma3', env)
        self.assertEqual(before, self.snapshot(root))

    def test_second_mod_collision_leaves_first_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            r = Path(folder)
            for name in ('@one', '@two'):
                (r / name).mkdir()
            (r / '@one/UPPER.BIKEY').write_bytes(b'first')
            (r / '@two/A').write_bytes(b'a')
            (r / '@two/a').write_bytes(b'b')
            self.refused(r, self.env(MODIFICATIONS='@one;@two'))

    def test_cross_mod_key_conflict_without_keys_or_cfg(self):
        with tempfile.TemporaryDirectory() as folder:
            r = Path(folder)
            for name in ('@one', '@two'):
                (r / name).mkdir()
                (r / name / 'SAME.BIKEY').write_bytes(name.encode())
            self.refused(r, self.env(MODIFICATIONS='@one;@two'))
            self.assertFalse((r / 'keys').exists())
            self.assertFalse((r / 'server.cfg').exists())

    def test_future_lowercase_and_optional_prefix_and_pure_plan(self):
        with tempfile.TemporaryDirectory() as folder:
            r = Path(folder)
            (r / '@Mixed/Sub').mkdir(parents=True)
            (r / '@Mixed/Sub/KEY.BIKEY').write_bytes(b'key')
            env = self.env(OPTIONALMODS='@Mixed')
            before = self.snapshot(r)
            c.arma.plan_arma3(r, env, 'custom=42;')
            self.assertEqual(before, self.snapshot(r))
            c.configure(r, 'arma3', env)
            self.assertEqual((r / 'keys/optional_Mixed_key.bikey').read_bytes(), b'key')
            self.assertTrue((r / '@Mixed/sub/key.bikey').exists())
            cfg = r / 'server.cfg'
            cfg.write_text('hostname="operator";password="native";custom=42;')
            c.configure(r, 'arma3', env)
            self.assertIn('hostname="operator";password="native";custom=42;', cfg.read_text())

    def test_operator_conflict_ledger_types_links_and_cfg(self):
        for kind in ('operator', 'ledger', 'cfg', 'link', 'special'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                r = Path(folder)
                (r / '@one').mkdir()
                (r / '@one/KEY.BIKEY').write_bytes(b'new')
                if kind == 'operator':
                    (r / 'keys').mkdir()
                    (r / 'keys/key.bikey').write_bytes(b'operator')
                elif kind == 'ledger':
                    (r / '.voltra').mkdir()
                    (r / '.voltra/arma-keys.json').write_text('{"../operator":"bad"}')
                elif kind == 'cfg':
                    (r / 'server.cfg').mkdir()
                elif kind == 'link':
                    (r / '@one/link').symlink_to(r / '@one/KEY.BIKEY')
                else:
                    import os
                    os.mkfifo(r / '@one/fifo')
                self.refused(r, self.env(MODIFICATIONS='@one'))

if __name__ == '__main__':
    unittest.main()
