"""Nightingale-only source checks; no native/publisher execution."""
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'
sys.path.insert(0, str(BASE))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, BASE / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


load('steam_template', 'steam-template.py')
load('additional_survival_install', 'additional-survival-install.py')
owner = load('nightingale_owner_test', 'nightingale-owner.py')


class Owner(unittest.TestCase):
    def test_exact_staged_layout_imports_without_source_tree(self):
        project = BASE.parents[3]
        fragment = project / 'artifacts/game-parity-20261029/nightingale-owner-20261030/profile.json'
        profile = json.loads(fragment.read_text(encoding='utf-8'))['Nightingale/egg-nightingale.json']
        script = profile['egg']['scripts']['installation']['script']
        embeds = re.findall(r"cat > (\S+) <<'VOLTRA_SOURCE'\r?\n([\s\S]*?)\r?\nVOLTRA_SOURCE", script)
        self.assertGreater(len(embeds), 1)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for target, body in embeds:
                destination = root / target
                self.assertTrue(destination.resolve().is_relative_to(root.resolve()))
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(body.encode('utf-8'))
            # Isolated interpreter cannot reuse source-tree modules preloaded by
            # this test suite. Only actual installer-emitted sibling names exist.
            code = ("import runpy,sys; from pathlib import Path; "
                    "sys.path.insert(0,str(Path('.voltra').resolve())); "
                    "ns=runpy.run_path('.voltra/nightingale-owner.py'); "
                    "ns['validate'](Path.cwd(),{}); print('staged-import-ok')")
            result = subprocess.run([sys.executable, '-I', '-B', '-c', code],
                                    cwd=root, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('staged-import-ok', result.stdout)

    def test_invalid_scalars_refuse_before_any_install_or_launch(self):
        for env in ({'PASSWORD':'x\ny'}, {'ADMIN_PASSWORD':'x'*21}, {'MAX_PLAYER':'1.5'},
                    {'Difficulty':'unknown'}, {'CHEATS':'yes'}, {'SERVER_PORT':'1023'},
                    {'SERVER_PORT':'28001','VOLTRA_ALLOCATED_PORTS':'28002'},
                    {'Difficulty':'easy','DIFFICULTY':'hard'}):
            with self.subTest(keys=list(env)), tempfile.TemporaryDirectory() as d:
                root=Path(d); sentinel=root/'operator'; sentinel.write_bytes(b'retain')
                with patch.object(owner.game,'install') as install, patch.object(owner.game,'launch') as launch:
                    for action in ('install','run'):
                        with self.assertRaises(ValueError):owner.run(action,root,env)
                    install.assert_not_called();launch.assert_not_called()
                self.assertEqual(list(root.iterdir()),[sentinel])
                self.assertEqual(sentinel.read_bytes(),b'retain')

    def test_original_defaults_and_documented_stdout(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            owner.validate(root,{})
            argv=owner.command(root,'nightingale',{})
            self.assertIn('-ini:Game:[/Script/Engine.GameSession]:MaxPlayers=6',argv)
            self.assertIn('-EnableCheats',argv)
            self.assertIn('-port=7777',argv)
            self.assertIn('-ini:Engine:[JsonLogger]:bStdout=true',argv)
            self.assertFalse(any('statusPort' in arg for arg in argv))

    def test_other_branch_command_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            self.assertEqual(owner.command(root,'moria',{}),owner.original_command(root,'moria',{}))

    def test_valid_dispatch_keeps_environment_and_root(self):
        with tempfile.TemporaryDirectory() as d:
            env={'Difficulty':'hard','PASSWORD':'literal$word','CHEATS':'0'}
            with patch.object(owner.game,'install',return_value={'fixture':True}) as install:
                self.assertEqual(owner.run('install',d,env),{'fixture':True})
                install.assert_called_once_with(Path(d).resolve(),'nightingale',env)


if __name__=='__main__':unittest.main()
