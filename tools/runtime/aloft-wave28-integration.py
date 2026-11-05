"""Offline exact-recipe integration and receipt. No native lifecycle actions."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'artifacts/game-parity-20261029/wave28-aloft-integration'
KEY = 'aloft/egg-aloft.json'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def digest(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())

def load(name, leaf):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(leaf))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    canonical = REPO / 'internal/panel/game_library/overrides.json'
    before_raw = canonical.read_bytes()
    before = json.loads(before_raw)
    frozen = REPO / 'artifacts/game-parity-20261029/root-candidate-build/candidate.json'
    frozen_hash = sha(frozen.read_bytes())
    prior = json.loads((REPO / 'artifacts/game-parity-20261029/wave27-aloft-save-path/report.json').read_text())
    def stage():
        profile = json.loads(canonical.read_bytes())[KEY]
        script = profile['egg']['scripts']['installation']['script']
        body = (REPO / 'internal/panel/game_library/scripts/aloft-preflight.py').read_text().rstrip('\n')
        pattern = r"(cat > .voltra/aloft_parity_wave2.py <<'([^']+)'\n).*?\n\2(?:\n|$)"
        script, count = re.subn(pattern, lambda m: m[1] + body + '\n' + m[2] + '\n', script, flags=re.S)
        assert count == 1
        profile['egg']['scripts']['installation']['script'] = script
        (OUT / 'profile-fragment.json').write_text(json.dumps({KEY: profile}, indent=2)+'\n')
        return profile
    profile = stage()
    first = (OUT / 'profile-fragment.json').read_bytes()
    assert stage() == profile
    assert (OUT / 'profile-fragment.json').read_bytes() == first
    assert profile['egg']['variables'] == before[KEY]['egg']['variables']
    assert profile['egg']['startup'] == before[KEY]['egg']['startup']
    # Replace only the exact JSON value, retaining all other bytes and recipes.
    text = before_raw.decode('utf-8')
    match = re.search(r'"aloft/egg-aloft.json"\s*:\s*', text)
    _, length = json.JSONDecoder().raw_decode(text[match.end():])
    replacement = json.dumps(profile, ensure_ascii=False, indent=2)
    merged = (text[:match.end()] + replacement + text[match.end()+length:]).encode('utf-8')
    after = json.loads(merged)
    others = {key: {'before': digest(value), 'after': digest(after[key])}
              for key, value in before.items() if key != KEY}
    assert set(before) == set(after)
    assert all(row['before'] == row['after'] for row in others.values())
    old_blocks = dict((n, b) for n, _, b in re.findall(r"cat > ([^ ]+) <<'([^']+)'\n(.*?)\n\2(?:\n|$)", before[KEY]['egg']['scripts']['installation']['script'], re.S))
    blocks = re.findall(r"cat > ([^ ]+) <<'([^']+)'\n(.*?)\n\2(?:\n|$)", profile['egg']['scripts']['installation']['script'], re.S)
    helpers = {}
    for name, _, body in blocks:
        leaf = Path(name).name
        source = REPO / 'internal/panel/game_library/scripts' / ('aloft-preflight.py' if leaf == 'aloft_parity_wave2.py' else leaf.replace('_', '-'))
        raw = source.read_bytes()
        normalized = raw.replace(b'\r\n', b'\n').rstrip(b'\n') + b'\n'
        emitted = (body + '\n').encode()
        if leaf == 'aloft_parity_wave2.py':
            assert emitted == normalized
        if leaf != 'aloft_parity_wave2.py':
            assert old_blocks[name] == body, 'Unrelated embedded helper drift: ' + name
        helpers[name] = {'source': str(source.relative_to(REPO)), 'source_raw_sha256': sha(raw),
                         'source_lf_terminal_newline_sha256': sha(normalized),
                         'emitted_lf_sha256': sha(emitted), 'raw_equal': raw == emitted,
                         'lf_equal': emitted == normalized, 'changed_from_canonical': old_blocks[name] != body}
    assert len(helpers) == 7
    canonical.write_bytes(merged)
    tests = load('aloft_tests28', 'test-aloft-wave27-save-path.py')
    tests.base.PROFILE = after[KEY]  # Exercise merged canonical, not historical fragment.
    regressions = load('aloft_prior28', 'aloft-parity-wave2-test.py')
    class Integration(tests.base.EmittedAloft):
        def test_actual_emitted_import_paths(self):
            for name in ('steam_template', 'native_config', 'native_console', 'unreal_survival_next'):
                self.assertEqual(Path(sys.modules[name].__file__), self.root / '.voltra' / (name + '.py'))

        def test_unknown_other_named_world_is_preserved(self):
            world = self.root / '.wine/drive_c/users/container/AppData/LocalLow/Astrolabe Interactive/Aloft/data06/Saves/w_Unknown'
            world.mkdir(parents=True)
            (world / 'operator.save').write_bytes(b'opaque\x00\r\nunknown')
            before = self.snapshot()
            modes = {str(p): p.stat().st_mode for p in self.root.rglob('*')}
            with patch.object(self.wrapper.Path, 'cwd', return_value=self.root), patch.dict(tests.os.environ, self.env, clear=True), patch.object(sys, 'argv', ['fixture', 'run', 'aloft']), patch.object(self.runtime, 'main', return_value=7) as downstream:
                self.assertEqual(self.wrapper.main(self.runtime), 7)
                downstream.assert_called_once_with()
            self.assertEqual(self.snapshot(), before)
            self.assertEqual({str(p): p.stat().st_mode for p in self.root.rglob('*')}, modes)
    # Add just the two integration cases, without repeating inherited cases.
    suite = unittest.TestSuite([Integration('test_actual_emitted_import_paths'), Integration('test_unknown_other_named_world_is_preserved'), unittest.defaultTestLoader.loadTestsFromTestCase(tests.SavePaths),
                               unittest.defaultTestLoader.loadTestsFromTestCase(regressions.AloftPreflight)])
    stream = io.StringIO()
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
    (OUT / 'source-tests.txt').write_text(stream.getvalue(), encoding='utf-8')
    assert result.testsRun == 15 and result.wasSuccessful(), stream.getvalue()
    assert canonical.read_bytes() == merged
    assert sha(frozen.read_bytes()) == frozen_hash
    # Stage again after merge to prove repeatability against the integrated recipe.
    assert stage() == profile
    assert (OUT / 'profile-fragment.json').read_bytes() == first
    (OUT / 'other-recipe-hashes.json').write_text(json.dumps(others, indent=2)+'\n')
    report = {
        'recipe': KEY, 'owner': 'wave28-aloft-integration', 'ownership': 'yielded',
        'outcome': 'partial', 'source_state': 'UNSERVED', 'completion': False,
        'review': 'Accepted exact sibling-data named-world refusal before runtime.main, updater and prerequisites. SAVE_PATH remains detection-only. No migration, rename, native argument or default change. Unknown worlds and operator files preserved by read-only preflight.',
        'canonical_before_raw_sha256': sha(before_raw), 'canonical_merged_raw_sha256': sha(merged),
        'baseline_note': 'This receipt is repeatable: canonical_before is the state at invocation and may already contain the integrated guard on a verification rerun. Other recipe comparisons cover every non-Aloft value on every invocation.',
        'aloft_profile_semantic_sha256': digest(profile),
        'other_recipe_count': len(others), 'other_recipes_unchanged': True,
        'other_recipe_hashes': 'other-recipe-hashes.json',
        'helper_comparison': helpers,
        'hash_convention': 'Raw hashes cover exact bytes. LF comparison converts CRLF to LF and enforces one terminal newline, matching heredoc output. Semantic recipe hashes use sorted compact JSON. No raw and normalized identities are conflated.',
        'outputs': {p.name: sha(p.read_bytes()) for p in OUT.iterdir() if p.is_file() and p.name != 'report.json'},
        'tests': {'count': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'skips': len(result.skipped), 'evidence': 'source-tests.txt', 'scope': '13 prior tests plus two integration tests for actual emitted import paths and unknown other-named world byte/mode preservation. All install, prerequisites and native execution mocked. No native success claimed.'},
        'repeatable_staging': True, 'variables_defaults_controls_permissions_unchanged': True,
        'staging_scope': 'Only Aloft preflight refreshed. Wave27 all-helper refresh refused before canonical mutation because shared steam_template embedding drifted. Other six embedded bodies retained exactly; current source versus emitted comparisons recorded individually.',
        'failures_encountered': ['Initial all-seven refresh detected steam_template drift and stopped before canonical write. Replaced with exact Aloft-wrapper-only staging; all tests passed.'],
        'checks': prior['checks'],
        'checks_preservation': 'All 37 statuses retained verbatim from wave27. Their relative evidence paths resolve under wave26 as specified by wave27. New source verification is recorded separately; no native check promoted.',
        'prior_report': 'artifacts/game-parity-20261029/wave27-aloft-save-path/report.json',
        'prior_report_raw_sha256': sha((REPO / 'artifacts/game-parity-20261029/wave27-aloft-save-path/report.json').read_bytes()),
        'manifest': prior['manifest'], 'publisher_sources_historical': prior['publisher_sources'],
        'frozen_candidate_raw_sha256': frozen_hash, 'frozen_candidate_unchanged': True,
        'activation': 'Earlier automatic activation rejection persists. No retry or bypass.',
        'skips': prior['skips'], 'gaps': prior['integration_limits'],
        'cleanup': {'temporary_fixtures': 'unittest TemporaryDirectory cleanup completed', 'native_resources_created': False, 'operations_running': False, 'lease': None, 'existing_fixtures': 'not inspected or changed'},
        'changed_files': ['internal/panel/game_library/overrides.json exact Aloft value only', 'tools/runtime/aloft-wave28-integration.py', str(OUT.relative_to(REPO))]
    }
    assert len(report['checks']) == 37
    (OUT / 'report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'merged_sha256': sha(merged), 'tests': result.testsRun, 'other_recipes_unchanged': len(others), 'report': str(OUT / 'report.json')}))

if __name__ == '__main__':
    main()
