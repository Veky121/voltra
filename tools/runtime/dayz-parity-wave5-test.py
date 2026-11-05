import importlib.util
from pathlib import Path
import json
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('dayz_preflight', ROOT / 'internal/panel/game_library/scripts/dayz-preflight.py')
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)
shared = candidate.load_runtime()


def snapshot(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() if p.is_file() else None for p in root.rglob('*')}


class DayZPreflight(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'DayZServer').write_bytes(b'\x7fELF\x02\x01synthetic, never execute')
        (self.root / 'serverDZ.cfg').write_text('hostname="Operator"; class Missions {class DayZ {template="dayzOffline.fixture";};};\nUnknown=42;\n')
        mission = self.root / 'mpmissions/dayzOffline.fixture'; mission.mkdir(parents=True); (mission / 'init.c').write_text('// fixture')
        key = self.root / 'mod/Keys/AuthKey.bikey'; key.parent.mkdir(parents=True); key.write_bytes(b'mod key')
        self.env = {'SKIP_INSTALL':'1','UPDATE_SERVER':'0','DISABLE_MOD_UPDATES':'1','SERVER_PORT':'29120','QUERY_PORT':'29121','RCON_PORT':'29122','VOLTRA_ALLOCATED_PORTS':'29120,29121,29122','MODIFICATIONS':'mod','MOD_FILE':'','MODS_LOWERCASE':'1','RCON_PASSWORD':'fixture-private'}

    def operator_key(self):
        target = self.root / 'keys/authkey.bikey'; target.parent.mkdir(); target.write_bytes(b'operator key')

    def test_baseline_key_refusal_happens_after_mod_renames(self):
        self.operator_key(); before = snapshot(self.root)
        with self.assertRaisesRegex(ValueError, 'operator file'):
            shared.dayz_mods(self.root, self.env)
        self.assertNotEqual(snapshot(self.root), before)
        self.assertIn('mod/keys/authkey.bikey', snapshot(self.root))
        self.assertEqual((self.root / 'keys/authkey.bikey').read_bytes(), b'operator key')

    def test_candidate_key_conflict_refuses_before_any_write_or_run(self):
        self.operator_key(); before = snapshot(self.root)
        with patch.object(shared, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'operator file'):
                candidate.launch(self.root, self.env, shared)
        run.assert_not_called(); self.assertEqual(snapshot(self.root), before)

    def test_invalid_key_ledger_refuses_before_any_rename(self):
        (self.root / '.voltra').mkdir(); (self.root / '.voltra/arma-keys.json').write_text('{invalid')
        before = snapshot(self.root)
        with patch.object(shared, 'run') as run:
            with self.assertRaises(ValueError): candidate.launch(self.root, self.env, shared)
        run.assert_not_called(); self.assertEqual(snapshot(self.root), before)

    def test_valid_preflight_is_pure_and_retains_shared_runner(self):
        before = snapshot(self.root)
        with patch.object(shared, 'run', return_value=19) as run:
            self.assertEqual(candidate.launch(self.root, self.env, shared), 19)
        run.assert_called_once_with(self.root, 'dayz', self.env)
        self.assertEqual(snapshot(self.root), before)

    def test_private_transport_and_invalid_parameters_refuse_without_mutation(self):
        before = snapshot(self.root)
        for change in ({'SKIP_INSTALL':'0'}, {'UPDATE_SERVER':'1'}, {'DISABLE_MOD_UPDATES':'0'}, {'STARTUP_PARAMS':'-config=/outside'}, {'QUERY_PORT':'29120'}):
            with patch.object(shared, 'run') as run:
                with self.assertRaises(ValueError): candidate.launch(self.root, {**self.env,**change}, shared)
            run.assert_not_called(); self.assertEqual(snapshot(self.root), before)

    def test_comments_and_strings_do_not_select_missions(self):
        path = self.root / 'serverDZ.cfg'
        content = path.read_text() + '\n// template="missing.line";\n/* template="missing.block"; */\nmotd[]={"template=""missing.string"";", "hello"};\nclass Other {template="missing.other";};\n'
        path.write_text(content)
        before = snapshot(self.root)
        candidate.preflight(self.root, self.env, shared)
        self.assertEqual(snapshot(self.root), before)
        self.assertEqual(candidate.mission_templates(content), ['dayzOffline.fixture'])

    def test_invalid_or_duplicate_active_mission_refuses_before_mutation(self):
        for body in ('template="../outside";', 'template="dayzOffline.fixture"; template="duplicate";', 'template=variable;'):
            (self.root / 'serverDZ.cfg').write_text('class Missions {class DayZ {' + body + '};};')
            before = snapshot(self.root)
            with patch.object(shared, 'run') as run:
                with self.assertRaises(ValueError): candidate.launch(self.root, self.env, shared)
            run.assert_not_called()
            self.assertEqual(snapshot(self.root), before)

    def test_runner_uses_dayz_validator_and_restores_shared_hook(self):
        original = shared.existing_dayz
        def run(root, game, env):
            return shared.existing_dayz(root, env)
        with patch.object(shared, 'run', side_effect=run):
            content = candidate.launch(self.root, self.env, shared)
        self.assertIn('Unknown=42', content)
        self.assertIs(shared.existing_dayz, original)

    def test_exact_deployed_fragment_imports_planning_hooks_without_mutating(self):
        fragment = json.loads((ROOT / 'artifacts/game-parity-20261029/dayz-resume-profile.json').read_text())['dayz/egg-dayz.json']
        script = fragment['egg']['scripts']['installation']['script']
        for match in re.finditer(r"cat > ([^\n]+) <<'([^']+)'\n([\s\S]*?)\n\2", script):
            name, _, body = match.groups()
            target = self.root / name
            self.assertTrue(target.resolve().is_relative_to(self.root.resolve()))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body + '\n')
        self.assertEqual((self.root / '.voltra/dayz_preflight.py').read_text().rstrip(), (ROOT / 'internal/panel/game_library/scripts/dayz-preflight.py').read_text().rstrip())
        self.assertEqual((self.root / '.voltra/arma-native.py').read_text().rstrip(), (ROOT / 'internal/panel/game_library/scripts/arma-native.py').read_text().rstrip())
        before = snapshot(self.root)
        code = '''import importlib.util,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); spec=importlib.util.spec_from_file_location('deployed',root/'.voltra/dayz_preflight.py')
wrapper=importlib.util.module_from_spec(spec);spec.loader.exec_module(wrapper)
shared=wrapper.load_runtime();assert hasattr(shared.arma,'plan_keys') and hasattr(shared.arma,'plan_lowercase_tree')
wrapper.preflight(root,json.loads(sys.argv[2]),shared)
'''
        result = subprocess.run([sys.executable, '-B', '-c', code, str(self.root), json.dumps(self.env)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(snapshot(self.root), before)

if __name__ == '__main__': unittest.main()
